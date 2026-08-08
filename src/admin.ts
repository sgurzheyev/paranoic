import { getSupabase, hasSupabaseConfig } from './lib/supabase';
import { AVATARS_BUCKET, PROFILES_TABLE, type RemoteProfile } from './profile';

export type ProfileRole = 'user' | 'admin';

export type AdminUserRow = RemoteProfile & {
  role: ProfileRole;
  is_banned: boolean;
  created_at: string | null;
};

export type MyAccessFlags = {
  role: ProfileRole;
  isBanned: boolean;
};

const PROFILE_ADMIN_SELECT =
  'id,name,color,avatar_url,theme_fon,username,updated_at,role,is_banned,created_at';

function normalizeRole(raw: unknown): ProfileRole {
  return raw === 'admin' ? 'admin' : 'user';
}

function mapAdminRow(row: Record<string, unknown>): AdminUserRow {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Я'),
    color: String(row.color ?? '#34d399'),
    avatar_url: (row.avatar_url as string | null) ?? null,
    theme_fon: (row.theme_fon as string | null) ?? null,
    username: (row.username as string | null) ?? null,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
    role: normalizeRole(row.role),
    is_banned: Boolean(row.is_banned),
    created_at: row.created_at ? String(row.created_at) : null,
  };
}

/** Роль и бан текущего пользователя. */
export async function fetchMyAccessFlags(userId: string): Promise<MyAccessFlags> {
  if (!hasSupabaseConfig() || !userId) {
    return { role: 'user', isBanned: false };
  }
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from(PROFILES_TABLE)
      .select('role,is_banned')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) {
      if (error) console.warn('[paranoic admin] flags', error.message);
      return { role: 'user', isBanned: false };
    }
    return {
      role: normalizeRole((data as { role?: string }).role),
      isBanned: Boolean((data as { is_banned?: boolean }).is_banned),
    };
  } catch (e) {
    console.warn('[paranoic admin] flags failed', e);
    return { role: 'user', isBanned: false };
  }
}

/** Список всех профилей для Admin Dashboard. */
export async function listAllProfiles(): Promise<AdminUserRow[]> {
  if (!hasSupabaseConfig()) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from(PROFILES_TABLE)
    .select(PROFILE_ADMIN_SELECT)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message || 'Не удалось загрузить пользователей');
  }
  return ((data as Record<string, unknown>[] | null) ?? []).map(mapAdminRow);
}

/** Ban / Unban. */
export async function setUserBanned(userId: string, banned: boolean): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  const sb = getSupabase();
  const { error } = await sb
    .from(PROFILES_TABLE)
    .update({
      is_banned: banned,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) throw new Error(error.message || 'Не удалось изменить бан');
}

/** Мгновенное удаление профиля (+ попытка убрать аватар). */
export async function deleteUserAccount(userId: string): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  const sb = getSupabase();

  try {
    await sb.storage.from(AVATARS_BUCKET).remove([
      `${userId}/avatar.jpg`,
      `${userId}/avatar.png`,
      `${userId}/avatar.webp`,
      `${userId}/avatar.gif`,
    ]);
  } catch {
    /* avatar optional */
  }

  const { error } = await sb.from(PROFILES_TABLE).delete().eq('id', userId);
  if (error) throw new Error(error.message || 'Не удалось удалить аккаунт');
}

export function formatRegisteredAt(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
