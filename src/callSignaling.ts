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

/** Повторы отправки в call-канал и таймаут подписки Realtime. */
const CALL_CHANNEL_SEND_ATTEMPTS = 5;
const CALL_CHANNEL_SUBSCRIBE_TIMEOUT_MS = 15_000;
const CALL_OFFER_OUTER_RETRIES = 3;
/** Presence may flicker offline for a few seconds — do not block signaling on stale heartbeat alone. */
const CALL_PRESENCE_GRACE_MS = 90_000;

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
): Promise<boolean> {
  if (!hasSupabaseConfig()) return false;
  const session = await waitForRealtimeAuth(`call-out:${event}`);
  console.log('[SIGNAL OUT]', event, {
    to: userId,
    fromUid: session.user.id,
    payload,
  });
  const sb = getSupabase();
  let lastError: unknown;
  const chName = channelName(userId);

  for (let attempt = 1; attempt <= CALL_CHANNEL_SEND_ATTEMPTS; attempt++) {
    const ch = sb.channel(chName, {
      config: { broadcast: { self: false } },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error('call channel timeout')),
          CALL_CHANNEL_SUBSCRIBE_TIMEOUT_MS
        );
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
      return true;
    } catch (e) {
      lastError = e;
      audit('call ring send retry', { event, to: userId, attempt, error: String(e) });
      await new Promise((r) => setTimeout(r, 250 * attempt));
    } finally {
      try {
        await sb.removeChannel(ch);
      } catch {
        /* */
      }
    }
  }

  console.warn('[P2P Audit] call ring send failed', event, lastError);
  return false;
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
      audit('call inbox tab visible — ensureAlive', {
        userId: this.userId,
        subscribed: this.subscribed,
      });
      void this.ensureAlive();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /** Re-subscribe if Realtime channel dropped (foreground / app resume). */
  async ensureAlive(): Promise<void> {
    if (!this.userId) return;
    if (this.channel && this.subscribed) return;
    await this.recoverIfNeeded();
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
   *  Offer отправляется даже если presence кратко offline — inbox может разбудить callee.
   */
  async sendOffer(toUserId: string, from: CallerInfo, callId: string): Promise<boolean> {
    if (!toUserId || toUserId === from.id) return false;
    const check = await checkCalleeOnline(toUserId);
    if (check.missingProfile) {
      console.warn('[SIGNAL OUT] skip call_offer — profile missing', { to: toUserId });
      return false;
    }
    if (!check.ok) {
      console.warn('[SIGNAL OUT] skip call_offer — callee busy', {
        to: toUserId,
        status: check.peer.status,
      });
      return false;
    }
    if (check.appearsOffline) {
      audit('call offer while callee appears offline — sending anyway', {
        to: toUserId,
        lastSeen: check.peer.lastSeen,
      });
    }
    const payload: CallOfferEvent = {
      type: 'call_offer',
      callId,
      toUserId,
      from,
      at: Date.now(),
    };

    for (let round = 1; round <= CALL_OFFER_OUTER_RETRIES; round++) {
      const sent = await sendToUserChannel(toUserId, 'call_offer', payload);
      if (sent) return true;
      if (round < CALL_OFFER_OUTER_RETRIES) {
        audit('call offer outer retry', { to: toUserId, round, callId });
        await new Promise((r) => setTimeout(r, 700 * round));
      }
    }
    return false;
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
 * Offline presence не блокирует звонок — только busy (in_call) и отсутствие профиля.
 */
export async function checkCalleeOnline(toUserId: string): Promise<{
  ok: boolean;
  peer: PeerPresenceInfo;
  /** @deprecated Use appearsOffline — kept for callers that still read it */
  needsOfflineConfirm: boolean;
  /** Presence выглядит offline — informational, звонок всё равно можно пробовать */
  appearsOffline: boolean;
  /** true = профиля нет в БД (устаревший / удалённый контакт) */
  missingProfile?: boolean;
}> {
  if (!hasSupabaseConfig() || !toUserId) {
    return {
      ok: false,
      peer: { userId: toUserId, status: 'offline', isOnline: false, lastSeen: null },
      needsOfflineConfirm: false,
      appearsOffline: true,
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
      return {
        ok: false,
        peer: { userId: toUserId, status: 'offline', isOnline: false, lastSeen: null },
        needsOfflineConfirm: false,
        appearsOffline: true,
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
    const recentlySeen = isRecentlySeenForCall(lastSeen);
    const appearsOffline = !online && !recentlySeen;
    const statusRaw = String(row.presence_status ?? '').toLowerCase();
    if (online && statusRaw === 'in_call') {
      return {
        ok: false,
        peer: { userId: toUserId, status: 'in_call', isOnline: true, lastSeen },
        needsOfflineConfirm: false,
        appearsOffline: false,
      };
    }
    const peerStatus: PresenceStatus = online
      ? 'online'
      : recentlySeen
        ? 'away'
        : 'offline';
    return {
      ok: true,
      peer: { userId: toUserId, status: peerStatus, isOnline: online || recentlySeen, lastSeen },
      needsOfflineConfirm: false,
      appearsOffline,
    };
  } catch (e) {
    console.warn('[presence] callee check failed', e);
    return {
      ok: true,
      peer: { userId: toUserId, status: 'offline', isOnline: false, lastSeen: null },
      needsOfflineConfirm: false,
      appearsOffline: true,
    };
  }
}

function isRecentlySeenForCall(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false;
  const t = new Date(lastSeen).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= CALL_PRESENCE_GRACE_MS;
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
