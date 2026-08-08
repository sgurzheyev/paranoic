import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, hasSupabaseConfig } from './lib/supabase';

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

/**
 * Отправка broadcast в персональный call-канал пользователя.
 * Подписываемся коротко, шлём событие, отписываемся.
 */
async function sendToUserChannel(
  userId: string,
  event: string,
  payload: CallRingEvent
): Promise<void> {
  if (!hasSupabaseConfig()) return;
  const sb = getSupabase();
  const ch = sb.channel(channelName(userId), {
    config: { broadcast: { self: false } },
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('call channel timeout')), 8_000);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          window.clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          window.clearTimeout(timer);
          reject(new Error(`call channel ${status}`));
        }
      });
    });

    const result = await ch.send({
      type: 'broadcast',
      event,
      payload,
    });
    if (result !== 'ok') {
      console.warn('[paranoic call] send failed', event, result);
    }
  } finally {
    try {
      await sb.removeChannel(ch);
    } catch {
      /* */
    }
  }
}

/**
 * Постоянный inbox входящих call_offer на `calls:{myUserId}`.
 * Звонок по Realtime до/параллельно WebRTC DataChannel invite.
 */
export class CallInbox {
  private channel: RealtimeChannel | null = null;
  private userId = '';
  private handlers: CallInboxHandlers;

  constructor(handlers: CallInboxHandlers = {}) {
    this.handlers = handlers;
  }

  async start(userId: string): Promise<void> {
    if (!hasSupabaseConfig()) return;
    if (this.channel && this.userId === userId) return;

    await this.stop();
    this.userId = userId;
    const sb = getSupabase();
    const ch = sb.channel(channelName(userId), {
      config: { broadcast: { self: false } },
    });

    ch.on('broadcast', { event: 'call_offer' }, ({ payload }) => {
      const offer = payload as CallOfferEvent;
      if (!offer || offer.type !== 'call_offer') return;
      if (offer.toUserId !== this.userId) return;
      if (!offer.from?.id || offer.from.id === this.userId) return;
      this.handlers.onOffer?.(offer);
    });

    ch.on('broadcast', { event: 'call_reject' }, ({ payload }) => {
      const event = payload as CallRejectEvent;
      if (!event || event.type !== 'call_reject') return;
      if (event.toUserId !== this.userId) return;
      this.handlers.onReject?.(event);
    });

    ch.on('broadcast', { event: 'call_cancel' }, ({ payload }) => {
      const event = payload as CallCancelEvent;
      if (!event || event.type !== 'call_cancel') return;
      if (event.toUserId !== this.userId) return;
      this.handlers.onCancel?.(event);
    });

    this.channel = ch;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('call inbox timeout')), 12_000);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          window.clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          window.clearTimeout(timer);
          reject(new Error(`call inbox ${status}`));
        }
      });
    });
  }

  async stop(): Promise<void> {
    const ch = this.channel;
    this.channel = null;
    this.userId = '';
    if (!ch) return;
    try {
      const sb = getSupabase();
      await sb.removeChannel(ch);
    } catch {
      /* */
    }
  }

  /** Инициатор → получателю: Caller ID до WebRTC. */
  async sendOffer(toUserId: string, from: CallerInfo, callId: string): Promise<void> {
    if (!toUserId || toUserId === from.id) return;
    // Клиентская защита: бан проверяется в App до вызова; дубль на всякий случай.
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
