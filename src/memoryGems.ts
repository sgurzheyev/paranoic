import { getSupabase, hasSupabaseConfig } from './lib/supabase';
import type { MapGem, MapGemType } from './mapGems';

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

function mapMemoryGemRow(row: Record<string, unknown>): MapGem | null {
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
  });
  if (!coords) return null;

  const type: MapGemType = preview ? mediaTypeFromUrl(preview) : 'text';
  const content =
    (typeof row.title === 'string' && row.title.trim()) ||
    (typeof row.address === 'string' && row.address.trim()) ||
    null;

  return {
    id: String(row.id),
    author_id: String(
      (row.metadata as Record<string, unknown> | null)?.author_id ??
        (row.metadata as Record<string, unknown> | null)?.user_id ??
        'memory-gem'
    ),
    lat: coords.lat,
    lng: coords.lng,
    type,
    media_url: preview,
    content,
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

/** Загрузка всех Memory GEMs из Supabase → MapGem для карты и drawer. */
export async function fetchMemoryGems(): Promise<MapGem[]> {
  if (!hasSupabaseConfig()) return [];
  try {
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
