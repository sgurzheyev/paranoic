import {
  ensureAuthSession,
  getSupabase,
  hasSupabaseConfig,
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
  /** Живые координаты (свой GPS). Опрос profiles даёт только online-флаг. */
  hasLocation?: boolean;
};

export type GeoPoint = { lat: number; lng: number; source: 'gps' | 'antarctica' };

/** Условная «Антарктида», если GPS недоступен / запрещён. */
export const ANTARCTICA: GeoPoint = { lat: -78.5, lng: 16.5, source: 'antarctica' };

const GEO_FALLBACK_MS = 7_000;
/** Heartbeat ping в profiles. */
export const PRESENCE_HEARTBEAT_MS = 15_000;
/** last_seen старше этого — считаем offline. */
export const PRESENCE_STALE_MS = 45_000;
/** Как часто опрашивать список онлайн-профилей для UI. */
export const PRESENCE_POLL_MS = 15_000;

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

export function isFreshLastSeen(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false;
  const t = Date.parse(lastSeen);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= PRESENCE_STALE_MS;
}

/** is_online + свежий last_seen (≤ 45с). */
export function isHeartbeatOnline(
  isOnline: boolean | null | undefined,
  lastSeen: string | null | undefined
): boolean {
  return Boolean(isOnline) && isFreshLastSeen(lastSeen);
}

