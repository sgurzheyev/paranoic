import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  ensureAuthSession,
  getSupabase,
  hasSupabaseConfig,
  logRealtimeStatus,
  waitForRealtimeAuth,
} from './lib/supabase';

export type PresenceStatus = 'online' | 'away' | 'offline' | 'in_call';

export type PresenceUser = {
  userId: string;
  name: string;
  color: string;
  avatarUrl?: string;
  themeFon?: string;
  lat: number;
  lng: number;
  online: boolean;
  status?: PresenceStatus;
  updatedAt: number;
};

export type GeoPoint = { lat: number; lng: number; source: 'gps' | 'antarctica' };

/** Условная «Антарктида», если GPS недоступен / запрещён. */
export const ANTARCTICA: GeoPoint = { lat: -78.5, lng: 16.5, source: 'antarctica' };

const PRESENCE_CHANNEL = 'paranoic-world';
const GEO_FALLBACK_MS = 7_000;
/** Heartbeat ping в profiles. */
export const PRESENCE_HEARTBEAT_MS = 30_000;
/** last_seen старше этого — считаем offline. */
export const PRESENCE_STALE_MS = 90_000;

export type GeoWatchHandle = { stop: () => void };

export const GEO_BLOCKED_MESSAGE =
  'Браузер блокирует GPS. Нажмите на иконку настроек в адресной строке браузера и разрешите доступ к геоданным.';

export type WatchGeoOptions = {
  /** GPS permission denied by the user / browser. */
  onDenied?: () => void;
};

/**
 * Непрерывный GPS через Geolocation API.
 * При отказе / таймауте / отсутствии API — Антарктида.
 */
export function watchGeo(
  onUpdate: (point: GeoPoint) => void,
  opts?: WatchGeoOptions
): GeoWatchHandle {
  if (!navigator.geolocation) {
    onUpdate({ ...ANTARCTICA });
    return { stop: () => undefined };
  }

  let settled = false;
  let watchId: number | null = null;
  let deniedNotified = false;

  const emit = (point: GeoPoint) => {
    settled = true;
    onUpdate(point);
  };

  const notifyDenied = () => {
    if (deniedNotified) return;
    deniedNotified = true;
    opts?.onDenied?.();
  };

  const fallbackTimer = window.setTimeout(() => {
    if (!settled) emit({ ...ANTARCTICA });
  }, GEO_FALLBACK_MS);

  const onGeoError = (err: GeolocationPositionError) => {
    window.clearTimeout(fallbackTimer);
    if (err.code === err.PERMISSION_DENIED) {
      notifyDenied();
    }
    emit({ ...ANTARCTICA });
  };

  try {
    navigator.geolocation.getCurrentPosition(
      () => undefined,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) notifyDenied();
      },
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 20_000 }
    );
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        window.clearTimeout(fallbackTimer);
        emit({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          source: 'gps',
        });
      },
      onGeoError,
      {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 20_000,
      }
    );
  } catch {
    window.clearTimeout(fallbackTimer);
    notifyDenied();
    emit({ ...ANTARCTICA });
  }

  return {
    stop: () => {
      window.clearTimeout(fallbackTimer);
      if (watchId != null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          /* */
        }
      }
    },
  };
}

/** Одноразовый снимок (для совместимости). */
export async function resolveGeo(): Promise<GeoPoint> {
  return new Promise((resolve) => {
    const handle = watchGeo((point) => {
      handle.stop();
      resolve(point);
    });
  });
}

export type PeerPresenceInfo = {
  userId: string;
  status: PresenceStatus;
  isOnline: boolean;
  lastSeen: string | null;
};

function normalizeStatus(raw: unknown): PresenceStatus {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'online' || v === 'away' || v === 'offline' || v === 'in_call') return v;
  return 'offline';
}

function isFreshLastSeen(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false;
  const t = Date.parse(lastSeen);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= PRESENCE_STALE_MS;
}

/**
 * Принудительный ping в profiles (heartbeat / away / in_call).
 */
