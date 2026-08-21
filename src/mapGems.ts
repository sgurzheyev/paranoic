import {
  ensureAuthSession,
  getAuthUserId,
  getSupabase,
  hasSupabaseConfig,
} from './lib/supabase';
import { getOrCreateIdentity } from './identity';
import {
  assertWithinUploadLimit,
  deleteGemMedia,
  hasR2Config,
  thumbUrlFromMediaUrl,
  uploadFileToR2Detailed,
} from './s3Storage';

export const MAP_GEMS_TABLE = 'map_gems';
export const MAP_GEMS_BUCKET = 'map-gems';
/** Лимит бесплатных капсул на пользователя. */
export const FREE_MAP_GEM_LIMIT = 5;

export type MapGemType = 'photo' | 'video' | 'text';
export type MapGemSource = 'map_gems' | 'memory_gems';

export type MapGem = {
  id: string;
  /** Владелец: map_gems.author_id или memory_gems.user_id */
  author_id: string;
  lat: number;
  lng: number;
  type: MapGemType;
  media_url: string | null;
  content: string | null;
  created_at: string;
  source?: MapGemSource;
  is_private?: boolean;
  /** Полный список URL (memory_gems.media_urls). */
  media_urls?: string[] | null;
  /** Подпись / адрес (memory_gems.address). */
  description?: string | null;
};

export type CreateMapGemInput = {
  lat: number;
  lng: number;
  type: MapGemType;
  mediaUrl?: string | null;
  content?: string | null;
};

export type UpdateGemInput = {
  content?: string | null;
  description?: string | null;
  is_private?: boolean;
  mediaUrl?: string | null;
  mediaUrls?: string[] | null;
  type?: MapGemType;
};

export type UploadGemMediaResult = {
  mediaUrl: string;
  thumbUrl?: string;
};

const SELECT_COLS = 'id,author_id,lat,lng,type,media_url,content,created_at';

function mapRow(row: Record<string, unknown>): MapGem {
  return {
    id: String(row.id),
    author_id: String(row.author_id),
    lat: Number(row.lat),
    lng: Number(row.lng),
    type: row.type as MapGemType,
    media_url: (row.media_url as string | null) ?? null,
    content: (row.content as string | null) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    source: 'map_gems',
    is_private: false,
  };
}

/** URL превью для маркера карты: `-thumb.webp` рядом с полным файлом. */
export function gemMapPreviewUrl(gem: Pick<MapGem, 'media_url' | 'type'>): string | null {
  if (!gem.media_url || gem.type === 'text') return null;
  return thumbUrlFromMediaUrl(gem.media_url) || gem.media_url;
}

/**
 * Капсулы Family Mode: свои + контакты.
 * RLS demo открыт; фильтрация по author_id на клиенте.
 */
export async function fetchFamilyGems(authorIds: string[]): Promise<MapGem[]> {
  if (!hasSupabaseConfig() || authorIds.length === 0) return [];
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from(MAP_GEMS_TABLE)
      .select(SELECT_COLS)
      .in('author_id', authorIds)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.warn('[paranoic gems] fetch', error.message);
      return [];
    }
    return ((data as Record<string, unknown>[] | null) ?? []).map(mapRow);
  } catch (e) {
    console.warn('[paranoic gems] fetch failed', e);
    return [];
  }
}

/** Все капсулы из `map_gems` (при инициализации карты). */
export async function fetchAllMapGems(): Promise<MapGem[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from(MAP_GEMS_TABLE)
      .select(SELECT_COLS)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) {
      console.warn('[paranoic gems] fetch all', error.message);
      return [];
    }
    return ((data as Record<string, unknown>[] | null) ?? []).map(mapRow);
  } catch (e) {
    console.warn('[paranoic gems] fetch all failed', e);
    return [];
  }
}

