import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  getSupabase,
  hasSupabaseConfig,
  logRealtimeStatus,
  waitForRealtimeAuth,
} from './lib/supabase';
import {
  isHeartbeatOnline,
  pingProfilePresence,
  setUsersCallPresence,
  type PeerPresenceInfo,
  type PresenceStatus,
} from './presence';

export type { PeerPresenceInfo, PresenceStatus };

/** Профиль звонящего для Caller ID / уведомлений. */
export type CallerInfo = {
  id: string;
  name: string;
  username: string;
  avatarUrl: string;
  color: string;
};

export type CallOfferEvent = {
  type: 'call_offer';
  callId: string;
  toUserId: string;
  from: CallerInfo;
  at: number;
};

export type CallRejectEvent = {
  type: 'call_reject';
  callId: string;
  toUserId: string;
  fromUserId: string;
  at: number;
};

export type CallCancelEvent = {
  type: 'call_cancel';
  callId: string;
  toUserId: string;
  fromUserId: string;
  at: number;
};

export type CallRingEvent = CallOfferEvent | CallRejectEvent | CallCancelEvent;

type CallInboxHandlers = {
  onOffer?: (offer: CallOfferEvent) => void;
  onReject?: (event: CallRejectEvent) => void;
  onCancel?: (event: CallCancelEvent) => void;
};

function channelName(userId: string): string {
  return `calls:${userId}`;
}

function audit(stage: string, detail?: unknown): void {
  if (detail !== undefined) console.log('[P2P_DEBUG]', stage, detail);
  else console.log('[P2P_DEBUG]', stage);
}

/**
 * Отправка broadcast в персональный call-канал пользователя.
 * Подписываемся коротко, шлём событие, отписываемся (с ретраями).
 */
async function sendToUserChannel(
  userId: string,
  event: string,
  payload: CallRingEvent
): Promise<void> {
  if (!hasSupabaseConfig()) return;
  const session = await waitForRealtimeAuth(`call-out:${event}`);
  console.log('[SIGNAL OUT]', event, {
    to: userId,
    fromUid: session.user.id,
    payload,
  });
  const sb = getSupabase();
  let lastError: unknown;
  const chName = channelName(userId);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const ch = sb.channel(chName, {
      config: { broadcast: { self: false } },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('call channel timeout')), 8_000);
        const logStatus = logRealtimeStatus(chName, { attempt, fromUid: session.user.id });
        ch.subscribe((status, err) => {
          logStatus(status, err);
          if (status === 'SUBSCRIBED') {
            window.clearTimeout(timer);
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            window.clearTimeout(timer);
            reject(new Error(`call channel ${status}${err ? `: ${err.message}` : ''}`));
          }
        });
      });

      const result = await ch.send({
        type: 'broadcast',
        event,
        payload,
      });
      if (result !== 'ok') {
        throw new Error(`call send ${String(result)}`);
      }
      audit('call ring sent', { event, to: userId, attempt, callId: payload.callId });
      return;
    } catch (e) {
      lastError = e;
      audit('call ring send retry', { event, to: userId, attempt, error: String(e) });
      await new Promise((r) => setTimeout(r, 200 * attempt));
    } finally {
      try {
        await sb.removeChannel(ch);
      } catch {
        /* */
      }
    }
  }

  console.warn('[P2P Audit] call ring send failed', event, lastError);
}

/**
 * Постоянный inbox входящих call_offer на `calls:{myUserId}`.
 * Звонок по Realtime до/параллельно WebRTC DataChannel invite.
 */
export class CallInbox {
  private channel: RealtimeChannel | null = null;
  private userId = '';
  private handlers: CallInboxHandlers;
  private recovering = false;
  private subscribed = false;
  private visibilityHandler: (() => void) | null = null;

  constructor(handlers: CallInboxHandlers = {}) {
    this.handlers = handlers;
  }

  async start(userId: string): Promise<void> {
    if (!hasSupabaseConfig()) return;
    if (this.channel && this.userId === userId && this.subscribed) return;

    const session = await waitForRealtimeAuth('call-inbox');
    if (!userId || userId !== session.user.id) {
      console.error('[REALTIME FAIL - calls] identity.id ≠ auth.uid()', {
        identityId: userId,
        authUid: session.user.id,
      });
    }

    await this.stop();
    this.userId = session.user.id;
    await this.subscribeInbox(this.userId);
    this.bindVisibilityRecover();
  }