export async function pingProfilePresence(
  userId: string,
  status: PresenceStatus
): Promise<void> {
  if (!hasSupabaseConfig() || !userId) return;
  try {
    await ensureAuthSession();
    const sb = getSupabase();
    const { error } = await sb
      .from('profiles')
      .update({
        is_online: status === 'online' || status === 'away' || status === 'in_call',
        last_seen: new Date().toISOString(),
        presence_status: status,
      })
      .eq('id', userId);
    if (error) {
      console.warn('[presence] heartbeat', error.message);
    }
  } catch (e) {
    console.warn('[presence] heartbeat failed', e);
  }
}

/** Быстрый fetch статуса получателя перед звонком. */
export async function fetchPeerPresence(userId: string): Promise<PeerPresenceInfo> {
  if (!hasSupabaseConfig() || !userId) {
    return { userId, status: 'offline', isOnline: false, lastSeen: null };
  }
  try {
    await ensureAuthSession();
    const sb = getSupabase();
    const { data, error } = await sb
      .from('profiles')
      .select('id,is_online,last_seen,presence_status')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) {
      if (error) console.warn('[presence] fetch peer', error.message);
      return { userId, status: 'offline', isOnline: false, lastSeen: null };
    }
    const row = data as {
      id?: string;
      is_online?: boolean;
      last_seen?: string | null;
      presence_status?: string | null;
    };
    const lastSeen = row.last_seen ?? null;
    let status = normalizeStatus(row.presence_status);
    if (status === 'in_call') {
      return { userId, status: 'in_call', isOnline: true, lastSeen };
    }
    if (!isFreshLastSeen(lastSeen)) {
      return { userId, status: 'offline', isOnline: false, lastSeen };
    }
    if (status === 'offline' && row.is_online) status = 'online';
    if (status === 'offline') {
      return { userId, status: 'offline', isOnline: false, lastSeen };
    }
    return {
      userId,
      status,
      isOnline: true,
      lastSeen,
    };
  } catch (e) {
    console.warn('[presence] fetch peer failed', e);
    return { userId, status: 'offline', isOnline: false, lastSeen: null };
  }
}

/** Пометить участников звонка как in_call / снять занятость. */
export async function setUsersCallPresence(
  userIds: string[],
  inCall: boolean
): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length || !hasSupabaseConfig()) return;
  const status: PresenceStatus = inCall ? 'in_call' : 'online';
  await Promise.all(unique.map((id) => pingProfilePresence(id, status)));
}

type PresenceHandlers = {
  onSync?: (users: PresenceUser[]) => void;
  onError?: (err: Error) => void;
};

/**
 * Presence: Realtime channel (карта / быстрые события)
 * + profiles heartbeat каждые 30с (надёжный online).
 */
export class WorldPresence {
  private channel: RealtimeChannel | null = null;
  private handlers: PresenceHandlers;
  private me: PresenceUser | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private pageStatus: PresenceStatus = 'online';
  private inCall = false;

  constructor(handlers: PresenceHandlers = {}) {
    this.handlers = handlers;
  }

