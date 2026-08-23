import {
  ensureAuthSession,
  getAuthUserId,
  getSupabase,
  hasSupabaseConfig,
} from './lib/supabase';
import { deleteGemMedia } from './s3Storage';
import {
  canViewGem,
  gemVisibility,
  type CreateMapGemInput,
  type GemVisibility,
  type MapGem,
  type MapGemType,
  type UpdateGemInput,
} from './mapGems';

export const MEMORY_GEMS_TABLE = 'memory_gems';

export type MemoryGemRow = {
  id: string;
  title: string | null;
  address: string | null;
  media_urls: string[] | null;
  metadata: Record<string, unknown> | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  created_at: string;
  user_id?: string | null;
  gem_type?: string | null;
  visibility?: GemVisibility | null;
  is_private?: boolean | null;
};

function mediaTypeFromUrl(url: string): MapGemType {
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return 'video';
  if (/\.(jpg|jpeg|png|webp|gif|heic)(\?|$)/i.test(url)) return 'photo';
  return 'photo';
}

function extractCoords(row: MemoryGemRow): { lat: number; lng: number } | null {
  const latRaw = row.latitude ?? row.lat;
  const lngRaw = row.longitude ?? row.lng;
  if (latRaw != null && lngRaw != null) {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const meta = row.metadata;
  if (!meta || typeof meta !== 'object') return null;
  const lat = Number(meta.lat ?? meta.latitude);
  const lng = Number(meta.lng ?? meta.longitude ?? meta.lon ?? meta.long);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function resolveVisibility(row: Record<string, unknown>): GemVisibility {
  const raw = row.visibility;
  if (raw === 'private' || raw === 'family' || raw === 'public') return raw;
  if (row.is_private === true) return 'private';
  return 'public';
}

function resolveGemType(row: Record<string, unknown>, preview: string | null): MapGemType {
  const raw = row.gem_type ?? (row.metadata as Record<string, unknown> | null)?.gem_type;
  if (raw === 'photo' || raw === 'video' || raw === 'text') return raw;
  if (preview) return mediaTypeFromUrl(preview);
  return 'text';
}

export function mapMemoryGemRow(row: Record<string, unknown>): MapGem | null {
  const mediaUrls = Array.isArray(row.media_urls)
    ? row.media_urls.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : [];
  const preview = mediaUrls[0] ?? null;
  const visibility = resolveVisibility(row);
  const coords = extractCoords({
    id: String(row.id),
    title: (row.title as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    media_urls: mediaUrls,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    latitude: row.latitude != null ? Number(row.latitude) : row.lat != null ? Number(row.lat) : null,
    longitude:
      row.longitude != null ? Number(row.longitude) : row.lng != null ? Number(row.lng) : null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    user_id: (row.user_id as string | null) ?? null,
    visibility,
    is_private: visibility === 'private',
  });
  if (!coords) return null;

  const type = resolveGemType(row, preview);
  const title = typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null;
  const address = typeof row.address === 'string' && row.address.trim() ? row.address.trim() : null;
  const meta = (row.metadata as Record<string, unknown> | null) ?? null;
  const owner =
    (typeof row.user_id === 'string' && row.user_id.trim()) ||
    (typeof meta?.author_id === 'string' && meta.author_id) ||
    (typeof meta?.user_id === 'string' && meta.user_id) ||
    '';

  return {
    id: String(row.id),
    author_id: owner,
    lat: coords.lat,
    lng: coords.lng,
    type,
    media_url: preview,
    content: title || address,
    description: address,
    created_at: String(row.created_at ?? new Date().toISOString()),
    source: 'memory_gems',
    visibility,
    is_private: visibility === 'private',
    media_urls: mediaUrls,
  };
}

export type FetchMemoryGemsOpts = {
  viewerId?: string;
  contactIds?: ReadonlySet<string>;
};

/** Load memory gems visible to the current viewer. */
export async function fetchMemoryGems(opts: FetchMemoryGemsOpts = {}): Promise<MapGem[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    await ensureAuthSession().catch(() => undefined);
    const sb = getSupabase();
    const { data, error } = await sb.from(MEMORY_GEMS_TABLE).select('*');
    if (error) {
      console.warn('[paranoic memory_gems] fetch', error.message);
      return [];
    }
    const rows = (data as Record<string, unknown>[] | null) ?? [];
    const mapped = rows.map(mapMemoryGemRow).filter((g): g is MapGem => g != null);
    const viewerId = opts.viewerId ?? '';
    const contactIds = opts.contactIds ?? new Set<string>();
    const visible = mapped.filter((g) => canViewGem(g, viewerId, contactIds));
    console.log(`💎 Loaded ${visible.length}/${mapped.length} memory gems for map`);
    return visible;
  } catch (e) {
    console.warn('[paranoic memory_gems] fetch failed', e);
    return [];
  }
}

export async function countOwnMemoryGems(): Promise<number> {
  if (!hasSupabaseConfig()) return 0;
  try {
    const uid = await getAuthUserId();
    if (!uid) return 0;
    const sb = getSupabase();
    const { count, error } = await sb
      .from(MEMORY_GEMS_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid);
    if (error) {
      console.warn('[paranoic memory_gems] count', error.message);
      return 0;
    }
    return count ?? 0;
  } catch (e) {
    console.warn('[paranoic memory_gems] count failed', e);
    return 0;
  }
}

/** INSERT into memory_gems (unified gem storage). */
export async function createMemoryGem(input: CreateMapGemInput): Promise<MapGem> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');

  const sb = getSupabase();
  const {
    data: { session: rawSession },
  } = await sb.auth.getSession();
  const session =
    rawSession?.user?.id != null ? rawSession : await ensureAuthSession();
  const uid = session.user.id;
  if (!uid) throw new Error('Сессия Auth отсутствует');

  const visibility = input.visibility ?? 'public';
  const mediaUrls = input.mediaUrl ? [input.mediaUrl] : [];

  const row = {
    user_id: uid,
    latitude: input.lat,
    longitude: input.lng,
    lat: input.lat,
    lng: input.lng,
    title: input.content ?? null,
    address: null,
    media_urls: mediaUrls,
    gem_type: input.type,
    visibility,
    is_private: visibility === 'private',
    metadata: { gem_type: input.type },
  };

  const { data, error } = await sb.from(MEMORY_GEMS_TABLE).insert(row).select('*').single();
  if (error) {
    const msg = error.message || 'Не удалось сохранить капсулу';
    if (/row-level security|RLS/i.test(msg)) {
      throw new Error('RLS блокирует запись memory_gems. Проверьте политики INSERT.');
    }
    throw new Error(msg);
  }
  const mapped = mapMemoryGemRow(data as Record<string, unknown>);
  if (!mapped) throw new Error('Капсула без координат');
  return mapped;
}

export async function updateMemoryGemLocation(
  gemId: string,
  lat: number,
  lng: number
): Promise<MapGem> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  await ensureAuthSession();
  const uid = await getAuthUserId();
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Некорректные координаты');
  }
  const sb = getSupabase();
  const { data, error } = await sb
    .from(MEMORY_GEMS_TABLE)
    .update({ latitude, longitude, lat: latitude, lng: longitude })
    .eq('id', gemId)
    .eq('user_id', uid)
    .select('*')
    .single();
  if (error) throw new Error(error.message || 'Не удалось переместить капсулу');
  const mapped = mapMemoryGemRow(data as Record<string, unknown>);
  if (!mapped) throw new Error('Капсула без координат');
  return mapped;
}