  private bindVisibilityRecover(): void {
    if (this.visibilityHandler || typeof document === 'undefined') return;
    this.visibilityHandler = () => {
      if (document.visibilityState !== 'visible') return;
      if (!this.userId) return;
      if (this.channel && this.subscribed) return;
      audit('call inbox tab visible — resubscribe', { userId: this.userId });
      void this.recoverIfNeeded();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private async recoverIfNeeded(): Promise<void> {
    if (!this.userId || this.recovering) return;
    this.recovering = true;
    try {
      const uid = this.userId;
      const ch = this.channel;
      this.channel = null;
      this.subscribed = false;
      if (ch) {
        try {
          await getSupabase().removeChannel(ch);
        } catch {
          /* */
        }
      }
      await this.subscribeInbox(uid);
    } catch (e) {
      console.warn('[P2P Audit] call inbox recover failed', e);
    } finally {
      this.recovering = false;
    }
  }

  private async subscribeInbox(userId: string): Promise<void> {
    const sb = getSupabase();
    const chName = channelName(userId);
    const ch = sb.channel(chName, {
      config: { broadcast: { self: false } },
    });

    ch.on('broadcast', { event: 'call_offer' }, ({ payload }) => {
      console.log('[SIGNAL IN]', 'call_offer', payload);
      const offer = payload as CallOfferEvent;
      if (!offer || offer.type !== 'call_offer') return;
      if (offer.toUserId !== this.userId) return;
      if (!offer.from?.id || offer.from.id === this.userId) return;
      audit('call inbox offer', { callId: offer.callId, from: offer.from.id });
      this.handlers.onOffer?.(offer);
    });

    ch.on('broadcast', { event: 'call_reject' }, ({ payload }) => {
      console.log('[SIGNAL IN]', 'call_reject', payload);
      const event = payload as CallRejectEvent;
      if (!event || event.type !== 'call_reject') return;
      if (event.toUserId !== this.userId) return;
      audit('call inbox reject', { callId: event.callId, from: event.fromUserId });
      this.handlers.onReject?.(event);
    });

    ch.on('broadcast', { event: 'call_cancel' }, ({ payload }) => {
      console.log('[SIGNAL IN]', 'call_cancel', payload);
      const event = payload as CallCancelEvent;
      if (!event || event.type !== 'call_cancel') return;
      if (event.toUserId !== this.userId) return;
      audit('call inbox cancel', { callId: event.callId, from: event.fromUserId });
      this.handlers.onCancel?.(event);
    });

    this.channel = ch;
    this.subscribed = false;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('call inbox timeout')), 12_000);
      const logStatus = logRealtimeStatus(chName, { userId });
      ch.subscribe((status, err) => {
        logStatus(status, err);
        audit('call inbox subscribe', { status, userId, err: err?.message });
        if (status === 'SUBSCRIBED') {
          this.subscribed = true;
          window.clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          window.clearTimeout(timer);
          const wasLive = this.subscribed;
          this.subscribed = false;
          if (wasLive && this.channel === ch) {
            void this.recoverIfNeeded();
          }
          reject(new Error(`call inbox ${status}${err ? `: ${err.message}` : ''}`));
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    const ch = this.channel;
    this.channel = null;
    this.subscribed = false;
    this.userId = '';
    if (!ch) return;
    try {
      const sb = getSupabase();
      await sb.removeChannel(ch);
      audit('call inbox stopped');
    } catch {
      /* */
    }
  }

  /** Инициатор → получателю: Caller ID до WebRTC.
   *  Строка call_sessions пишется отдельно (`from_user_id` / `to_user_id`, не sender/recipient).
   */
  async sendOffer(toUserId: string, from: CallerInfo, callId: string): Promise<void> {
    if (!toUserId || toUserId === from.id) return;
    const check = await checkCalleeOnline(toUserId);
    if (!check.ok || check.needsOfflineConfirm || check.missingProfile) {
      console.warn('[SIGNAL OUT] skip call_offer — callee offline, busy, or missing', {
        to: toUserId,
        status: check.peer.status,
        isOnline: check.peer.isOnline,
        missingProfile: check.missingProfile,
      });
      return;
    }
    const payload: CallOfferEvent = {
      type: 'call_offer',
      callId,
      toUserId,
      from,
      at: Date.now(),
    };
    await sendToUserChannel(toUserId, 'call_offer', payload);
  }

  /** Получатель отклонил → инициатору. */
  async sendReject(toCallerId: string, fromUserId: string, callId: string): Promise<void> {
    const payload: CallRejectEvent = {
      type: 'call_reject',
      callId,
      toUserId: toCallerId,
      fromUserId,
      at: Date.now(),
    };
    await sendToUserChannel(toCallerId, 'call_reject', payload);
  }

  /** Инициатор отменил, пока калеe ещё не ответил. */
  async sendCancel(toUserId: string, fromUserId: string, callId: string): Promise<void> {
    const payload: CallCancelEvent = {
      type: 'call_cancel',
      callId,
      toUserId,
      fromUserId,
      at: Date.now(),
    };
    await sendToUserChannel(toUserId, 'call_cancel', payload);
  }
}

export function newCallId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function callerDisplayName(info: Pick<CallerInfo, 'name' | 'username' | 'id'>): string {
  if (info.username) return `@${info.username}`;
  if (info.name && info.name !== 'Я') return info.name;
  return info.id.slice(0, 10);
}

/**
 * Перед SDP / call_offer: прямой SELECT is_online, last_seen.
 * Offline (is_online = false или last_seen старше 45с) → не звонить, UI про Push.
 */
export async function checkCalleeOnline(toUserId: string): Promise<{
  ok: boolean;
  peer: PeerPresenceInfo;
  /** true = пользователь offline, нужен confirm про уведомление */
  needsOfflineConfirm: boolean;
  /** true = профиля нет в БД (устаревший / удалённый контакт) */
  missingProfile?: boolean;
}> {
  if (!hasSupabaseConfig() || !toUserId) {
    return {
      ok: false,
      peer: { userId: toUserId, status: 'offline', isOnline: false, lastSeen: null },
      needsOfflineConfirm: false,
      missingProfile: true,
    };
  }
  try {
    await waitForRealtimeAuth('call-presence');
    const sb = getSupabase();
    const { data, error } = await sb
      .from('profiles')
      .select('is_online, last_seen, presence_status')
      .eq('id', toUserId)
      .maybeSingle();
    if (error || !data) {
      if (error) console.warn('[presence] callee check', error.message);
      // maybeSingle: нет строки → data=null без error; .single → PGRST116
      return {
        ok: false,
        peer: { userId: toUserId, status: 'offline', isOnline: false, lastSeen: null },
        needsOfflineConfirm: false,
        missingProfile: true,
      };
    }
    const row = data as {
      is_online?: boolean | null;
      last_seen?: string | null;
      presence_status?: string | null;
    };
    const lastSeen = row.last_seen ?? null;
    const online = isHeartbeatOnline(row.is_online, lastSeen);
    const statusRaw = String(row.presence_status ?? '').toLowerCase();
    if (online && statusRaw === 'in_call') {
      return {
        ok: false,
        peer: { userId: toUserId, status: 'in_call', isOnline: true, lastSeen },
        needsOfflineConfirm: false,
      };
    }
    if (!online) {
      return {
        ok: true,
        peer: { userId: toUserId, status: 'offline', isOnline: false, lastSeen },
        needsOfflineConfirm: true,
      };
    }
    return {
      ok: true,
      peer: { userId: toUserId, status: 'online', isOnline: true, lastSeen },
      needsOfflineConfirm: false,
    };
  } catch (e) {
    console.warn('[presence] callee check failed', e);
    return {
      ok: false,
      peer: { userId: toUserId, status: 'offline', isOnline: false, lastSeen: null },
      needsOfflineConfirm: false,
      missingProfile: true,
    };
  }
}

/** Оба участника → in_call (занятость в profiles). */
export async function markParticipantsInCall(
  callerId: string,
  calleeId: string
): Promise<void> {
  await setUsersCallPresence([callerId, calleeId], true);
}

/** Снять in_call; видимая вкладка → online, иначе away. */
export async function clearParticipantsInCall(
  userIds: string[],
  opts?: { preferAway?: boolean }
): Promise<void> {
  const status: PresenceStatus =
    opts?.preferAway ||
    (typeof document !== 'undefined' && document.visibilityState !== 'visible')
      ? 'away'
      : 'online';
  const unique = [...new Set(userIds.filter(Boolean))];
  await Promise.all(unique.map((id) => pingProfilePresence(id, status)));
}
