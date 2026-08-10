import { getSupabase, hasSupabaseConfig } from './lib/supabase';

export const CALL_SESSIONS_TABLE = 'call_sessions';

export type CallSessionStatus = 'ringing' | 'accepted' | 'cancelled' | 'rejected' | 'ended';

export async function upsertCallSession(params: {
  callId: string;
  fromUserId: string;
  toUserId: string;
  status: CallSessionStatus;
}): Promise<void> {
  if (!hasSupabaseConfig()) return;
  try {
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
    if (error) console.warn('[paranoic] call_sessions upsert', error.message);
  } catch (e) {
    console.warn('[paranoic] call_sessions upsert failed', e);
  }
}

export async function updateCallSessionStatus(
  callId: string,
  status: CallSessionStatus
): Promise<void> {
  if (!hasSupabaseConfig() || !callId) return;
  try {
    const sb = getSupabase();
    const { error } = await sb
      .from(CALL_SESSIONS_TABLE)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('call_id', callId);
    if (error) console.warn('[paranoic] call_sessions update', error.message);
  } catch (e) {
    console.warn('[paranoic] call_sessions update failed', e);
  }
}
