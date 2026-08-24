/**
 * Постоянная авторизация: Email/пароль + Google OAuth (Supabase Auth).
 * Username в profiles = local-part email (до @).
 * Имя: user_metadata.full_name (Google) или email.
 */

import type { Session, User } from '@supabase/supabase-js';
import {
  forcePersistSession,
  getOrCreateIdentity,
  normalizeUsername,
  updateIdentity,
  validateUsername,
  type UserIdentity,
} from './identity';
import {
  clearPasswordRecoveryPending,
  getSupabase,
  hasSupabaseConfig,
  markAuthBootstrapReady,
  pauseAuthBootstrap,
} from './lib/supabase';
import {
  bootstrapAuthProfile,
  fetchRemoteProfile,
  isUsernameAvailable,
  PROFILES_TABLE,
} from './profile';

export type AuthFailureReason =
  | 'user_not_found'
  | 'password_mismatch'
  | 'email_taken'
  | 'username_taken'
  | 'db_error'
  | 'invalid_input'
  | 'email_not_confirmed'
  | 'oauth_error';

export type AuthResult =
  | { ok: true; identity: UserIdentity }
  | { ok: true; pendingConfirmation: true; email: string }
  | { ok: true; oauthRedirect: true }
  | { ok: false; reason: AuthFailureReason; message: string; detail?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAuthEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidAuthEmail(raw: string): boolean {
  return EMAIL_RE.test(normalizeAuthEmail(raw));
}

/** Имя из Google / OAuth metadata или email. */
export function displayNameFromAuthUser(user: User): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = String(meta.full_name ?? meta.name ?? '').trim();
  if (fullName) return fullName;
  const email = user.email?.trim();
  if (email) {
    const local = email.split('@')[0]?.trim();
    if (local) return local;
  }
  return 'New User';
}

/** Аватар из Google metadata (avatar_url / picture). */
export function avatarUrlFromAuthUser(user: User): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return String(meta.avatar_url ?? meta.picture ?? '').trim();
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

function isUsernameConflictError(message: string): boolean {
  return /username|unique|duplicate|already exists/i.test(message);
}

