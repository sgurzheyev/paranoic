import {
  ensureAuthSession,
  getAuthUserId,
  getSupabase,
  hasSupabaseConfig,
} from './lib/supabase';
import {
  deleteMapGem,
  updateMapGem,
  updateMapGemLocation,
  type MapGem,
  type MapGemType,
  type UpdateGemInput,
} from './mapGems';
import { deleteGemMedia } from './s3Storage';

export const MEMORY_GEMS_TABLE = 'memory_gems';

export type MemoryGemRow = {
  id: string;
  title: string | null;
  address: string | null;
  media_urls: string[] | null;
  metadata: Record<string, unknown> | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
  user_id?: string | null;
  is_private?: boolean | null;
};

function mediaTypeFromUrl(url: string): MapGemType {
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return 'video';
  if (/\.(jpg|jpeg|png|webp|gif|heic)(\?|$)/i.test(url)) return 'photo';
  return 'photo';
}

function extractCoords(row: MemoryGemRow): { lat: number; lng: number } | null {
  if (row.lat != null && row.lng != null && Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
    return { lat: row.lat, lng: row.lng };
  }
  const meta = row.metadata;
  if (!meta || typeof meta !== 'object') return null;
  const lat = Number(meta.lat ?? meta.latitude);
  const lng = Number(meta.lng ?? meta.longitude ?? meta.lon ?? meta.long);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function mapMemoryGemRow(row: Record<string, unknown>): MapGem | null {
  const mediaUrls = Array.isArray(row.media_urls)
    ? row.media_urls.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : [];
  const preview = mediaUrls[0] ?? null;
  const coords = extractCoords({
    id: String(row.id),
    title: (row.title as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    media_urls: mediaUrls,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    user_id: (row.user_id as string | null) ?? null,
    is_private: (row.is_private as boolean | null) ?? false,
  });
  if (!coords) return null;

  const type: MapGemType = preview ? mediaTypeFromUrl(preview) : 'text';
  const title =
    (typeof row.title === 'string' && row.title.trim()) ||
    null;
  const address =
    (typeof row.address === 'string' && row.address.trim()) ||
    null;
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
    is_private: Boolean(row.is_private),
    media_urls: mediaUrls,
  };
}

/** Загрузка всех Memory GEMs из Supabase → MapGem для карты и drawer. */
export async function fetchMemoryGems(): Promise<MapGem[]> {
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
    const gems = rows.map(mapMemoryGemRow).filter((g): g is MapGem => g != null);
    console.log(`💎 Загружено ${gems.length} капсул памяти на карту`);
    return gems;
  } catch (e) {
    console.warn('[paranoic memory_gems] fetch failed', e);
    return [];
  }
}

export async function updateMemoryGemLocation(
  gemId: string,
  lat: number,
  lng: number
): Promise<MapGem> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  await ensureAuthSession();
  const uid = await getAuthUserId();
  const sb = getSupabase();
  const { data, error } = await sb
    .from(MEMORY_GEMS_TABLE)
    .update({ lat, lng })
    .eq('id', gemId)
    .eq('user_id', uid)
    .select('*')
    .single();
  if (error) throw new Error(error.message || 'Не удалось переместить капсулу');
  const mapped = mapMemoryGemRow(data as Record<string, unknown>);
  if (!mapped) throw new Error('Капсула без координат');
  return mapped;
}

export async function updateMemoryGem(
  gemId: string,
  patch: UpdateGemInput
): Promise<MapGem> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  await ensureAuthSession();
  const uid = await getAuthUserId();
  const row: Record<string, unknown> = {};
  if (patch.content !== undefined) row.title = patch.content;
  if (patch.description !== undefined) row.address = patch.description;
  if (patch.is_private !== undefined) row.is_private = patch.is_private;
  if (patch.mediaUrls !== undefined) row.media_urls = patch.mediaUrls;
  else if (patch.mediaUrl !== undefined) {
    row.media_urls = patch.mediaUrl ? [patch.mediaUrl] : [];
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

  const urls = [
    gem.media_url,
    ...(gem.media_urls ?? []),
  ].filter((u): u is string => Boolean(u));
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

/** Удаление с учётом источника (map_gems / memory_gems). */
export async function deleteOwnedGem(gem: MapGem): Promise<void> {
  if (gem.source === 'memory_gems') {
    await deleteMemoryGem(gem);
    return;
  }
  await deleteMapGem(gem);
}

/** Перемещение пина. */
export async function moveOwnedGem(
  gem: MapGem,
  lat: number,
  lng: number
): Promise<MapGem> {
  if (gem.source === 'memory_gems') {
    return updateMemoryGemLocation(gem.id, lat, lng);
  }
  return updateMapGemLocation(gem.id, lat, lng);
}

/** Редактирование полей капсулы. */
export async function updateOwnedGem(
  gem: MapGem,
  patch: UpdateGemInput
): Promise<MapGem> {
  if (gem.source === 'memory_gems') {
    return updateMemoryGem(gem.id, patch);
  }
  return updateMapGem(gem.id, patch);
}
