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
/** Ignore tiny GPS jitter — only emit after ~this many meters. */
const GEO_MIN_MOVE_M = 40;
/** Floor between emitted GPS updates even if moving (battery). */
const GEO_MIN_EMIT_MS = 60_000;
/** Browser may reuse a recent fix — avoid forcing a fresh GPS every few seconds. */
const GEO_MAX_AGE_MS = 120_000;

export type GeoWatchHandle = { stop: () => void };

export const GEO_BLOCKED_MESSAGE =
  'Браузер блокирует GPS. Нажмите на иконку настроек в адресной строке браузера и разрешите доступ к геоданным.';

export type WatchGeoOptions = {
  /** GPS permission denied by the user / browser. */
  onDenied?: () => void;
};

function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Passive GPS via Geolocation.watchPosition (no polling interval).
 * - Low-power continuous watch (enableHighAccuracy: false)
 * - Emits only on meaningful moves / time floor
 * - Pauses the watch while the document is hidden
 * - Falls back to Antarctica on deny / timeout / missing API
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
  let stopped = false;
  let lastEmit: { lat: number; lng: number; at: number } | null = null;
  let visibilityHandler: (() => void) | null = null;

  const emit = (point: GeoPoint, force = false) => {
    if (stopped) return;
    settled = true;
    if (point.source === 'gps' && !force && lastEmit) {
      const moved = haversineMeters(lastEmit.lat, lastEmit.lng, point.lat, point.lng);
      const elapsed = Date.now() - lastEmit.at;
      if (moved < GEO_MIN_MOVE_M && elapsed < GEO_MIN_EMIT_MS) return;
    }
    if (point.source === 'gps') {
      lastEmit = { lat: point.lat, lng: point.lng, at: Date.now() };
    }
    onUpdate(point);
  };

  const notifyDenied = () => {
    if (deniedNotified) return;
    deniedNotified = true;
    opts?.onDenied?.();
  };

  const fallbackTimer = window.setTimeout(() => {
    if (!settled) emit({ ...ANTARCTICA }, true);
  }, GEO_FALLBACK_MS);

  const onGeoError = (err: GeolocationPositionError) => {
    window.clearTimeout(fallbackTimer);
    if (err.code === err.PERMISSION_DENIED) {
      notifyDenied();
      emit({ ...ANTARCTICA }, true);
      return;
    }
    // Timeout / unavailable: keep last fix if any; otherwise Antarctica once.
    if (!settled) emit({ ...ANTARCTICA }, true);
  };

  const clearWatch = () => {
    if (watchId == null) return;
    try {
      navigator.geolocation.clearWatch(watchId);
    } catch {
      /* */
    }
    watchId = null;
  };

  const startWatch = () => {
    if (stopped || watchId != null) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
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
          // Continuous high-accuracy polling lights the OS location indicator
          // every ~maximumAge window. Prefer a passive, battery-friendly watch.
          enableHighAccuracy: false,
          timeout: 20_000,
          maximumAge: GEO_MAX_AGE_MS,
        }
      );
    } catch {
      window.clearTimeout(fallbackTimer);
      notifyDenied();
      emit({ ...ANTARCTICA }, true);
    }
  };

  const pauseWatch = () => {
    clearWatch();
  };

  try {
    startWatch();
  } catch {
    window.clearTimeout(fallbackTimer);
    notifyDenied();
    emit({ ...ANTARCTICA }, true);
  }

  if (typeof document !== 'undefined') {
    visibilityHandler = () => {
      if (stopped) return;
      if (document.visibilityState === 'hidden') pauseWatch();
      else startWatch();
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }

  return {
    stop: () => {
      stopped = true;
      window.clearTimeout(fallbackTimer);
      clearWatch();
      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
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
  status?: PresenceStatus,
  location?: { lat: number; lng: number } | null
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
    if (location) {
      const latitude = Number(location.lat);
      const longitude = Number(location.lng);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        patch.latitude = latitude;
        patch.longitude = longitude;
      }
    }
    const { error } = await sb.from('profiles').update(patch).eq('id', userId);
    if (error) {
      if (location && /latitude|longitude|column/i.test(error.message)) {
        const { latitude: _lat, longitude: _lng, ...base } = patch;
        const retry = await sb.from('profiles').update(base).eq('id', userId);
        if (retry.error) console.warn('[presence] heartbeat', retry.error.message);
        return;
      }
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
 * Прямой API-heartbeat: каждые 15с пишет is_online + last_seen (+ координаты) в profiles.
 */
export function startHeartbeat(
  userId: string,
  getLocation?: () => { lat: number; lng: number } | null
): () => void {
  stopHeartbeat();
  if (!userId) return stopHeartbeat;
  heartbeatUserId = userId;
  const tick = () => {
    if (heartbeatUserId !== userId) return;
    void writeProfileHeartbeat(userId, true, undefined, getLocation?.() ?? null);
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

type ProfileGeoRow = {
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
};

function coordsFromProfileRow(row: ProfileGeoRow): { lat: number; lng: number } | null {
  const latRaw = row.latitude ?? row.lat;
  const lngRaw = row.longitude ?? row.lng;
  if (latRaw == null || lngRaw == null) return null;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

const PROFILE_PRESENCE_BASE =
  'id,name,color,avatar_url,theme_fon,is_online,last_seen,presence_status';
const PROFILE_PRESENCE_GEO = `${PROFILE_PRESENCE_BASE},latitude,longitude`;

/** Presence + координаты только для переданных user id (контакты / активные чаты). */
export async function getContactsPresence(userIds: string[]): Promise<PresenceUser[]> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!hasSupabaseConfig() || unique.length === 0) return [];
  try {
    await ensureAuthSession();
    const sb = getSupabase();
    let data: unknown[] | null = null;
    let error: { message: string } | null = null;
    ({ data, error } = await sb.from('profiles').select(PROFILE_PRESENCE_GEO).in('id', unique));
    if (error && /latitude|longitude|column/i.test(error.message)) {
      ({ data, error } = await sb.from('profiles').select(PROFILE_PRESENCE_BASE).in('id', unique));
    }
    if (error) {
      console.warn('[presence] getContactsPresence', error.message);
      return [];
    }
    const rows = (data ?? []) as Array<
      ProfileGeoRow & {
        id?: string;
        name?: string | null;
        color?: string | null;
        avatar_url?: string | null;
        theme_fon?: string | null;
        is_online?: boolean | null;
        last_seen?: string | null;
        presence_status?: string | null;
      }
    >;
    const out: PresenceUser[] = [];
    for (const row of rows) {
      const userId = String(row.id ?? '').trim();
      if (!userId) continue;
      const online = isHeartbeatOnline(row.is_online, row.last_seen);
      const status = normalizeStatus(row.presence_status);
      const coords = coordsFromProfileRow(row);
      out.push({
        userId,
        name: row.name?.trim() || userId.slice(0, 8),
        color: row.color?.trim() || '#60a5fa',
        avatarUrl: row.avatar_url || undefined,
        themeFon: row.theme_fon || undefined,
        lat: coords?.lat ?? ANTARCTICA.lat,
        lng: coords?.lng ?? ANTARCTICA.lng,
        online,
        status: online ? (status === 'offline' ? 'online' : status) : 'offline',
        updatedAt: row.last_seen ? Date.parse(row.last_seen) || Date.now() : Date.now(),
        hasLocation: coords != null,
      });
    }
    return out;
  } catch (e) {
    console.warn('[presence] getContactsPresence failed', e);
    return [];
  }
}

/** @deprecated Используйте getContactsPresence с id контактов. */
export async function getOnlineUsers(): Promise<PresenceUser[]> {
  return getContactsPresence([]);
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
 * Контакты: периодический getContactsPresence(contactUserIds).
 */
export class WorldPresence {
  private handlers: PresenceHandlers;
  private me: PresenceUser | null = null;
  private lastOnline: PresenceUser[] = [];
  private contactUserIds: string[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private inCall = false;

  constructor(handlers: PresenceHandlers = {}) {
    this.handlers = handlers;
  }

  /** Ограничить опрос profiles списком контактов / активных чатов. */
  setContactUserIds(userIds: string[]): void {
    const next = [...new Set(userIds.filter(Boolean))];
    if (
      next.length === this.contactUserIds.length &&
      next.every((id, i) => id === this.contactUserIds[i])
    ) {
      return;
    }
    this.contactUserIds = next;
    void this.syncOnlineUsers();
  }

  private currentLocation(): { lat: number; lng: number } | null {
    if (!this.me?.hasLocation) return null;
    return { lat: this.me.lat, lng: this.me.lng };
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
      void writeProfileHeartbeat(userId, true, 'online', this.currentLocation());
      startHeartbeat(userId, () => this.currentLocation());
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
        startHeartbeat(userId, () => this.currentLocation());
      }
    } else if (document.visibilityState === 'visible') {
      if (this.me) {
        this.me = { ...this.me, online: true, status: 'online', updatedAt: Date.now() };
      }
      void pingProfilePresence(userId, 'online');
      startHeartbeat(userId, () => this.currentLocation());
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
      await writeProfileHeartbeat(
        userId,
        true,
        this.inCall ? 'in_call' : 'online',
        this.currentLocation()
      );
      startHeartbeat(userId, () => this.currentLocation());
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
    this.lastOnline = await getContactsPresence(this.contactUserIds);
    this.emitSync();
  }

  private emitSync(): void {
    this.handlers.onSync?.(this.collect());
  }

  async updateLocation(lat: number, lng: number): Promise<void> {
    if (!this.me) return;
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    if (this.me.lat === latitude && this.me.lng === longitude) return;
    this.me = {
      ...this.me,
      lat: latitude,
      lng: longitude,
      updatedAt: Date.now(),
      hasLocation: true,
    };
    const userId = this.me.userId;
    if (userId && document.visibilityState === 'visible') {
      void writeProfileHeartbeat(userId, true, this.inCall ? 'in_call' : 'online', {
        lat: latitude,
        lng: longitude,
      });
    }
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
