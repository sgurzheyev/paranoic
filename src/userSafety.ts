/**
 * Play-compliance Block & Report against public.blocked_users / public.reports.
 * Also mirrors block into existing user_peer_relations via trust.blockUser.
 */

import { getAuthUserId, getSupabase, hasSupabaseConfig } from './lib/supabase';
import { blockUser as blockPeerRelation, unblockUser as unblockPeerRelation } from './trust';

export const BLOCKED_USERS_TABLE = 'blocked_users';
export const REPORTS_TABLE = 'reports';

export type ReportReasonKey =
  | 'spam'
  | 'harassment'
  | 'inappropriate'
  | 'impersonation'
  | 'other';

export const REPORT_REASON_KEYS: ReportReasonKey[] = [
  'spam',
  'harassment',
  'inappropriate',
  'impersonation',
  'other',
];

export type SafetyResult =
  | { ok: true }
  | { ok: false; message: string };

/** Insert into blocked_users + sync peer relation block. */
export async function blockUserSafety(blockedUserId: string): Promise<SafetyResult> {
  const target = blockedUserId.trim();
  if (!target) return { ok: false, message: 'Missing user id' };

  try {
    await blockPeerRelation(target);
  } catch (e) {
    console.warn('[paranoic safety] peer relation block', e);
  }

  if (!hasSupabaseConfig()) return { ok: true };

  try {
    const uid = await getAuthUserId();
    if (!uid) return { ok: false, message: 'Sign in required' };
    if (uid === target) return { ok: false, message: 'Cannot block yourself' };

    const sb = getSupabase();
    const { error } = await sb.from(BLOCKED_USERS_TABLE).upsert(
      {
        user_id: uid,
        blocked_user_id: target,
      },
      { onConflict: 'user_id,blocked_user_id' }
    );
    if (error) {
      console.warn('[paranoic safety] blocked_users upsert', error.message);
      return { ok: false, message: error.message };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message };
  }
}

export async function unblockUserSafety(blockedUserId: string): Promise<SafetyResult> {
  const target = blockedUserId.trim();
  if (!target) return { ok: false, message: 'Missing user id' };

  try {
    await unblockPeerRelation(target);
  } catch (e) {
    console.warn('[paranoic safety] peer relation unblock', e);
  }

  if (!hasSupabaseConfig()) return { ok: true };

  try {
    const uid = await getAuthUserId();
    if (!uid) return { ok: false, message: 'Sign in required' };

    const sb = getSupabase();
    const { error } = await sb
      .from(BLOCKED_USERS_TABLE)
      .delete()
      .eq('user_id', uid)
      .eq('blocked_user_id', target);
    if (error) {
      console.warn('[paranoic safety] blocked_users delete', error.message);
      return { ok: false, message: error.message };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message };
  }
}

/** Submit a moderation report (Play Store / abuse). */
export async function reportUserSafety(
  reportedId: string,
  reason: string
): Promise<SafetyResult> {
  const target = reportedId.trim();
  const reasonText = reason.trim();
  if (!target) return { ok: false, message: 'Missing user id' };
  if (reasonText.length < 2) return { ok: false, message: 'Choose a reason' };

  if (!hasSupabaseConfig()) {
    return { ok: false, message: 'Supabase is not configured' };
  }

  try {
    const uid = await getAuthUserId();
    if (!uid) return { ok: false, message: 'Sign in required' };
    if (uid === target) return { ok: false, message: 'Cannot report yourself' };

    const sb = getSupabase();
    const { error } = await sb.from(REPORTS_TABLE).insert({
      reporter_id: uid,
      reported_id: target,
      reason: reasonText.slice(0, 500),
    });
    if (error) {
      console.warn('[paranoic safety] reports insert', error.message);
      return { ok: false, message: error.message };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message };
  }
}
