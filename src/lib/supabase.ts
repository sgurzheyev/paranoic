import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

/** Ленивый клиент Supabase Realtime (signaling). */
export function getSupabase(): SupabaseClient {
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
      },
    });
  }
  return client;
}

/** `auth.uid()` текущего пользователя Supabase Auth. */
export async function getAuthUserId(): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.getUser();
  if (error) {
    throw new Error(error.message || 'Не удалось получить сессию Auth');
  }
  const id = data.user?.id?.trim();
  if (!id) {
    throw new Error('Нет сессии Supabase Auth. Войдите в аккаунт и попробуйте снова.');
  }
  return id;
}

/** JWT сессии для Storage / REST (не anon key). */
export async function getAuthAccessToken(): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.getSession();
  if (error) throw new Error(error.message || 'Нет сессии Auth');
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('Нет access token. Войдите в аккаунт и попробуйте снова.');
  }
  return token;
}
