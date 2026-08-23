import {
  ensureAuthSession,
  getAuthUserId,
  getSupabase,
  hasSupabaseConfig,
} from './lib/supabase';
import { getOrCreateIdentity } from './identity';
import { createMemoryGem, countOwnMemoryGems } from './memoryGems';
import {
  assertWithinUploadLimit,
  hasR2Config,
  thumbUrlFromMediaUrl,
  uploadFileToR2Detailed,
} from './s3Storage';

export const MAP_GEMS_BUCKET = 'map-gems';
/** Лимит бесплатных капсул на пользователя. */
export const FREE_MAP_GEM_LIMIT = 5;

export type MapGemType = 'photo' | 'video' | 'text';
export type GemVisibility = 'private' | 'family' | 'public';
export type MapGemSource = 'memory_gems';

export type MapGem = {
  id: string;
  author_id: string;
  lat: number;
  lng: number;
  type: MapGemType;
  media_url: string | null;
  content: string | null;
  created_at: string;
  source?: MapGemSource;
  /** @deprecated Use visibility. */
  is_private?: boolean;
  visibility?: GemVisibility;
  media_urls?: string[] | null;
  description?: string | null;
};

export type CreateMapGemInput = {
  lat: number;
  lng: number;
  type: MapGemType;
  mediaUrl?: string | null;
  content?: string | null;
  visibility?: GemVisibility;
};

export type UpdateGemInput = {
  content?: string | null;
  description?: string | null;
  is_private?: boolean;
  visibility?: GemVisibility;
  mediaUrl?: string | null;
  mediaUrls?: string[] | null;
  type?: MapGemType;
};

export type UploadGemMediaResult = {
  mediaUrl: string;
  thumbUrl?: string;
};

/** Resolve visibility from gem fields (legacy is_private support). */
export function gemVisibility(gem: Pick<MapGem, 'visibility' | 'is_private'>): GemVisibility {
  if (gem.visibility) return gem.visibility;
  return gem.is_private ? 'private' : 'public';
}

/** Whether viewer can see a gem on the map. */
export function canViewGem(
  gem: MapGem,
  viewerId: string,
  contactIds: ReadonlySet<string>
): boolean {
  if (!viewerId || gem.author_id === viewerId) return true;
  const vis = gemVisibility(gem);
  if (vis === 'public') return true;
  if (vis === 'family') return contactIds.has(gem.author_id);
  return false;
}

/** URL превью для маркера карты. */
export function gemMapPreviewUrl(gem: Pick<MapGem, 'media_url' | 'type'>): string | null {
  if (!gem.media_url || gem.type === 'text') return null;
  return thumbUrlFromMediaUrl(gem.media_url) || gem.media_url;
}

export async function countOwnMapGems(): Promise<number> {
  return countOwnMemoryGems();
}

export async function isPremiumUser(): Promise<boolean> {
  try {
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem('paranoic-premium-v1') === '1') return true;
    }
  } catch {
    /* */
  }

  if (!hasSupabaseConfig()) return false;
  try {
    const authId = await getAuthUserId();
    const localId = getOrCreateIdentity().id;
    const ids = [...new Set([authId, localId].filter(Boolean))];
    if (ids.length === 0) return false;
    const sb = getSupabase();
    const { data, error } = await sb.from('profiles').select('id,is_premium').in('id', ids);
    if (error) {
      console.warn('[paranoic gems] is_premium lookup', error.message);
      return false;
    }
    return ((data as Array<{ is_premium?: boolean }> | null) ?? []).some(
      (row) => row.is_premium === true
    );
  } catch (e) {
    console.warn('[paranoic gems] is_premium failed', e);
    return false;
  }
}

export async function isFreeGemLimitReached(): Promise<boolean> {
  if (await isPremiumUser()) return false;
  const count = await countOwnMapGems();
  return count >= FREE_MAP_GEM_LIMIT;
}

export function buildVisibleGemsContext(
  gems: MapGem[],
  opts: {
    showGems: boolean;
    inBounds?: (lat: number, lng: number) => boolean;
  }
): string {
  if (!opts.showGems) {
    return '(слой «Капсулы памяти» скрыт — на экране нет маркеров)';
  }
  const visible = gems.filter((g) => {
    if (opts.inBounds && !opts.inBounds(g.lat, g.lng)) return false;
    return Boolean(g.content?.trim());
  });
  if (visible.length === 0) {
    return '(видимых текстовых капсул на экране нет)';
  }
  return visible
    .slice(0, 40)
    .map((g, i) => `${i + 1}. [${g.type}] ${g.content!.trim()}`)
    .join('\n');
}

/** Create a memory gem (unified storage). */
export async function createMapGem(input: CreateMapGemInput): Promise<MapGem> {
  return createMemoryGem(input);
}

export async function uploadGemMedia(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<string> {
  const result = await uploadGemMediaDetailed(file, onProgress);
  return result.mediaUrl;
}

export async function uploadGemMediaDetailed(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<UploadGemMediaResult> {
  if (!hasR2Config()) {
    throw new Error(
      'Cloudflare R2 не настроен. Добавьте VITE_R2_* переменные окружения.'
    );
  }

  assertWithinUploadLimit(file);

  const sb = getSupabase();
  const {
    data: { session: rawSession },
  } = await sb.auth.getSession();
  const session =
    rawSession?.user?.id != null ? rawSession : await ensureAuthSession();

  const uid = session.user.id || 'anon';
  try {
    const uploaded = await uploadFileToR2Detailed('map-gems', uid, file, { onProgress });
    return {
      mediaUrl: uploaded.mediaUrl,
      thumbUrl: uploaded.thumbUrl,
    };
  } catch (err) {
    const raw = err instanceof Error ? err : new Error(String(err));
    throw new Error(
      `uploadGemMedia failed (${file.type || 'unknown type'}, ${file.size} bytes): ${raw.message}`
    );
  }
}

export function isGemOwner(
  gem: Pick<MapGem, 'author_id'>,
  currentUserId: string,
  opts?: { isAdmin?: boolean; allowDevOverride?: boolean }
): boolean {
  if (opts?.isAdmin) return true;
  if (
    opts?.allowDevOverride &&
    import.meta.env.DEV &&
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('paranoic-gem-owner-override') === '1'
  ) {
    return true;
  }
  return Boolean(currentUserId && gem.author_id === currentUserId);
}

export type GemFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: {
      id: string;
      author_id: string;
      type: MapGemType;
      media_url: string | null;
      content: string | null;
      created_at: string;
      visibility: GemVisibility;
    };
  }>;
};

export function gemsToGeoJson(gems: MapGem[]): GemFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: gems.map((gem) => ({
      type: 'Feature',
      id: gem.id,
      geometry: {
        type: 'Point',
        coordinates: [gem.lng, gem.lat],
      },
      properties: {
        id: gem.id,
        author_id: gem.author_id,
        type: gem.type,
        media_url: gem.media_url,
        content: gem.content,
        created_at: gem.created_at,
        visibility: gemVisibility(gem),
      },
    })),
  };
}

export function formatGemTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16);
  }
}