async function writeProfileHeartbeat(
  userId: string,
  online: boolean,
  status?: PresenceStatus
): Promise<void> {
  if (!hasSupabaseConfig() || !userId) return;
  try {
    await ensureAuthSession();
    const sb = getSupabase();
    const patch: Record<string, unknown> = {
      is_online: online,
      last_seen: new Date().toISOString(),
    };
    if (status) patch.presence_status = status;
    const { error } = await sb.from('profiles').update(patch).eq('id', userId);
    if (error) {
      console.warn('[presence] heartbeat', error.message);
    }
  } catch (e) {
    console.warn('[presence] heartbeat failed', e);
  }
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatUserId = '';

export function stopHeartbeat(): void {
  if (heartbeatTimer != null) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  heartbeatUserId = '';
}

/**
 * Прямой API-heartbeat: каждые 15с пишет is_online + last_seen в profiles.
 * Возвращает disposer (stopHeartbeat).
 */
export function startHeartbeat(userId: string): () => void {
  stopHeartbeat();
  if (!userId) return stopHeartbeat;
  heartbeatUserId = userId;
  const tick = () => {
    if (heartbeatUserId !== userId) return;
    void writeProfileHeartbeat(userId, true);
  };
  tick();
  heartbeatTimer = window.setInterval(tick, PRESENCE_HEARTBEAT_MS);
  return stopHeartbeat;
}

/**
 * Принудительный ping в profiles (heartbeat / away / in_call).
 */
export async function pingProfilePresence(
  userId: string,
  status: PresenceStatus
): Promise<void> {
  const online = status === 'online' || status === 'away' || status === 'in_call';
  await writeProfileHeartbeat(userId, online, status);
}

/** Профили с is_online = true и last_seen не старше 45 секунд. */
export async function getOnlineUsers(): Promise<PresenceUser[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    await ensureAuthSession();
    const sb = getSupabase();
    const cutoff = new Date(Date.now() - PRESENCE_STALE_MS).toISOString();
    const { data, error } = await sb
      .from('profiles')
      .select('id,name,color,avatar_url,theme_fon,is_online,last_seen,presence_status')
      .eq('is_online', true)
      .gte('last_seen', cutoff);
    if (error) {
      console.warn('[presence] getOnlineUsers', error.message);
      return [];
    }
    const rows = (data ?? []) as Array<{
      id?: string;
      name?: string | null;
      color?: string | null;
      avatar_url?: string | null;
      theme_fon?: string | null;
      is_online?: boolean | null;
      last_seen?: string | null;
      presence_status?: string | null;
    }>;
    const out: PresenceUser[] = [];
    for (const row of rows) {
      const userId = String(row.id ?? '').trim();
      if (!userId) continue;
      if (!isHeartbeatOnline(row.is_online, row.last_seen)) continue;
      const status = normalizeStatus(row.presence_status);
      out.push({
        userId,
        name: row.name?.trim() || userId.slice(0, 8),
        color: row.color?.trim() || '#60a5fa',
        avatarUrl: row.avatar_url || undefined,
        themeFon: row.theme_fon || undefined,
        lat: ANTARCTICA.lat,
        lng: ANTARCTICA.lng,
        online: true,
        status: status === 'offline' ? 'online' : status,
        updatedAt: row.last_seen ? Date.parse(row.last_seen) || Date.now() : Date.now(),
        hasLocation: false,
      });
    }
    return out;
  } catch (e) {
    console.warn('[presence] getOnlineUsers failed', e);
    return [];
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
      is_online?: boolean;
      last_seen?: string | null;
      presence_status?: string | null;
    };
    const lastSeen = row.last_seen ?? null;
    const fresh = isHeartbeatOnline(row.is_online, lastSeen);
    const status = normalizeStatus(row.presence_status);
    if (status === 'in_call' && fresh) {
      return { userId, status: 'in_call', isOnline: true, lastSeen };
    }
    if (!fresh) {
      return { userId, status: 'offline', isOnline: false, lastSeen };
    }
    return {
      userId,
      status: status === 'offline' ? 'online' : status,
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
 * Presence через API heartbeat (без Realtime channel.track).
 * Свой профиль: setInterval 15с → profiles.is_online / last_seen.
 * Контакты: периодический getOnlineUsers().
 */
export class WorldPresence {
  private handlers: PresenceHandlers;
  private me: PresenceUser | null = null;
  private lastOnline: PresenceUser[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private inCall = false;

  constructor(handlers: PresenceHandlers = {}) {
    this.handlers = handlers;
  }

  async start(me: Omit<PresenceUser, 'online' | 'updatedAt' | 'status'>): Promise<void> {
    if (!hasSupabaseConfig()) {
      this.handlers.onError?.(new Error('Supabase не настроен'));
      return;
    }

    let userId = me.userId;
    try {
      const session = await ensureAuthSession();
      if (me.userId && me.userId !== session.user.id) {
        console.error('[presence] identity.id ≠ auth.uid()', {
          identityId: me.userId,
          authUid: session.user.id,
        });
      }
      userId = session.user.id;
    } catch (e) {
      this.handlers.onError?.(e instanceof Error ? e : new Error('Нет сессии Auth'));
      return;
    }

    await this.stop();
    this.inCall = false;
    this.me = {
      ...me,
      userId,
      online: document.visibilityState !== 'hidden',
      status: document.visibilityState === 'hidden' ? 'offline' : 'online',
      updatedAt: Date.now(),
      hasLocation: true,
    };

    this.bindVisibility();
    if (document.visibilityState !== 'hidden') {
      void writeProfileHeartbeat(userId, true, 'online');
      startHeartbeat(userId);
    } else {
      void writeProfileHeartbeat(userId, false, 'offline');
    }
    this.startOnlinePoll();
    await this.syncOnlineUsers();
  }

  /** Занятость на время звонка. */
  setInCall(active: boolean): void {
    this.inCall = active;
    const userId = this.me?.userId;
    if (!userId) return;
    if (active) {
      if (this.me) {
        this.me = { ...this.me, online: true, status: 'in_call', updatedAt: Date.now() };
      }
      void pingProfilePresence(userId, 'in_call');
      if (document.visibilityState === 'visible') {
        startHeartbeat(userId);
      }
    } else if (document.visibilityState === 'visible') {
      if (this.me) {
        this.me = { ...this.me, online: true, status: 'online', updatedAt: Date.now() };
      }
      void pingProfilePresence(userId, 'online');
      startHeartbeat(userId);
    } else {
      void this.markHidden();
    }
    this.emitSync();
  }

  private bindVisibility(): void {
    if (this.visibilityHandler || typeof document === 'undefined') return;
    this.visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        void this.markHidden();
      } else {
        void this.markVisible();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private async markHidden(): Promise<void> {
    stopHeartbeat();
    const userId = this.me?.userId;
    if (this.me) {
      this.me = { ...this.me, online: false, status: 'offline', updatedAt: Date.now() };
    }
    if (userId) {
      await writeProfileHeartbeat(userId, false, this.inCall ? 'in_call' : 'offline');
    }
    this.emitSync();
  }

  private async markVisible(): Promise<void> {
    const userId = this.me?.userId;
    if (this.me) {
      this.me = {
        ...this.me,
        online: true,
        status: this.inCall ? 'in_call' : 'online',
        updatedAt: Date.now(),
      };
    }
    if (userId) {
      await writeProfileHeartbeat(userId, true, this.inCall ? 'in_call' : 'online');
      startHeartbeat(userId);
    }
    await this.syncOnlineUsers();
  }

  private startOnlinePoll(): void {
    this.clearOnlinePoll();
    this.pollTimer = window.setInterval(() => {
      void this.syncOnlineUsers();
    }, PRESENCE_POLL_MS);
  }

  private clearOnlinePoll(): void {
    if (this.pollTimer != null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async syncOnlineUsers(): Promise<void> {
    this.lastOnline = await getOnlineUsers();
    this.emitSync();
  }

  private emitSync(): void {
    this.handlers.onSync?.(this.collect());
  }

  async updateLocation(lat: number, lng: number): Promise<void> {
    if (!this.me) return;
    if (this.me.lat === lat && this.me.lng === lng) return;
    this.me = {
      ...this.me,
      lat,
      lng,
      updatedAt: Date.now(),
      hasLocation: true,
    };
    this.emitSync();
  }

  async updateProfile(
    patch: Partial<Pick<PresenceUser, 'name' | 'color' | 'avatarUrl' | 'themeFon' | 'lat' | 'lng'>>
  ): Promise<void> {
    if (!this.me) return;
    this.me = {
      ...this.me,
      ...patch,
      updatedAt: Date.now(),
    };
    this.emitSync();
  }

  collect(): PresenceUser[] {
    const mine = this.me?.userId;
    const others = this.lastOnline.filter((u) => u.userId !== mine);
    return this.me ? [this.me, ...others] : others;
  }

  async stop(): Promise<void> {
    this.clearOnlinePoll();
    stopHeartbeat();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    const meId = this.me?.userId;
    this.me = null;
    this.lastOnline = [];
    this.inCall = false;
    if (meId) {
      void writeProfileHeartbeat(meId, false, 'offline');
    }
  }
}