export async function updateMemoryGem(gemId: string, patch: UpdateGemInput): Promise<MapGem> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  await ensureAuthSession();
  const uid = await getAuthUserId();
  const row: Record<string, unknown> = {};
  if (patch.content !== undefined) row.title = patch.content;
  if (patch.description !== undefined) row.address = patch.description;
  if (patch.visibility !== undefined) {
    row.visibility = patch.visibility;
    row.is_private = patch.visibility === 'private';
  } else if (patch.is_private !== undefined) {
    row.visibility = patch.is_private ? 'private' : 'public';
    row.is_private = patch.is_private;
  }
  if (patch.mediaUrls !== undefined) row.media_urls = patch.mediaUrls;
  else if (patch.mediaUrl !== undefined) {
    row.media_urls = patch.mediaUrl ? [patch.mediaUrl] : [];
  }
  if (patch.type !== undefined) {
    row.gem_type = patch.type;
    row.metadata = { gem_type: patch.type };
  }
  if (Object.keys(row).length === 0) throw new Error('Нет изменений');

  const sb = getSupabase();
  const { data, error } = await sb
    .from(MEMORY_GEMS_TABLE)
    .update(row)
    .eq('id', gemId)
    .eq('user_id', uid)
    .select('*')
    .single();
  if (error) throw new Error(error.message || 'Не удалось сохранить капсулу');
  const mapped = mapMemoryGemRow(data as Record<string, unknown>);
  if (!mapped) throw new Error('Капсула без координат');
  return mapped;
}

export async function deleteMemoryGem(gem: MapGem): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  const uid = await getAuthUserId();
  if (uid !== gem.author_id) {
    throw new Error('Можно удалить только свою капсулу');
  }

  const urls = [gem.media_url, ...(gem.media_urls ?? [])].filter((u): u is string => Boolean(u));
  for (const url of [...new Set(urls)]) {
    try {
      await deleteGemMedia(url);
    } catch (e) {
      console.warn('[paranoic memory_gems] media delete', url, e);
    }
  }

  const sb = getSupabase();
  const { error, data } = await sb
    .from(MEMORY_GEMS_TABLE)
    .delete()
    .eq('id', gem.id)
    .eq('user_id', uid)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message || 'Не удалось удалить капсулу');
  if (!data) throw new Error('Капсула не найдена или уже удалена');
}

export async function deleteOwnedGem(gem: MapGem): Promise<void> {
  await deleteMemoryGem(gem);
}

export async function moveOwnedGem(gem: MapGem, lat: number, lng: number): Promise<MapGem> {
  return updateMemoryGemLocation(gem.id, lat, lng);
}

export async function updateOwnedGem(gem: MapGem, patch: UpdateGemInput): Promise<MapGem> {
  return updateMemoryGem(gem.id, patch);
}

export { gemVisibility };
