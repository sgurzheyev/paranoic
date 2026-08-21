import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { alignIdentityToAuthUid } from '../identity';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;
/** In-flight / completed bootstrap so getSupabase() can kick off anon auth once. */
let authBootstrap: Promise<Session> | null = null;

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
  }
  return client;
}

/**
 * Ленивый клиент Supabase Realtime (signaling).
 * При первом вызове стартует anonymous sign-in (если нет сессии).
 */
export function getSupabase(): SupabaseClient {
  const sb = createClientIfNeeded();
  if (!authBootstrap) {
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

  alignIdentityToAuthUid(session.user.id);
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