/** После email/OAuth: identity + upsert profiles. */
export async function finishAuthenticatedSession(
  session: Session,
  opts?: { preferredUsername?: string }
): Promise<UserIdentity> {
  markAuthBootstrapReady(session);
  const user = session.user;
  const userId = user.id;
  const email = user.email || '';
  const handle = opts?.preferredUsername?.trim()
    ? normalizeUsername(opts.preferredUsername)
    : email
      ? await resolveUsernameFromEmail(email, userId)
      : usernameFromEmail(`user${userId.slice(0, 8)}@local`);

  const existing = await fetchRemoteProfile(userId);
  const base = getOrCreateIdentity();
  const oauthName = displayNameFromAuthUser(user);
  const oauthAvatar = avatarUrlFromAuthUser(user);

  const displayName =
    existing?.name?.trim() && existing.name !== 'Я' && existing.name !== 'New User'
      ? existing.name
      : oauthName !== 'New User'
        ? oauthName
        : base.name !== 'Я'
          ? base.name
          : handle;

  const next = forcePersistSession({
    ...base,
    id: userId,
    username: handle,
    name: displayName,
    color: existing?.color || base.color,
    avatarUrl: existing?.avatar_url || oauthAvatar || base.avatarUrl,
    themeFon: existing?.theme_fon || base.themeFon,
  });
  updateIdentity({
    username: next.username,
    name: next.name,
    color: next.color,
    avatarUrl: next.avatarUrl,
    themeFon: next.themeFon,
  });

  await bootstrapAuthProfile(userId, next, {
    email,
    fullName: oauthName,
    avatarUrl: oauthAvatar || null,
  });

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
 * Регистрация: signUp({ email, password }) + profiles.username = nickname.
 */
export async function signUpWithEmailPassword(
  emailRaw: string,
  password: string,
  nicknameRaw: string
): Promise<AuthResult> {
  if (!hasSupabaseConfig()) {
    return {
      ok: false,
      reason: 'db_error',
      message: 'Supabase не настроен — регистрация недоступна',
    };
  }

  const nickCheck = validateUsername(nicknameRaw);
  if (!nickCheck.ok) {
    return { ok: false, reason: 'invalid_input', message: nickCheck.error };
  }
  const nickname = nickCheck.value;
  if (!nickname) {
    return { ok: false, reason: 'invalid_input', message: 'Введите уникальный никнейм' };
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
    const free = await isUsernameAvailable(nickname, '');
    if (!free) {
      return {
        ok: false,
        reason: 'username_taken',
        message: 'Этот никнейм уже занят, придумайте другой',
      };
    }

    pauseAuthBootstrap(false);
    const sb = getSupabase();
    const { data, error } = await sb.auth.signUp({
      email,
      password: pwd,
      options: {
        data: { username: nickname },
      },
    });
    if (error) {
      const mapped = mapAuthError(error.message);
      return { ok: false, ...mapped, detail: error.message };
    }

    if (!data.session?.user?.id) {
      console.log('[paranoic auth] signUp pending email confirmation', { email });
      return { ok: true, pendingConfirmation: true, email };
    }

    const userId = data.session.user.id;
    const { error: profileErr } = await sb.from(PROFILES_TABLE).upsert(
      {
        id: userId,
        username: nickname,
        name: nickname,
        is_online: true,
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
    if (profileErr) {
      if (isUsernameConflictError(profileErr.message)) {
        return {
          ok: false,
          reason: 'username_taken',
          message: 'Этот никнейм уже занят, придумайте другой',
          detail: profileErr.message,
        };
      }
      return {
        ok: false,
        reason: 'db_error',
        message: profileErr.message || 'Не удалось создать профиль',
        detail: profileErr.message,
      };
    }

    const identity = await finishAuthenticatedSession(data.session, {
      preferredUsername: nickname,
    });
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

/** Google OAuth — редирект на провайдера, профиль создаётся после возврата. */
export async function signInWithGoogleOAuth(): Promise<AuthResult> {
  if (!hasSupabaseConfig()) {
    return {
      ok: false,
      reason: 'db_error',
      message: 'Supabase не настроен — вход через Google недоступен',
    };
  }
  try {
    pauseAuthBootstrap(false);
    const sb = getSupabase();
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) {
      console.error('[paranoic auth] Google OAuth', error.message);
      return {
        ok: false,
        reason: 'oauth_error',
        message: error.message || 'Не удалось открыть Google',
        detail: error.message,
      };
    }
    return { ok: true, oauthRedirect: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[paranoic auth] Google OAuth failed', detail);
    return {
      ok: false,
      reason: 'oauth_error',
      message: detail || 'Не удалось войти через Google',
      detail,
    };
  }
}

/** Запрос ссылки для сброса пароля на email. */
export async function requestPasswordReset(
  emailRaw: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!hasSupabaseConfig()) {
    return {
      ok: false,
      message: 'Supabase не настроен — восстановление пароля недоступно',
    };
  }

  const email = normalizeAuthEmail(emailRaw);
  if (!isValidAuthEmail(email)) {
    return { ok: false, message: 'Введите корректный email' };
  }

  try {
    const sb = getSupabase();
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) {
      return { ok: false, message: error.message || 'Не удалось отправить ссылку для сброса' };
    }
    return { ok: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[paranoic auth] password reset failed', detail);
    return { ok: false, message: detail || 'Не удалось отправить ссылку для сброса' };
  }
}

/** Сохранение нового пароля после перехода по ссылке из письма (PASSWORD_RECOVERY). */
export async function completePasswordReset(passwordRaw: string): Promise<AuthResult> {
  if (!hasSupabaseConfig()) {
    return {
      ok: false,
      reason: 'db_error',
      message: 'Supabase не настроен — восстановление пароля недоступно',
    };
  }
  const pwd = passwordRaw.trim();
  if (pwd.length < 4) {
    return { ok: false, reason: 'invalid_input', message: 'Пароль: минимум 4 символа' };
  }
  try {
    const sb = getSupabase();
    const { error } = await sb.auth.updateUser({ password: pwd });
    if (error) {
      return { ok: false, reason: 'db_error', message: error.message || 'Не удалось сохранить пароль' };
    }
    const { data, error: sessionErr } = await sb.auth.getSession();
    if (sessionErr || !data.session?.user?.id) {
      return {
        ok: false,
        reason: 'db_error',
        message: sessionErr?.message || 'Войдите с новым паролем',
      };
    }
    clearPasswordRecoveryPending();
    try {
      const path = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState({}, document.title, path.split('#')[0] || '/');
    } catch {
      /* ignore */
    }
    const identity = await finishAuthenticatedSession(data.session);
    return { ok: true, identity };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: 'db_error', message: detail || 'Не удалось сохранить пароль' };
  }
}

/** @deprecated */
export async function signInWithNicknamePassword(
  emailOrNick: string,
  password: string
): Promise<AuthResult> {
  return signInWithEmailPassword(emailOrNick, password);
}

/** @deprecated */
export async function signUpWithNicknamePassword(
  emailOrNick: string,
  password: string,
  nickname?: string
): Promise<AuthResult> {
  return signUpWithEmailPassword(emailOrNick, password, nickname ?? emailOrNick);
}

/** @deprecated */
export async function loginWithUsernamePassword(
  emailOrNick: string,
  password: string
): Promise<AuthResult> {
  return signInWithEmailPassword(emailOrNick, password);
}
