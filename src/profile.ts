import { getSupabase, hasSupabaseConfig } from './lib/supabase';
import { hashPassword, verifyPassword } from './passwordAuth';
import {
  getOrCreateIdentity,
  isValidUuid,
  looksLikeUsername,
  normalizeUsername,
  restoreIdentityFromProfile,
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
  password_hash?: string | null;
  updated_at?: string;
  role?: string | null;
  is_banned?: boolean | null;
  created_at?: string | null;
};

export type SyncProfileOptions = {
  /** Новый пароль — хэшируется и сохраняется в password_hash. */
  password?: string;
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

/** Бросает «Имя занято», если username уже есть у другого пользователя. */
export async function assertUsernameAvailable(
  username: string,
  forUserId: string
): Promise<void> {
  if (!username) return;
  const free = await isUsernameAvailable(username, forUserId);
  if (!free) throw new Error('Имя занято');
}

/** Стандартный UUID (с дефисами). Короткие id приложения сюда не попадают. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Upsert в таблицу `profiles` (если настроена). */
export async function syncProfileToSupabase(
  identity: UserIdentity,
  opts?: SyncProfileOptions
): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    const username = identity.username || null;
    if (username) {
      const free = await isUsernameAvailable(username, identity.id);
      if (!free) throw new Error('Имя занято');
    }

    const sb = getSupabase();
    // Не трогаем role / is_banned / created_at — ими управляет админка.
    const row: Record<string, unknown> = {
      id: identity.id,
      name: identity.name,
      color: identity.color,
      avatar_url: identity.avatarUrl || null,
      theme_fon: identity.themeFon || null,
      username,
      updated_at: new Date().toISOString(),
    };
    if (opts?.password?.trim()) {
      row.password_hash = await hashPassword(opts.password);
    }
    const { error } = await sb.from(PROFILES_TABLE).upsert(row, { onConflict: 'id' });
    if (error) {
      if (/username|unique|duplicate/i.test(error.message)) {
        throw new Error('Имя занято');
      }
      if (opts?.password?.trim()) {
        throw new Error(`Не удалось сохранить пароль: ${error.message}`);
      }
      console.warn('[paranoic] profiles upsert', error.message);
    }
  } catch (e) {
    if (e instanceof Error && /никнейм|username/i.test(e.message)) throw e;
    console.warn('[paranoic] profiles sync skipped', e);
  }
}

/**
 * Гарантирует строку в `profiles` (id / username / avatar_url).
 * Не вызывать при Drop a Gem — профиль создаёт триггер Auth / регистрация.
 * @deprecated Для капсул используйте auth.uid() без upsert profiles.
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
        ? 'Имя занято'
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
 * UUID / legacy id → id (даже без строки в profiles).
 * Username → lookup в profiles; не найден → null (нельзя угадать inbox).
 */
export async function resolveHandleToUserId(handle: string): Promise<string | null> {
  const raw = handle.trim();
  if (!raw) return null;

  // UUID — всегда валидный peer id (профиль в Supabase не обязателен).
  if (looksLikeUuid(raw) || isValidUuid(raw)) {
    console.log('[P2P_DEBUG] resolve uuid', { handle: raw });
    return raw;
  }

  // Не UUID → ищем по никнейму в profiles.
  const byUsername = await fetchProfileByUsername(raw);
  if (byUsername?.id) {
    console.log('[P2P_DEBUG] resolve username', { handle: raw, userId: byUsername.id });
    return byUsername.id;
  }

  // Прямой id в profiles (короткий/legacy).
  const byId = await fetchRemoteProfile(raw);
  if (byId?.id) {
    console.log('[P2P_DEBUG] resolve id', { handle: raw, userId: byId.id });
    return byId.id;
  }

  // Не похоже на username — это peer id без строки profiles (офлайн-гость / legacy).
  if (!looksLikeUsername(raw) && raw.length >= 8) {
    console.log('[P2P_DEBUG] resolve legacy peer id', { handle: raw });
    return raw;
  }

  console.warn('[P2P_DEBUG] resolve failed — user not found', { handle: raw });
  return null;
}

