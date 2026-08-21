import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import {
  alignIdentityToAuthUidDetailed,
  clearLocalIdentityData,
  createFreshIdentity,
  getOrCreateIdentity,
  type UserIdentity,
} from '../identity';
import { clearCallSessionResidue, clearEphemeralGuestId } from '../callSessionCleanup';
import { clearLocalChatsAndContacts } from '../storeContacts';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;
/** In-flight / completed bootstrap so getSupabase() can kick off anon auth once. */
let authBootstrap: Promise<Session> | null = null;
/** После Log Out не поднимаем anon сразу из getSupabase(), пока не вызовут ensureAuthSession. */
let authBootstrapPaused = false;

export function hasSupabaseConfig(): boolean {
  return Boolean(url && anonKey);
}

export function getSupabaseConfig(): { url: string; anonKey: string } | null {
  if (!url || !anonKey) return null;
  return { url, anonKey };
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
 * Ленивый клиент Supabase Realtime (signaling).
 * При первом вызове стартует anonymous sign-in (если нет сессии).
 */
export function getSupabase(): SupabaseClient {
  const sb = createClientIfNeeded();
  if (!authBootstrap && !authBootstrapPaused) {
    authBootstrap = ensureAuthSession().catch((err) => {
      authBootstrap = null;
      console.warn('[paranoic auth] bootstrap', err);
      throw err;
    });
  }
  return sb;
}

/**
 * Гарантирует живую Auth-сессию перед запросами с RLS.
 * 1) getSession → 2) refreshSession → 3) signInAnonymously (реинит).
 * После успеха выравнивает local identity.id = auth.uid().
 */
export async function ensureAuthSession(): Promise<Session> {
  authBootstrapPaused = false;
  const sb = createClientIfNeeded();

  const { data: first, error: sessionErr } = await sb.auth.getSession();
  if (sessionErr) {
    console.warn('[paranoic auth] getSession', sessionErr.message);
  }

  let session = first.session;

  if (!session?.user?.id) {
    const { data: refreshed, error: refreshErr } = await sb.auth.refreshSession();
    if (refreshErr) {
      console.warn('[paranoic auth] refreshSession', refreshErr.message);
    }
    session = refreshed.session;
  }

  if (!session?.user?.id) {
    // Нет JWT — anonymous sign-in, чтобы auth.uid() совпал с identity.id.
    const { data: anon, error: anonErr } = await sb.auth.signInAnonymously();
    if (anonErr) {
      const hint = /anonymous|disabled|not enabled/i.test(anonErr.message)
        ? ' Включите Anonymous Sign-Ins в Supabase → Authentication → Providers.'
        : '';
      throw new Error(`Сессия Auth отсутствует.${hint} ${anonErr.message}`.trim());
    }
    session = anon.session;
  }

  if (!session?.user?.id) {
    throw new Error('Сессия Auth отсутствует. Обновите страницу и войдите снова.');
  }

  console.log('[AUTH SESSION]', {
    uid: session.user.id,
    anonymous: Boolean(session.user.is_anonymous),
    hasJwt: Boolean(session.access_token),
  });
  const { identity: aligned, idChanged, previousId } = alignIdentityToAuthUidDetailed(
    session.user.id
  );
  if (aligned.id !== session.user.id) {
    console.error('[AUTH SESSION] identity.id still ≠ auth.uid()', {
      identityId: aligned.id,
      authUid: session.user.id,
    });
  }
  if (idChanged && previousId) {
    // Старый localStorage id ≠ новый JWT — не писать в чужие/мёртвые чаты.
    await clearLocalChatsAndContacts();
  }
  // Физическая строка в profiles (иначе presence/звонки бьются о пустой SELECT).
  // dynamic import — избегаем цикла supabase ↔ profile.
  const { bootstrapAuthProfile } = await import('../profile');
  await bootstrapAuthProfile(session.user.id, aligned);
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
  /**
   * true — сразу создать новую anonymous Auth-сессию (чистый аккаунт).
   * false — только выйти; вход / новый аккаунт на стартовом экране.
   */
  startFreshAnonymous?: boolean;
};

/**
 * Log Out / Switch Account: signOut + очистка локального профиля.
 * Возвращает identity для UI (пустой профиль или новый anon).
 */
export async function signOutAndReset(opts?: SignOutOptions): Promise<UserIdentity> {
  const startFresh = opts?.startFreshAnonymous !== false;

  authBootstrap = null;
  authBootstrapPaused = true;

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

  if (startFresh && hasSupabaseConfig()) {
    authBootstrapPaused = false;
    const session = await ensureAuthSession();
    authBootstrap = Promise.resolve(session);
    return getOrCreateIdentity();
  }

  return createFreshIdentity();
}
