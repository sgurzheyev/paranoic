import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import {
  alignIdentityToAuthUidDetailed,
  clearLocalIdentityData,
  createFreshIdentity,
  getOrCreateIdentity,
  type UserIdentity,
} from '../identity';
import { clearCallSessionResidue, clearEphemeralGuestId } from '../callSessionCleanup';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

export function hasSupabaseConfig(): boolean {
  return Boolean(url && anonKey);
}

export function getSupabaseConfig(): { url: string; anonKey: string } | null {
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** @deprecated No-op: getSupabase больше не автологинит. */
export function pauseAuthBootstrap(_paused: boolean): void {
  /* kept for callers during login/logout */
}

function createClientIfNeeded(): SupabaseClient {
  if (!hasSupabaseConfig()) {
    throw new Error(
      'Supabase не настроен. Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.'
    );
  }
  if (!client) {
    client = createClient(url!, anonKey!, {
      realtime: { params: { eventsPerSecond: 20 } },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    client.auth.onAuthStateChange((event, session) => {
      console.log('[AUTH STATE]', event, {
        uid: session?.user?.id ?? null,
        hasJwt: Boolean(session?.access_token),
      });
    });
  }
  return client;
}

/** Коллбек `.subscribe()`: статус канала + причина CLOSED / CHANNEL_ERROR. */
export function logRealtimeStatus(channelName: string, extra?: Record<string, unknown>) {
  return (status: string, err?: Error) => {
    console.error(`[REALTIME STATUS - ${channelName}]:`, status, err ?? null, extra ?? '');
    if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.error(`[REALTIME FAIL - ${channelName}] причина:`, err ?? 'no error payload', {
        hint: 'CHANNEL_ERROR/CLOSED часто значит подписка до инициализации auth.uid()',
        ...extra,
      });
    }
  };
}

/**
 * Текущая сессия без создания anonymous-пользователя.
 * null — нужен экран входа (никнейм + пароль).
 */
export async function peekAuthSession(): Promise<Session | null> {
  if (!hasSupabaseConfig()) return null;
  const sb = createClientIfNeeded();
  const { data: first, error: sessionErr } = await sb.auth.getSession();
  if (sessionErr) {
    console.warn('[paranoic auth] getSession', sessionErr.message);
  }
  if (first.session?.user?.id) return first.session;

  const { data: refreshed, error: refreshErr } = await sb.auth.refreshSession();
  if (refreshErr) {
    console.warn('[paranoic auth] refreshSession', refreshErr.message);
  }
  return refreshed.session?.user?.id ? refreshed.session : null;
}

/** Дождаться JWT / auth.uid() перед Realtime-каналами (presence, calls, room). */
export async function waitForRealtimeAuth(label: string): Promise<Session> {
  const session = await ensureAuthSession();
  console.log('[REALTIME AUTH READY]', {
    label,
    uid: session.user.id,
    hasJwt: Boolean(session.access_token),
  });
  return session;
}

/**
 * Ленивый клиент Supabase.
 * Не поднимает сессию сам — нужен login или ensureAuthSession().
 */
export function getSupabase(): SupabaseClient {
  return createClientIfNeeded();
}

/**
 * Гарантирует живую Auth-сессию (никнейм + пароль).
 * Без JWT — ошибка: нужен AuthScreen, anonymous больше не используется.
 */
export async function ensureAuthSession(): Promise<Session> {
  const session = await peekAuthSession();

  if (!session?.user?.id) {
    throw new Error('Нужен вход. Войдите по никнейму и паролю.');
  }

  console.log('[AUTH SESSION]', {
    uid: session.user.id,
    anonymous: Boolean(session.user.is_anonymous),
    hasJwt: Boolean(session.access_token),
  });
  const { identity: aligned } = alignIdentityToAuthUidDetailed(session.user.id);
  if (aligned.id !== session.user.id) {
    console.error('[AUTH SESSION] identity.id still ≠ auth.uid()', {
      identityId: aligned.id,
      authUid: session.user.id,
    });
  }
  // UUID постоянный — локальные контакты при перезаходе не сбрасываем.
  let profileIdentity = aligned;
  if (!aligned.username?.trim() && session.user.email) {
    const { resolveUsernameFromEmail } = await import('../authCredentials');
    const { updateIdentity, forcePersistSession } = await import('../identity');
    const handle = await resolveUsernameFromEmail(session.user.email, session.user.id);
    profileIdentity = forcePersistSession(
      updateIdentity({
        username: handle,
        name: aligned.name !== 'Я' ? aligned.name : handle,
      })
    );
  }
  const { bootstrapAuthProfile } = await import('../profile');
  await bootstrapAuthProfile(session.user.id, profileIdentity, {
    email: session.user.email ?? null,
  });
  return session;
}

/** `session.user.id` (= auth.uid()), не устаревший локальный identity.id. */
export async function getAuthUserId(): Promise<string> {
  const session = await ensureAuthSession();
  return session.user.id;
}

/** JWT сессии для Storage / REST. */
export async function getAuthAccessToken(): Promise<string> {
  const session = await ensureAuthSession();
  if (!session.access_token) {
    throw new Error('Нет access token. Обновите страницу и войдите снова.');
  }
  return session.access_token;
}

export type SignOutOptions = {
  /** @deprecated Anonymous больше нет — флаг игнорируется. */
  startFreshAnonymous?: boolean;
};

/**
 * Log Out: signOut + очистка локального профиля.
 * Возвращает пустой identity; дальше показывается AuthScreen.
 */
export async function signOutAndReset(_opts?: SignOutOptions): Promise<UserIdentity> {
  if (hasSupabaseConfig()) {
    try {
      await createClientIfNeeded().auth.signOut({ scope: 'local' });
    } catch (e) {
      console.warn('[paranoic auth] signOut', e);
    }
  }

  clearLocalIdentityData();
  try {
    clearCallSessionResidue();
    clearEphemeralGuestId();
  } catch {
    /* */
  }

  return createFreshIdentity();
}

/** После успешного login/signUp. */
export function markAuthBootstrapReady(_session: Session): void {
  void getOrCreateIdentity();
}
