/**
 * Moderation helpers for AdminPanel (UGC / Play compliance).
 * Client-gated to @sgurzheyev; DB still needs RLS that allows this admin.
 */

import { getAuthUserId, getSupabase, hasSupabaseConfig } from './lib/supabase';
import {
  listAllProfiles,
  setUserBanned,
  type AdminUserRow,
} from './admin';
import { BLOCKED_USERS_TABLE, REPORTS_TABLE } from './userSafety';
import { MEMORY_GEMS_TABLE, mapMemoryGemRow } from './memoryGems';
import { deleteGemMedia } from './s3Storage';
import type { MapGem } from './mapGems';

export const SUPER_ADMIN_USERNAME = 'sgurzheyev';

/** Username gate: "@sgurzheyev" / "sgurzheyev" / casing variants. */
export function isSuperAdminUsername(username?: string | null): boolean {
  const raw = (username || '').trim().replace(/^@+/, '').toLowerCase();
  return raw === SUPER_ADMIN_USERNAME;
}

export type ModerationReport = {
  id: string;
  reporter_id: string;
  reported_id: string;
  reason: string;
  created_at: string;
  resolved_at: string | null;
};

export type AdminCapsule = {
  id: string;
  source: 'memory_gems' | 'map_gems';
  author_id: string;
  content: string;
  lat: number;
  lng: number;
  media_url: string | null;
  visibility: string;
  created_at: string;
};

export async function listModerationUsers(): Promise<AdminUserRow[]> {
  return listAllProfiles();
}

/**
 * Ban: profiles.is_banned + blocked_users row for the acting admin.
 */
export async function banUserForModeration(targetUserId: string): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  const target = targetUserId.trim();
  if (!target) throw new Error('Нет ID пользователя');

  const uid = await getAuthUserId();
  if (!uid) throw new Error('Нужна сессия Auth');
  if (uid === target) throw new Error('Нельзя заблокировать себя');

  await setUserBanned(target, true);

  const sb = getSupabase();
  const { error } = await sb.from(BLOCKED_USERS_TABLE).upsert(
    {
      user_id: uid,
      blocked_user_id: target,
    },
    { onConflict: 'user_id,blocked_user_id' }
  );
  if (error) {
    console.warn('[paranoic admin] blocked_users upsert', error.message);
  }
}

export async function unbanUserForModeration(targetUserId: string): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  const target = targetUserId.trim();
  if (!target) throw new Error('Нет ID пользователя');

  await setUserBanned(target, false);

  try {
    const uid = await getAuthUserId();
    if (!uid) return;
    const sb = getSupabase();
    await sb
      .from(BLOCKED_USERS_TABLE)
      .delete()
      .eq('user_id', uid)
      .eq('blocked_user_id', target);
  } catch (e) {
    console.warn('[paranoic admin] blocked_users delete', e);
  }
}

/** Public (and unknown-visibility) map capsules for moderation. */
export async function listPublicCapsules(): Promise<AdminCapsule[]> {
  if (!hasSupabaseConfig()) return [];
  const sb = getSupabase();
  const out: AdminCapsule[] = [];

  try {
    const { data, error } = await sb.from(MEMORY_GEMS_TABLE).select('*').order('created_at', {
      ascending: false,
    });
    if (error) {
      console.warn('[paranoic admin] memory_gems', error.message);
    } else {
      for (const raw of (data as Record<string, unknown>[] | null) ?? []) {
        const mapped = mapMemoryGemRow(raw);
        if (!mapped) continue;
        const vis = mapped.visibility ?? 'public';
        if (vis === 'private') continue;
        out.push({
          id: mapped.id,
          source: 'memory_gems',
          author_id: mapped.author_id,
          content: mapped.content || mapped.description || '—',
          lat: mapped.lat,
          lng: mapped.lng,
          media_url: mapped.media_url,
          visibility: vis,
          created_at: mapped.created_at,
        });
      }
    }
  } catch (e) {
    console.warn('[paranoic admin] memory_gems failed', e);
  }

  try {
    const { data, error } = await sb
      .from('map_gems')
      .select('id,author_id,lat,lng,type,media_url,content,created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      console.warn('[paranoic admin] map_gems', error.message);
    } else {
      const seen = new Set(out.map((c) => c.id));
      for (const row of (data as Record<string, unknown>[] | null) ?? []) {
        const id = String(row.id ?? '');
        if (!id || seen.has(id)) continue;
        out.push({
          id,
          source: 'map_gems',
          author_id: String(row.author_id ?? ''),
          content: String(row.content ?? row.type ?? '—'),
          lat: Number(row.lat),
          lng: Number(row.lng),
          media_url: (row.media_url as string | null) ?? null,
          visibility: 'public',
          created_at: String(row.created_at ?? ''),
        });
      }
    }
  } catch (e) {
    console.warn('[paranoic admin] map_gems failed', e);
  }

  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return out;
}

export async function deleteCapsuleAsAdmin(capsule: AdminCapsule): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  const sb = getSupabase();

  if (capsule.media_url) {
    try {
      await deleteGemMedia(capsule.media_url);
    } catch (e) {
      console.warn('[paranoic admin] media delete', e);
    }
  }

  if (capsule.source === 'memory_gems') {
    const { error } = await sb.from(MEMORY_GEMS_TABLE).delete().eq('id', capsule.id);
    if (error) throw new Error(error.message || 'Не удалось удалить капсулу');
    return;
  }

  const { error } = await sb.from('map_gems').delete().eq('id', capsule.id);
  if (error) throw new Error(error.message || 'Не удалось удалить капсулу');
}

export async function listModerationReports(): Promise<ModerationReport[]> {
  if (!hasSupabaseConfig()) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from(REPORTS_TABLE)
    .select('id,reporter_id,reported_id,reason,created_at,resolved_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) {
    // Older DBs without resolved_at
    const retry = await sb
      .from(REPORTS_TABLE)
      .select('id,reporter_id,reported_id,reason,created_at')
      .order('created_at', { ascending: false })
      .limit(300);
    if (retry.error) throw new Error(retry.error.message || 'Не удалось загрузить жалобы');
    return ((retry.data as Record<string, unknown>[] | null) ?? []).map((row) => ({
      id: String(row.id),
      reporter_id: String(row.reporter_id),
      reported_id: String(row.reported_id),
      reason: String(row.reason ?? ''),
      created_at: String(row.created_at ?? ''),
      resolved_at: null,
    }));
  }
  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => ({
    id: String(row.id),
    reporter_id: String(row.reporter_id),
    reported_id: String(row.reported_id),
    reason: String(row.reason ?? ''),
    created_at: String(row.created_at ?? ''),
    resolved_at: row.resolved_at ? String(row.resolved_at) : null,
  }));
}

export async function markReportResolved(reportId: string): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  const sb = getSupabase();
  const { error } = await sb
    .from(REPORTS_TABLE)
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', reportId);
  if (error) throw new Error(error.message || 'Не удалось пометить жалобу');
}

/** Delete public capsules authored by the reported user. */
export async function deleteReportedUserContent(reportedId: string): Promise<number> {
  const capsules = await listPublicCapsules();
  const mine = capsules.filter((c) => c.author_id === reportedId);
  let removed = 0;
  for (const c of mine) {
    try {
      await deleteCapsuleAsAdmin(c);
      removed += 1;
    } catch (e) {
      console.warn('[paranoic admin] delete reported content', c.id, e);
    }
  }
  return removed;
}

/** Re-export MapGem type usage if needed by UI. */
export type { MapGem };
