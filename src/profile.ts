import { getSupabase, hasSupabaseConfig } from './lib/supabase';
import { hashPassword, passwordsMatch } from './passwordAuth';
import {
  createUserId,
  getOrCreateIdentity,
  isValidUuid,
  looksLikeUsername,
  normalizeUsername,
  restoreIdentityFromProfile,
  type UserIdentity,
} from './identity';
import { hasR2Config, uploadToR2, buildObjectKey } from './s3Storage';

export const AVATARS_BUCKET = 'avatars';
export const PROFILES_TABLE = 'profiles';

export type RemoteProfile = {
  id: string;
  name: string;
  color: string;
  avatar_url: string | null;
  theme_fon: string | null;
  username: string | null;
  password?: string | null;
  role?: string | null;
  is_banned?: boolean | null;
};

export type SyncProfileOptions = {
  /** Новый пароль — хэшируется и сохраняется в profiles.password. */
  password?: string;
};

/** Публичные поля profiles (magic link / lookup — без password). */
export const PROFILE_PUBLIC_COLUMNS =
  'id,name,color,avatar_url,theme_fon,username,role,is_banned';

/** Колонки profiles в production Supabase (включая password для входа). */
export const PROFILE_COLUMNS = `${PROFILE_PUBLIC_COLUMNS},password`;

const PROFILE_SELECT = PROFILE_PUBLIC_COLUMNS;