  async start(me: Omit<PresenceUser, 'online' | 'updatedAt' | 'status'>): Promise<void> {
    if (!hasSupabaseConfig()) {
      this.handlers.onError?.(new Error('Supabase не настроен'));
      return;
    }

    const session = await waitForRealtimeAuth('presence');
    if (me.userId && me.userId !== session.user.id) {
      console.error('[REALTIME FAIL - paranoic-world] identity.id ≠ auth.uid()', {
        identityId: me.userId,
        authUid: session.user.id,
      });
    }
    const userId = session.user.id;

    await this.stop();
    this.pageStatus = document.visibilityState === 'visible' ? 'online' : 'away';
    this.inCall = false;
    this.me = {
      ...me,
      userId,
      online: true,
      status: this.pageStatus,
      updatedAt: Date.now(),
    };

    const sb = getSupabase();
    const channel = sb.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: userId } },
    });

    channel.on('presence', { event: 'sync' }, () => {
      this.handlers.onSync?.(this.collect());
    });

    await new Promise<void>((resolve, reject) => {
      const logStatus = logRealtimeStatus(PRESENCE_CHANNEL, { uid: userId });
      channel.subscribe(async (status, err) => {
        logStatus(status, err);
        if (status === 'SUBSCRIBED') {
          await channel.track(this.me!);
          resolve();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          reject(new Error(`Не удалось подключить presence (${status}${err ? `: ${err.message}` : ''})`));
        }
      });
    });

    this.channel = channel;
    this.bindVisibility();
    this.startHeartbeat();
    await this.heartbeat();
    this.handlers.onSync?.(this.collect());
  }

  /** Занятость на время звонка — heartbeat пишет in_call. */
  setInCall(active: boolean): void {
    this.inCall = active;
    if (active) {
      this.pageStatus = 'in_call';
    } else {
      this.pageStatus = document.visibilityState === 'visible' ? 'online' : 'away';
    }
    if (this.me) {
      this.me = {
        ...this.me,
        online: true,
        status: this.pageStatus,
        updatedAt: Date.now(),
      };
      void this.channel?.track(this.me);
    }
    void this.heartbeat();
  }

  private bindVisibility(): void {
    if (this.visibilityHandler || typeof document === 'undefined') return;
    this.visibilityHandler = () => {
      if (this.inCall) {
        this.pageStatus = 'in_call';
        void this.heartbeat();
        return;
      }
      if (document.visibilityState === 'visible') {
        this.pageStatus = 'online';
        if (this.me) {
          this.me = { ...this.me, online: true, status: 'online', updatedAt: Date.now() };
          void this.channel?.track(this.me);
        }
        void this.heartbeat();
      } else {
        this.pageStatus = 'away';
        if (this.me) {
          this.me = { ...this.me, online: true, status: 'away', updatedAt: Date.now() };
          void this.channel?.track(this.me);
        }
        void this.heartbeat();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      void this.heartbeat();
    }, PRESENCE_HEARTBEAT_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer != null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async heartbeat(): Promise<void> {
    if (!this.me) return;
    const status: PresenceStatus = this.inCall
      ? 'in_call'
      : this.pageStatus === 'away'
        ? 'away'
        : 'online';
    this.pageStatus = status;
    this.me = { ...this.me, online: true, status, updatedAt: Date.now() };
    try {
      await this.channel?.track(this.me);
    } catch {
      /* */
    }
    await pingProfilePresence(this.me.userId, status);
  }

  async updateLocation(lat: number, lng: number): Promise<void> {
    if (!this.channel || !this.me) return;
    if (this.me.lat === lat && this.me.lng === lng) return;
    this.me = {
      ...this.me,
      lat,
      lng,
      updatedAt: Date.now(),
      online: true,
      status: this.pageStatus,
    };
    await this.channel.track(this.me);
  }

  async updateProfile(
    patch: Partial<Pick<PresenceUser, 'name' | 'color' | 'avatarUrl' | 'themeFon' | 'lat' | 'lng'>>
  ): Promise<void> {
    if (!this.channel || !this.me) return;
    this.me = {
      ...this.me,
      ...patch,
      updatedAt: Date.now(),
      online: true,
      status: this.pageStatus,
    };
    await this.channel.track(this.me);
  }

  collect(): PresenceUser[] {
    if (!this.channel) return [];
    const state = this.channel.presenceState<PresenceUser>();
    const out: PresenceUser[] = [];
    for (const key of Object.keys(state)) {
      const metas = state[key];
      const latest = metas?.[metas.length - 1];
      if (latest?.userId) {
        out.push({
          ...latest,
          online: latest.status !== 'offline',
          status: latest.status ?? 'online',
        });
      }
    }
    return out;
  }

  async stop(): Promise<void> {
    this.clearHeartbeat();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    const meId = this.me?.userId;
    const ch = this.channel;
    this.channel = null;
    this.me = null;
    this.inCall = false;
    this.pageStatus = 'offline';
    if (meId) {
      void pingProfilePresence(meId, 'offline');
    }
    if (!ch) return;
    try {
      await ch.untrack();
    } catch {
      /* */
    }
    try {
      await ch.unsubscribe();
      getSupabase().removeChannel(ch);
    } catch {
      /* */
    }
  }
}