/** Число капсул текущего Auth-пользователя (author_id = auth.uid()). */
export async function countOwnMapGems(): Promise<number> {
  if (!hasSupabaseConfig()) return 0;
  try {
    const uid = await getAuthUserId();
    if (!uid) return 0;
    const sb = getSupabase();
    const { count, error } = await sb
      .from(MAP_GEMS_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('author_id', uid);
    if (error) {
      console.warn('[paranoic gems] count', error.message);
      return 0;
    }
    return count ?? 0;
  } catch (e) {
    console.warn('[paranoic gems] count failed', e);
    return 0;
  }
}

/**
 * Premium-флаг: profiles.is_premium (по auth.uid или локальному id)
 * либо localStorage `paranoic-premium-v1` = "1".
 */
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

/** true, если бесплатный лимит исчерпан и нет Premium. */
export async function isFreeGemLimitReached(): Promise<boolean> {
  if (await isPremiumUser()) return false;
  const count = await countOwnMapGems();
  return count >= FREE_MAP_GEM_LIMIT;
}

/**
 * Тексты капсул, видимых на карте (для тихого [Контекст обстановки] ИИ).
 */
export function buildVisibleGemsContext(
  gems: MapGem[],
  opts: {
    showGems: boolean;
    inBounds?: (lat: number, lng: number) => boolean;
  }
): string {
  if (!opts.showGems) {
    return '(слой «Капсулы памяти» скрыт — на экране нет маркеров map_gems)';
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

/**
 * INSERT в map_gems.
 * `author_id` строго из session.user.id (не локальный профиль).
 */
export async function createMapGem(input: CreateMapGemInput): Promise<MapGem> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');

  const sb = getSupabase();
  const {
    data: { session: rawSession },
  } = await sb.auth.getSession();

  const session =
    rawSession?.user?.id != null ? rawSession : await ensureAuthSession();

  const authorId = session.user.id;
  if (!authorId) {
    throw new Error('Сессия Auth отсутствует: нет session.user.id');
  }

  const row = {
    author_id: authorId,
    lat: input.lat,
    lng: input.lng,
    type: input.type,
    media_url: input.mediaUrl ?? null,
    content: input.content ?? null,
  };

  const { data, error } = await sb
    .from(MAP_GEMS_TABLE)
    .insert(row)
    .select(SELECT_COLS)
    .single();

  if (error) {
    const msg = error.message || 'Не удалось сохранить капсулу';
    if (/Auth session missing|session/i.test(msg)) {
      throw new Error('Сессия Auth отсутствует. Обновите страницу и сохраните капсулу снова.');
    }
    if (/row-level security|RLS/i.test(msg)) {
      throw new Error(
        'RLS блокирует запись. Проверьте политику map_gems INSERT (author_id = auth.uid()).'
      );
    }
    throw new Error(msg);
  }
  return mapRow(data as Record<string, unknown>);
}

/**
 * Загрузка фото/видео капсулы в Cloudflare R2.
 * Изображения: ≤15 МБ до сжатия → WebP ≤1600px + thumb 256×256.
 */
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
    const wrapped = new Error(
      `uploadGemMedia failed (${file.type || 'unknown type'}, ${file.size} bytes): ${raw.message} | ${raw.stack ?? 'no stack'}`
    );
    wrapped.name = raw.name || 'GemUploadError';
    wrapped.stack = raw.stack;
    throw wrapped;
  }
}

/**
 * Удаляет капсулу: сначала объект(ы) в R2, затем строку map_gems.
 */
export async function deleteMapGem(gem: MapGem): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');

  const uid = await getAuthUserId();
  if (uid !== gem.author_id) {
    throw new Error('Можно удалить только свою капсулу');
  }

  const urls = [
    gem.media_url,
    ...(gem.media_urls ?? []),
  ].filter((u): u is string => Boolean(u));
  const unique = [...new Set(urls)];
  for (const url of unique) {
    try {
      await deleteGemMedia(url);
    } catch (e) {
      console.warn('[paranoic gems] media delete', url, e);
    }
  }

  const sb = getSupabase();
  const { error, data } = await sb
    .from(MAP_GEMS_TABLE)
    .delete()
    .eq('id', gem.id)
    .eq('author_id', uid)
    .select('id')
    .maybeSingle();

  if (error) {
    const msg = error.message || 'Не удалось удалить капсулу';
    if (/row-level security|RLS/i.test(msg)) {
      throw new Error(
        'RLS блокирует удаление. Проверьте политику map_gems DELETE (author_id = auth.uid()).'
      );
    }
    throw new Error(msg);
  }
  if (!data) {
    throw new Error('Капсула не найдена или уже удалена');
  }
}

/** Переместить пин map_gems. */
export async function updateMapGemLocation(
  gemId: string,
  lat: number,
  lng: number
): Promise<MapGem> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  await ensureAuthSession();
  const uid = await getAuthUserId();
  const sb = getSupabase();
  const { data, error } = await sb
    .from(MAP_GEMS_TABLE)
    .update({ lat, lng })
    .eq('id', gemId)
    .eq('author_id', uid)
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error(error.message || 'Не удалось переместить капсулу');
  return mapRow(data as Record<string, unknown>);
}

/** Редактировать контент / медиа map_gems. */
export async function updateMapGem(
  gemId: string,
  patch: UpdateGemInput
): Promise<MapGem> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  await ensureAuthSession();
  const uid = await getAuthUserId();
  const row: Record<string, unknown> = {};
  if (patch.content !== undefined) row.content = patch.content;
  if (patch.mediaUrl !== undefined) row.media_url = patch.mediaUrl;
  if (patch.type !== undefined) row.type = patch.type;
  if (Object.keys(row).length === 0) {
    throw new Error('Нет изменений');
  }
  const sb = getSupabase();
  const { data, error } = await sb
    .from(MAP_GEMS_TABLE)
    .update(row)
    .eq('id', gemId)
    .eq('author_id', uid)
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error(error.message || 'Не удалось сохранить капсулу');
  return mapRow(data as Record<string, unknown>);
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
      },
    })),
  };
}

export function formatGemTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
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
