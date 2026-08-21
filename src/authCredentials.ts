/**
 * Постоянная авторизация: реальный Email + пароль (Supabase Auth).
 * Username в profiles = local-part email (до @), после подтверждения почты.
 *
 * Confirm Email = ON: после signUp сессии нет → UI «проверьте почту».
 */

import {
  forcePersistSession,
  getOrCreateIdentity,
  normalizeUsername,
  updateIdentity,
  type UserIdentity,
} from './identity';
import {
  getSupabase,
  hasSupabaseConfig,
  markAuthBootstrapReady,
  pauseAuthBootstrap,
} from './lib/supabase';
import {
  bootstrapAuthProfile,
  fetchProfileByUsername,
  isUsernameAvailable,
  PROFILES_TABLE,
} from './profile';

export type AuthFailureReason =
  | 'user_not_found'
  | 'password_mismatch'
  | 'email_taken'
  | 'db_error'
  | 'invalid_input'
  | 'email_not_confirmed';

export type AuthResult =
  | { ok: true; identity: UserIdentity }
  | { ok: true; pendingConfirmation: true; email: string }
  | { ok: false; reason: AuthFailureReason; message: string; detail?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAuthEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidAuthEmail(raw: string): boolean {
  return EMAIL_RE.test(normalizeAuthEmail(raw));
}

/**
 * Логин из email: `user.name+tag@gmail.com` → нормализованный username для profiles.
 */
export function usernameFromEmail(email: string): string {
  const local = normalizeAuthEmail(email).split('@')[0] || '';
  let handle = normalizeUsername(local);
  if (!handle) {
    handle = normalizeUsername(local.replace(/[^a-zA-Z0-9_]+/g, '_')) || 'user';
  }
  if (handle.length < 3) {
    handle = `${handle}xx`.slice(0, 24);
  }
  if (!/^[a-z]/.test(handle)) {
    handle = `u${handle}`.slice(0, 24);
  }
  return handle.slice(0, 24);
}

/** Свободный username на базе email (при коллизии — суффикс). */
export async function resolveUsernameFromEmail(
  email: string,
  forUserId: string
): Promise<string> {
  const base = usernameFromEmail(email);
  if (await isUsernameAvailable(base, forUserId)) return base;
  for (let i = 0; i < 8; i++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${base.slice(0, 20)}${suffix}`.slice(0, 24);
    if (await isUsernameAvailable(candidate, forUserId)) return candidate;
  }
  return `${base.slice(0, 16)}${forUserId.replace(/-/g, '').slice(0, 8)}`.slice(0, 24);
}

function mapAuthError(
  message: string
): Pick<Extract<AuthResult, { ok: false }>, 'reason' | 'message'> {
  const m = message.toLowerCase();
  if (/email not confirmed|not confirmed|confirm your email/i.test(m)) {
    return {
      reason: 'email_not_confirmed',
      message:
        'Почта ещё не подтверждена. Перейдите по ссылке из письма или введите код.',
    };
  }
  if (/invalid login|invalid credentials|wrong password|user not found/i.test(m)) {
    return { reason: 'password_mismatch', message: 'Неверный email или пароль' };
  }
  if (/already registered|already been registered|user already/i.test(m)) {
    return { reason: 'email_taken', message: 'Этот email уже зарегистрирован' };
  }
  return { reason: 'db_error', message: message || 'Ошибка авторизации' };
}

async function finishAuthenticatedSession(
  session: import('@supabase/supabase-js').Session
): Promise<UserIdentity> {
  markAuthBootstrapReady(session);
  const userId = session.user.id;
  const email = session.user.email || '';
  const handle = email
    ? await resolveUsernameFromEmail(email, userId)
    : usernameFromEmail(`user${userId.slice(0, 8)}@local`);

  const existing = await fetchProfileByUsername(handle);
  const base = getOrCreateIdentity();
  const displayName =
    existing?.name?.trim() && existing.name !== 'Я'
      ? existing.name
      : base.name !== 'Я'
        ? base.name
        : handle;

  const next = forcePersistSession({
    ...base,
    id: userId,
    username: handle,
    name: displayName,
    color: existing?.color || base.color,
    avatarUrl: existing?.avatar_url || base.avatarUrl,
    themeFon: existing?.theme_fon || base.themeFon,
  });
  updateIdentity({
    username: next.username,
    name: next.name,
    color: next.color,
    avatarUrl: next.avatarUrl,
    themeFon: next.themeFon,
  });

  await bootstrapAuthProfile(userId, next, { email });

  const sb = getSupabase();
  const { error } = await sb.from(PROFILES_TABLE).upsert(
    {
      id: userId,
      username: handle,
      name: next.name,
      color: next.color,
      avatar_url: next.avatarUrl || null,
      theme_fon: next.themeFon || null,
      is_online: true,
      last_seen: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (error) {
    console.warn('[paranoic auth] profiles upsert after login', error.message);
  }

  return next;
}

/** Вход: signInWithPassword({ email, password }). */
export async function signInWithEmailPassword(
  emailRaw: string,
  password: string
): Promise<AuthResult> {
  if (!hasSupabaseConfig()) {
    return {
      ok: false,
      reason: 'db_error',
      message: 'Supabase не настроен — вход недоступен',
    };
  }

  const email = normalizeAuthEmail(emailRaw);
  if (!isValidAuthEmail(email)) {
    return { ok: false, reason: 'invalid_input', message: 'Введите корректный email' };
  }
  const pwd = password.trim();
  if (pwd.length < 4) {
    return { ok: false, reason: 'invalid_input', message: 'Пароль: минимум 4 символа' };
  }

  try {
    pauseAuthBootstrap(false);
    const sb = getSupabase();
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pwd });
    if (error || !data.session?.user?.id) {
      const mapped = mapAuthError(error?.message || 'Нет сессии');
      return { ok: false, ...mapped, detail: error?.message };
    }
    const identity = await finishAuthenticatedSession(data.session);
    console.log('[paranoic auth] signIn ok', {
      email,
      username: identity.username,
      userId: identity.id,
    });
    return { ok: true, identity };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[paranoic auth] signIn failed', detail);
    return { ok: false, reason: 'db_error', message: detail || 'Не удалось войти', detail };
  }
}

/**
 * Регистрация: signUp({ email, password }).
 * При Confirm Email = ON сессии нет → pendingConfirmation.
 */
export async function signUpWithEmailPassword(
  emailRaw: string,
  password: string
): Promise<AuthResult> {
  if (!hasSupabaseConfig()) {
    return {
      ok: false,
      reason: 'db_error',
      message: 'Supabase не настроен — регистрация недоступна',
    };
  }

  const email = normalizeAuthEmail(emailRaw);
  if (!isValidAuthEmail(email)) {
    return { ok: false, reason: 'invalid_input', message: 'Введите корректный email' };
  }
  const pwd = password.trim();
  if (pwd.length < 4) {
    return { ok: false, reason: 'invalid_input', message: 'Пароль: минимум 4 символа' };
  }

  try {
    pauseAuthBootstrap(false);
    const sb = getSupabase();
    const baseUsername = usernameFromEmail(email);
    const { data, error } = await sb.auth.signUp({
      email,
      password: pwd,
      options: {
        data: { username: baseUsername },
      },
    });
    if (error) {
      const mapped = mapAuthError(error.message);
      return { ok: false, ...mapped, detail: error.message };
    }

    // Confirm email включён: пользователь создан, сессии ещё нет.
    if (!data.session?.user?.id) {
      console.log('[paranoic auth] signUp pending email confirmation', { email });
      return { ok: true, pendingConfirmation: true, email };
    }

    const identity = await finishAuthenticatedSession(data.session);
    console.log('[paranoic auth] signUp ok', {
      email,
      username: identity.username,
      userId: identity.id,
    });
    return { ok: true, identity };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[paranoic auth] signUp failed', detail);
    return {
      ok: false,
      reason: 'db_error',
      message: detail || 'Не удалось создать аккаунт',
      detail,
    };
  }
}

/** @deprecated Используйте signInWithEmailPassword. */
export async function signInWithNicknamePassword(
  emailOrNick: string,
  password: string
): Promise<AuthResult> {
  return signInWithEmailPassword(emailOrNick, password);
}

/** @deprecated Используйте signUpWithEmailPassword. */
export async function signUpWithNicknamePassword(
  emailOrNick: string,
  password: string
): Promise<AuthResult> {
  return signUpWithEmailPassword(emailOrNick, password);
}

/** @deprecated */
export async function loginWithUsernamePassword(
  emailOrNick: string,
  password: string
): Promise<AuthResult> {
  return signInWithEmailPassword(emailOrNick, password);
}
