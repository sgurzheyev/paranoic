/**
 * Moderation helpers for AdminPanel (UGC / Play compliance).
 * Writes go through SECURITY DEFINER RPCs. The panel is gated on profiles.role.
 */

import { getAuthUserId, getSupabase, hasSupabaseConfig } from './lib/supabase';
import { listAllProfiles, mapAdminDbError, type AdminUserRow } from './admin';
import { REPORTS_TABLE } from './userSafety';
import { MEMORY_GEMS_TABLE, mapMemoryGemRow } from './memoryGems';
import { deleteGemMedia } from './s3Storage';
import type { MapGem } from './mapGems';

export const SUPER_ADMIN_USERNAME = 'sgurzheyev';

/** Username check kept for display / back-compat. Access is profiles.role. */
export function isSuperAdminUsername(username?: string | null): boolean {
  const raw = (username || '').trim().replace(/^@+/, '').toLowerCase();
  return raw === SUPER_ADMIN_USERNAME;
}

/** True when profiles.role is admin. No username fallback. */
export function isAdminRole(role?: string | null): boolean {
  return role === 'admin';
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

export type AdminAuditEntry = {
  id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  created_at: string;
};

export async function listModerationUsers(): Promise<AdminUserRow[]> {
  return listAllProfiles();
}

export async function banUserForModeration(targetUserId: string): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  const target = targetUserId.trim();
  if (!target) throw new Error('Нет ID пользователя');

  const uid = await getAuthUserId();
  if (!uid) throw new Error('Нужна сессия Auth');
  if (uid === target) throw new Error('Нельзя заблокировать себя');

  const sb = getSupabase();
  const { error } = await sb.rpc('admin_set_ban', { p_target: target, p_banned: true });
  if (error) throw mapAdminDbError(error, 'Не удалось забанить');
}

export async function unbanUserForModeration(targetUserId: string): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error('Supabase не настроен');
  const target = targetUserId.trim();
  if (!target) throw new Error('Нет ID пользователя');

  const sb = getSupabase();
  const { error } = await sb.rpc('admin_set_ban', { p_target: target, p_banned: false });
  if (error) throw mapAdminDbError(error, 'Не удалось разбанить');
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
  const { data, error } = await sb.rpc('admin_delete_capsule', {
    p_source: capsule.source,
    p_id: capsule.id,
  });
  if (error) throw mapAdminDbError(error, 'Не удалось удалить капсулу');

  const returnedMediaUrl = typeof data === 'string' ? data : null;
  const mediaUrl = returnedMediaUrl ?? capsule.media_url;
  if (mediaUrl) {
    try {
      await deleteGemMedia(mediaUrl);
    } catch (e) {
      console.warn('[paranoic admin] media delete', e);
    }
  }
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
  const { error } = await sb.rpc('admin_resolve_report', { p_id: reportId });
  if (error) throw mapAdminDbError(error, 'Не удалось пометить жалобу');
}

/** Delete public capsules authored by the reported user. */
export async function deleteReportedUserContent(reportedId: string): Promise<number> {
  const capsules = await listPublicCapsules();
  const mine = capsules.filter((c) => c.author_id === reportedId);
  let removed = 0;
  const failed: string[] = [];
  for (const c of mine) {
    try {
      await deleteCapsuleAsAdmin(c);
      removed += 1;
    } catch (e) {
      console.warn('[paranoic admin] delete reported content', c.id, e);
      failed.push(c.id);
    }
  }
  if (failed.length > 0) {
    throw new Error(`Не удалось удалить: ${failed.join(', ')}`);
  }
  return removed;
}

export async function listAdminAuditLog(limit = 100): Promise<AdminAuditEntry[]> {
  if (!hasSupabaseConfig()) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('admin_audit_log')
    .select('id,actor_id,action,target_type,target_id,details,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw mapAdminDbError(error, 'Не удалось загрузить журнал');
  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => {
    const detailsRaw = row.details;
    const details =
      detailsRaw && typeof detailsRaw === 'object' && !Array.isArray(detailsRaw)
        ? (detailsRaw as Record<string, unknown>)
        : {};
    return {
      id: String(row.id ?? ''),
      actor_id: String(row.actor_id ?? ''),
      action: String(row.action ?? ''),
      target_type: String(row.target_type ?? ''),
      target_id: String(row.target_id ?? ''),
      details,
      created_at: String(row.created_at ?? ''),
    };
  });
}

/** Re-export MapGem type usage if needed by UI. */
export type { MapGem };
