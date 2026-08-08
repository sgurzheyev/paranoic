import { getSupabase, hasSupabaseConfig } from './lib/supabase';
import {
  getOrCreateIdentity,
  isValidUuid,
  normalizeUsername,
  type UserIdentity,
} from './identity';

export const AVATARS_BUCKET = 'avatars';
export const PROFILES_TABLE = 'profiles';

export type RemoteProfile = {
  id: string;
  name: string;
  color: string;
  avatar_url: string | null;
  theme_fon: string | null;
  username: string | null;
  updated_at?: string;
  role?: string | null;
  is_banned?: boolean | null;
  created_at?: string | null;
};

const PROFILE_SELECT =
  'id,name,color,avatar_url,theme_fon,username,updated_at,role,is_banned,created_at';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_EDGE = 512;

function extFromMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}

/** Сжимает изображение до квадрата ≤512px (JPEG). */
export async function prepareAvatarBlob(file: File): Promise<{ blob: Blob; mime: string }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Нужно изображение');
  }
  if (file.size > MAX_AVATAR_BYTES * 3) {
    throw new Error('Файл слишком большой (макс. ~2 МБ после сжатия)');
  }

  const bitmap = await createImageBitmap(file);
  const size = Math.min(MAX_EDGE, Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Не удалось обработать изображение');
  }

  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.86)
  );
  if (!blob) throw new Error('Не удалось сжать изображение');
  if (blob.size > MAX_AVATAR_BYTES) {
    throw new Error('Аватар всё ещё слишком большой');
  }
  return { blob, mime: 'image/jpeg' };
}

/**
 * Загружает аватар в Supabase Storage (`avatars/{userId}/avatar.jpg`)
 * и возвращает публичный URL. При ошибке — data URL fallback.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const { blob, mime } = await prepareAvatarBlob(file);

  if (hasSupabaseConfig()) {
    try {
      const sb = getSupabase();
      const path = `${userId}/avatar.${extFromMime(mime)}`;
      const { error } = await sb.storage.from(AVATARS_BUCKET).upload(path, blob, {
        upsert: true,
        contentType: mime,
        cacheControl: '3600',
      });
      if (error) throw error;

      const { data } = sb.storage.from(AVATARS_BUCKET).getPublicUrl(path);
      return `${data.publicUrl}?t=${Date.now()}`;
    } catch (e) {
      console.warn('[paranoic] avatar upload failed, using data URL', e);
    }
  }

  return blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(blob);
  });
}

/** Проверка: username свободен или принадлежит этому id. */
export async function isUsernameAvailable(
  username: string,
  forUserId: string
): Promise<boolean> {
  if (!hasSupabaseConfig() || !username) return true;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from(PROFILES_TABLE)
      .select('id,username')
      .ilike('username', username)
      .maybeSingle();
    if (error) {
      console.warn('[paranoic] username check', error.message);
      return true; // не блокируем офлайн
    }
    if (!data) return true;
    return data.id === forUserId;
  } catch {
    return true;
  }
}

/** Стандартный UUID (с дефисами). Короткие id приложения сюда не попадают. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Upsert в таблицу `profiles` (если настроена). */
export async function syncProfileToSupabase(identity: UserIdentity): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    const username = identity.username || null;
    if (username) {
      const free = await isUsernameAvailable(username, identity.id);
      if (!free) throw new Error('Этот никнейм уже занят');
    }

    const sb = getSupabase();
    // Не трогаем role / is_banned / created_at — ими управляет админка.
    const row = {
      id: identity.id,
      name: identity.name,
      color: identity.color,
      avatar_url: identity.avatarUrl || null,
      theme_fon: identity.themeFon || null,
      username,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from(PROFILES_TABLE).upsert(row, { onConflict: 'id' });
    if (error) {
      if (/username|unique|duplicate/i.test(error.message)) {
        throw new Error('Этот никнейм уже занят');
      }
      console.warn('[paranoic] profiles upsert', error.message);
    }
  } catch (e) {
    if (e instanceof Error && /никнейм|username/i.test(e.message)) throw e;
    console.warn('[paranoic] profiles sync skipped', e);
  }
}

/**
 * Гарантирует строку в `profiles` перед INSERT в map_gems (FK author_id).
 * В upsert — только поля схемы БД (без локального UI: name/color/theme_fon).
 * `id` обязан быть UUID v4 (колонка uuid в Supabase).
 */
export async function ensureProfileRow(identity: UserIdentity): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');

  // Короткие legacy-id не отправляем — берём мигрированную identity.
  let id = identity.id?.trim() || '';
  let username = identity.username?.trim() || null;
  let avatarUrl = identity.avatarUrl || null;
  if (!isValidUuid(id)) {
    const fixed = getOrCreateIdentity();
    id = fixed.id;
    username = fixed.username?.trim() || null;
    avatarUrl = fixed.avatarUrl || null;
  }
  if (!isValidUuid(id)) {
    throw new Error('ID пользователя должен быть UUID. Обновите страницу.');
  }

  const sb = getSupabase();
  const row = {
    id,
    username,
    avatar_url: avatarUrl,
  };
  const { error } = await sb.from(PROFILES_TABLE).upsert(row, { onConflict: 'id' });
  if (error) {
    throw new Error(
      error.message.includes('username')
        ? 'Этот никнейм уже занят'
        : `Не удалось сохранить профиль: ${error.message}`
    );
  }
}

export async function fetchRemoteProfile(userId: string): Promise<RemoteProfile | null> {
  if (!hasSupabaseConfig()) return null;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from(PROFILES_TABLE)
      .select(PROFILE_SELECT)
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.warn('[paranoic] profiles fetch', error.message);
      return null;
    }
    return data as RemoteProfile | null;
  } catch {
    return null;
  }
}

/** Найти профиль по короткому username. */
export async function fetchProfileByUsername(
  username: string
): Promise<RemoteProfile | null> {
  if (!hasSupabaseConfig()) return null;
  const handle = normalizeUsername(username);
  if (!handle) return null;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from(PROFILES_TABLE)
      .select(PROFILE_SELECT)
      .ilike('username', handle)
      .maybeSingle();
    if (error) {
      console.warn('[paranoic] username lookup', error.message);
      return null;
    }
    return data as RemoteProfile | null;
  } catch {
    return null;
  }
}

/**
 * ?u=handle → реальный user id.
 * UUID → сразу id. Иначе — lookup `profiles.username`, затем короткий/legacy id.
 */
export async function resolveHandleToUserId(handle: string): Promise<string> {
  const raw = handle.trim();
  if (!raw) return raw;

  if (looksLikeUuid(raw)) {
    return raw;
  }

  // Не UUID → ищем по никнейму в profiles.
  const byUsername = await fetchProfileByUsername(raw);
  if (byUsername?.id) return byUsername.id;

  // Короткие id приложения / прямой id в profiles.
  const byId = await fetchRemoteProfile(raw);
  if (byId?.id) return byId.id;
  return raw;
}