/** Прочитать сохранённый пароль из строки profiles (колонка `password`). */
export function readStoredPassword(row: Record<string, unknown> | RemoteProfile): string {
  const raw = row.password;
  return typeof raw === 'string' ? raw.trim() : '';
}

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
 * Загружает аватар в Cloudflare R2 (`avatars/{userId}/avatar.jpg`)
 * и возвращает публичный URL. При ошибке — data URL fallback.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const { blob, mime } = await prepareAvatarBlob(file);

  if (hasR2Config()) {
    try {
      const key = buildObjectKey('avatars', userId, `avatar.${extFromMime(mime)}`, {
        fixedName: 'avatar',
      });
      const url = await uploadToR2({
        key,
        body: blob,
        contentType: mime,
        cacheControl: 'public, max-age=3600',
      });
      return `${url}?t=${Date.now()}`;
    } catch (e) {
      console.warn('[paranoic] R2 avatar upload failed, using data URL', e);
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
    const row: Record<string, unknown> = {
      id: identity.id,
      name: identity.name,
      color: identity.color,
      avatar_url: identity.avatarUrl || null,
      theme_fon: identity.themeFon || null,
      username,
    };
    if (opts?.password?.trim()) {
      row.password = await hashPassword(opts.password);
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

/** Найти профиль по username — SELECT в public.profiles. */
export async function fetchProfileByUsername(
  username: string
): Promise<RemoteProfile | null> {
  if (!hasSupabaseConfig()) return null;
  const handle = normalizeUsername(username.replace(/^@+/, ''));
  if (!handle) return null;
  try {
    const sb = getSupabase();

    const { data: exact, error: exactErr } = await sb
      .from(PROFILES_TABLE)
      .select(PROFILE_PUBLIC_COLUMNS)
      .eq('username', handle)
      .maybeSingle();
    if (exactErr) {
      console.warn('[paranoic] username lookup (eq)', exactErr.message);
    } else if (exact) {
      return exact as RemoteProfile;
    }

    const { data: fuzzy, error: fuzzyErr } = await sb
      .from(PROFILES_TABLE)
      .select(PROFILE_PUBLIC_COLUMNS)
      .ilike('username', handle)
      .maybeSingle();
    if (fuzzyErr) {
      console.warn('[paranoic] username lookup (ilike)', fuzzyErr.message);
      return null;
    }
    return (fuzzy as RemoteProfile | null) ?? null;
  } catch (e) {
    console.warn('[paranoic] username lookup failed', e);
    return null;
  }
}

/**
 * ?u=handle → профиль из Supabase.
 * Username всегда резолвится через SELECT; UUID — по id.
 */
export async function resolveMagicLinkProfile(
  rawHandle: string
): Promise<RemoteProfile | null> {
  const raw = rawHandle.trim().replace(/^@+/, '');
  if (!raw) return null;

  if (looksLikeUuid(raw) || isValidUuid(raw)) {
    return fetchRemoteProfile(raw);
  }

  const normalized = normalizeUsername(raw);
  if (normalized) {
    const byUsername = await fetchProfileByUsername(normalized);
    if (byUsername?.id) {
      console.log('[paranoic] magic link resolved username', {
        handle: raw,
        userId: byUsername.id,
      });
      return byUsername;
    }
  }

  const byId = await fetchRemoteProfile(raw);
  if (byId?.id) {
    console.log('[paranoic] magic link resolved id', { handle: raw, userId: byId.id });
    return byId;
  }

  console.warn('[paranoic] magic link profile not found', { handle: raw });
  return null;
}

/**
 * ?u=handle → реальный user id.
 * Username → обязательный SELECT в profiles; не угадываем inbox по строке.
 */
export async function resolveHandleToUserId(handle: string): Promise<string | null> {
  const raw = handle.trim().replace(/^@+/, '');
  if (!raw) return null;

  const profile = await resolveMagicLinkProfile(raw);
  if (profile?.id) return profile.id;

  // Legacy peer id (не username): длинный id без строки в profiles.
  if (!looksLikeUsername(raw) && !normalizeUsername(raw) && raw.length >= 8) {
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

async function hashPasswordForLogin(password: string): Promise<string> {
  return hashPassword(password, { minLength: 1 });
}

/** SELECT profiles WHERE username = handle (вход — с password). */
async function fetchProfileRowByUsername(
  handle: string
): Promise<{ row: RemoteProfile | null; dbError: string | null }> {
  const profile = await fetchProfileByUsername(handle);
  if (profile) {
    const sb = getSupabase();
    const { data, error } = await sb
      .from(PROFILES_TABLE)
      .select(PROFILE_COLUMNS)
      .eq('id', profile.id)
      .maybeSingle();
    if (error) {
      console.error('[paranoic login] SELECT password', { username: handle, message: error.message });
      return { row: profile, dbError: null };
    }
    return { row: (data as RemoteProfile | null) ?? profile, dbError: null };
  }

  const normalized = normalizeUsername(handle);
  if (!normalized) return { row: null, dbError: null };

  const sb = getSupabase();
  const { data, error } = await sb
    .from(PROFILES_TABLE)
    .select(PROFILE_COLUMNS)
    .eq('username', normalized)
    .maybeSingle();

  if (error) {
    console.error('[paranoic login] SELECT profiles', { username: handle, message: error.message });
    return { row: null, dbError: error.message };
  }
  return { row: (data as RemoteProfile | null) ?? null, dbError: null };
}

function finishLogin(row: RemoteProfile): LoginResult {
  const identity = restoreIdentityFromProfile(row);
  console.log('[paranoic login] success', { username: row.username, userId: identity.id });
  return { ok: true, identity };
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
  const pwd = password.trim();
  if (!handle) {
    return { ok: false, reason: 'invalid_input', message: 'Введите никнейм' };
  }
  if (!pwd) {
    return { ok: false, reason: 'invalid_input', message: 'Введите пароль' };
  }

  const sb = getSupabase();

  try {
    const { row, dbError } = await fetchProfileRowByUsername(handle);
    if (dbError) {
      return {
        ok: false,
        reason: 'db_error',
        message: 'Ошибка базы данных при входе',
        detail: dbError,
      };
    }

    // 1. Профиля нет — создаём
    if (!row) {
      const id = createUserId();
      const passwordStored = await hashPasswordForLogin(pwd);
      const { data: created, error: insertErr } = await sb
        .from(PROFILES_TABLE)
        .insert({
          id,
          username: handle,
          name: handle,
          password: passwordStored,
          color: getOrCreateIdentity().color,
        })
        .select(PROFILE_COLUMNS)
        .single();

      if (insertErr || !created) {
        console.error('[paranoic login] INSERT profile', insertErr?.message);
        return {
          ok: false,
          reason: 'db_error',
          message: insertErr?.message || 'Не удалось создать профиль',
        };
      }
      return finishLogin(created as RemoteProfile);
    }

    const storedPassword = readStoredPassword(row);

    // 2. Профиль есть, пароль пустой — записываем
    if (!storedPassword) {
      const passwordStored = await hashPasswordForLogin(pwd);
      const { data: updated, error: updateErr } = await sb
        .from(PROFILES_TABLE)
        .update({ password: passwordStored })
        .eq('id', row.id)
        .select(PROFILE_COLUMNS)
        .single();

      if (updateErr || !updated) {
        console.error('[paranoic login] UPDATE password', updateErr?.message);
        return {
          ok: false,
          reason: 'db_error',
          message: updateErr?.message || 'Не удалось сохранить пароль',
        };
      }
      return finishLogin(updated as RemoteProfile);
    }

    // 3. Профиль есть, пароль задан — сверяем
    const matches = await passwordsMatch(pwd, storedPassword);
    if (!matches) {
      return {
        ok: false,
        reason: 'password_mismatch',
        message: 'Неверный пароль',
      };
    }

    return finishLogin(row);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[paranoic login] unexpected error', detail);
    return {
      ok: false,
      reason: 'db_error',
      message: detail || 'Не удалось войти',
      detail,
    };
  }
}
