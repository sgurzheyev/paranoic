import { ensureAuthSession, getSupabase, hasSupabaseConfig } from './lib/supabase';

export const CALL_SESSIONS_TABLE = 'call_sessions';

export type CallSessionStatus = 'ringing' | 'accepted' | 'cancelled' | 'rejected' | 'ended';

export type CallSessionRow = {
  call_id: string;
  from_user_id: string;
  to_user_id: string;
  status: CallSessionStatus;
  updated_at: string;
};

function audit(stage: string, detail?: unknown): void {
  if (detail !== undefined) console.log('[P2P_DEBUG]', stage, detail);
  else console.log('[P2P_DEBUG]', stage);
}

export async function upsertCallSession(params: {
  callId: string;
  fromUserId: string;
  toUserId: string;
  status: CallSessionStatus;
}): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
    await ensureAuthSession();
    const sb = getSupabase();
    const { error } = await sb.from(CALL_SESSIONS_TABLE).upsert(
      {
        call_id: params.callId,
        from_user_id: params.fromUserId,
        to_user_id: params.toUserId,
        status: params.status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'call_id' }
    );
    if (error) {
      console.warn('[P2P Audit] call_sessions upsert failed', error.message);
      return;
    }
    audit('call_sessions upsert', {
      callId: params.callId,
      status: params.status,
      from: params.fromUserId,
      to: params.toUserId,
    });
  } catch (e) {
    console.warn('[P2P Audit] call_sessions upsert exception', e);
  }
}

export async function updateCallSessionStatus(
  callId: string,
  status: CallSessionStatus
): Promise<void> {
  if (!hasSupabaseConfig() || !callId) return;
  try {
    await ensureAuthSession();
    const sb = getSupabase();
    const { error } = await sb
      .from(CALL_SESSIONS_TABLE)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('call_id', callId);
    if (error) {
      console.warn('[P2P Audit] call_sessions update failed', error.message);
      return;
    }
    audit('call_sessions status', { callId, status });
  } catch (e) {
    console.warn('[P2P Audit] call_sessions update exception', e);
  }
}

/** Fallback: пропущенные Realtime offer'ы за последние N минут. */
export async function fetchRingingCallsForUser(
  toUserId: string,
  withinMs = 3 * 60_000
): Promise<CallSessionRow[]> {
  if (!hasSupabaseConfig() || !toUserId) return [];
  try {
    await ensureAuthSession();
    const since = new Date(Date.now() - withinMs).toISOString();
    const sb = getSupabase();
    const { data, error } = await sb
      .from(CALL_SESSIONS_TABLE)
      .select('call_id,from_user_id,to_user_id,status,updated_at')
      .eq('to_user_id', toUserId)
      .eq('status', 'ringing')
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
      .limit(5);
    if (error) {
      console.warn('[P2P Audit] call_sessions poll failed', error.message);
      return [];
    }
    const rows = (data ?? []) as CallSessionRow[];
    if (rows.length) audit('call_sessions poll ringing', { count: rows.length, toUserId });
    return rows;
  } catch (e) {
    console.warn('[P2P Audit] call_sessions poll exception', e);
    return [];
  }
}
