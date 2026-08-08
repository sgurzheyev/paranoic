import {
  ensureAuthSession,
  getSupabase,
  getSupabaseConfig,
  hasSupabaseConfig,
} from './lib/supabase';

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

/**
 * Тексты капсул, видимых на карте (для тихого [Контекст обстановки] ИИ).
 */
export function buildVisibleGemsContext(
  gems: MapGem[],
  opts: {
    showGems: boolean;
    /** Если есть bounds карты — только маркеры во вьюпорте. */
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
 * Профиль на клиенте не трогаем.
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
 * Загрузка фото/видео в Storage (`map-gems`) с прогрессом (XHR).
 * Путь и JWT — только из Auth session.
 */
export async function uploadGemMedia(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<string> {
  const cfg = getSupabaseConfig();
  if (!cfg) throw new Error('Supabase не настроен');

  const sb = getSupabase();
  const {
    data: { session: rawSession },
  } = await sb.auth.getSession();
  const session =
    rawSession?.user?.id != null ? rawSession : await ensureAuthSession();

  const uid = session.user.id;
  const accessToken = session.access_token;
  if (!uid || !accessToken) {
    throw new Error('Сессия Auth отсутствует. Обновите страницу и попробуйте снова.');
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const endpoint = `${cfg.url.replace(/\/$/, '')}/storage/v1/object/${MAP_GEMS_BUCKET}/${path}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('apikey', cfg.anonKey);
    xhr.setRequestHeader('x-upsert', 'false');
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);

    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      onProgress?.(Math.min(1, ev.loaded / Math.max(1, ev.total)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      let message = `Ошибка загрузки (${xhr.status})`;
      try {
        const parsed = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        message = parsed.message || parsed.error || message;
      } catch {
        /* */
      }
      if (/row-level security|policy|RLS|403|401/i.test(message) || xhr.status === 403) {
        reject(
          new Error(
            'Storage RLS блокирует upload. Нужна политика INSERT для authenticated на bucket map-gems.'
          )
        );
        return;
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Сеть оборвалась при загрузке'));
    xhr.send(file);
  });

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