/** Вход: username + password → восстановление user_id и профиля. */
export type LoginFailureReason =
  | 'user_not_found'
  | 'no_password_set'
  | 'password_mismatch'
  | 'db_error'
  | 'invalid_input';

export type LoginResult =
  | { ok: true; identity: UserIdentity }
  | { ok: false; reason: LoginFailureReason; message: string; detail?: string };

async function fetchLoginProfile(
  handle: string
): Promise<{ row: RemoteProfile | null; dbError: string | null }> {
  const sb = getSupabase();

  try {
    const { data, error } = await sb.rpc('login_profile_by_username', {
      p_username: handle,
    });
    if (!error && data) {
      const row = (Array.isArray(data) ? data[0] : data) as RemoteProfile | undefined;
      if (row?.id) {
        console.log('[paranoic login] profile via RPC', { username: handle, userId: row.id });
        return { row, dbError: null };
      }
    }
    if (error) {
      console.warn('[paranoic login] RPC login_profile_by_username failed — fallback to SELECT', {
        code: error.code,
        message: error.message,
      });
    }
  } catch (e) {
    console.warn('[paranoic login] RPC exception — fallback to SELECT', e);
  }

  const selectCols = `${PROFILE_SELECT},password_hash`;
  const queries = [
    () => sb.from(PROFILES_TABLE).select(selectCols).eq('username', handle).maybeSingle(),
    () => sb.from(PROFILES_TABLE).select(selectCols).ilike('username', handle).maybeSingle(),
  ];

  for (const run of queries) {
    const { data, error } = await run();
    if (error) {
      console.error('[paranoic login] DB SELECT error', {
        username: handle,
        code: error.code,
        message: error.message,
      });
      return { row: null, dbError: error.message };
    }
    if (data) {
      console.log('[paranoic login] profile via SELECT', { username: handle, userId: data.id });
      return { row: data as RemoteProfile, dbError: null };
    }
  }

  return { row: null, dbError: null };
}

export async function loginWithUsernamePassword(
  username: string,
  password: string
): Promise<LoginResult> {
  if (!hasSupabaseConfig()) {
    return {
      ok: false,
      reason: 'db_error',
      message: 'Supabase не настроен — вход недоступен',
    };
  }

  const handle = normalizeUsername(username);
  if (!handle) {
    return { ok: false, reason: 'invalid_input', message: 'Введите никнейм' };
  }
  if (!password.trim()) {
    return { ok: false, reason: 'invalid_input', message: 'Введите пароль' };
  }

  try {
    const { row, dbError } = await fetchLoginProfile(handle);

    if (dbError) {
      return {
        ok: false,
        reason: 'db_error',
        message: 'Ошибка базы данных при входе. Проверьте Supabase и RLS.',
        detail: dbError,
      };
    }

    if (!row) {
      console.error('[paranoic login] User not found in DB', { username: handle });
      return {
        ok: false,
        reason: 'user_not_found',
        message: `Аккаунт @${handle} не найден. Создайте профиль заново: задайте никнейм и пароль в настройках.`,
      };
    }

    if (!row.password_hash?.trim()) {
      console.error('[paranoic login] User found but password_hash is empty', {
        username: handle,
        userId: row.id,
      });
      return {
        ok: false,
        reason: 'no_password_set',
        message: `У @${handle} ещё нет пароля. Откройте Paranoic Mode → Профиль → задайте пароль и сохраните.`,
      };
    }

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
      console.error('[paranoic login] Password mismatch', { username: handle, userId: row.id });
      return {
        ok: false,
        reason: 'password_mismatch',
        message: 'Неверный пароль для этого никнейма.',
      };
    }

    const identity = restoreIdentityFromProfile(row);
    console.log('[paranoic login] success', { username: handle, userId: identity.id });
    return { ok: true, identity };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[paranoic login] unexpected error', detail);
    if (e instanceof Error && e.message.includes('Supabase')) {
      return { ok: false, reason: 'db_error', message: e.message, detail };
    }
    return {
      ok: false,
      reason: 'db_error',
      message: 'Не удалось войти. Смотрите консоль для деталей.',
      detail,
    };
  }
}
