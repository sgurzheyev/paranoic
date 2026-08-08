import { getSupabase, hasSupabaseConfig } from './lib/supabase';

export const MAP_GEMS_TABLE = 'map_gems';
export const MAP_GEMS_BUCKET = 'map-gems';

export type MapGemType = 'photo' | 'video' | 'text';

export type MapGem = {
  id: string;
  author_id: string;
  lat: number;
  lng: number;
  type: MapGemType;
  media_url: string | null;
  content: string | null;
  created_at: string;
};

export type CreateMapGemInput = {
  authorId: string;
  lat: number;
  lng: number;
  type: MapGemType;
  mediaUrl?: string | null;
  content?: string | null;
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
  };
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

export async function createMapGem(input: CreateMapGemInput): Promise<MapGem> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  const sb = getSupabase();
  const row = {
    author_id: input.authorId,
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
  if (error) throw new Error(error.message || 'Не удалось сохранить капсулу');
  return mapRow(data as Record<string, unknown>);
}

/** Загрузка фото/видео капсулы в Storage. */
export async function uploadGemMedia(
  authorId: string,
  file: File
): Promise<string> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  const sb = getSupabase();
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const path = `${authorId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from(MAP_GEMS_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || 'application/octet-stream',
    cacheControl: '3600',
  });
  if (error) throw error;
  const { data } = sb.storage.from(MAP_GEMS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
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
