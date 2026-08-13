import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, hasSupabaseConfig } from './lib/supabase';

export type PresenceUser = {
  userId: string;
  name: string;
  color: string;
  avatarUrl?: string;
  themeFon?: string;
  lat: number;
  lng: number;
  online: boolean;
  updatedAt: number;
};

export type GeoPoint = { lat: number; lng: number; source: 'gps' | 'antarctica' };

/** Условная «Антарктида», если GPS недоступен / запрещён. */
export const ANTARCTICA: GeoPoint = { lat: -78.5, lng: 16.5, source: 'antarctica' };

const PRESENCE_CHANNEL = 'paranoic-world';
const GEO_FALLBACK_MS = 7_000;

export type GeoWatchHandle = { stop: () => void };

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

  const emit = (point: GeoPoint) => {
    settled = true;
    onUpdate(point);
  };

  const fallbackTimer = window.setTimeout(() => {
    if (!settled) emit({ ...ANTARCTICA });
  }, GEO_FALLBACK_MS);

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
      (err) => {
        window.clearTimeout(fallbackTimer);
        if (err.code === err.PERMISSION_DENIED) {
          opts?.onDenied?.();
        }
        emit({ ...ANTARCTICA });
      },
      {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 20_000,
      }
    );
  } catch {
    window.clearTimeout(fallbackTimer);
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

type PresenceHandlers = {
  onSync?: (users: PresenceUser[]) => void;
  onError?: (err: Error) => void;
};

/**
 * Глобальный presence: кто в сети и где на карте.
 * Track key = userId.
 */
export class WorldPresence {
  private channel: RealtimeChannel | null = null;
  private handlers: PresenceHandlers;
  private me: PresenceUser | null = null;

  constructor(handlers: PresenceHandlers = {}) {
    this.handlers = handlers;
  }

  async start(me: Omit<PresenceUser, 'online' | 'updatedAt'>): Promise<void> {
    if (!hasSupabaseConfig()) {
      this.handlers.onError?.(new Error('Supabase не настроен'));
      return;
    }

    await this.stop();
    this.me = {
      ...me,
      online: true,
      updatedAt: Date.now(),
    };

    const sb = getSupabase();
    const channel = sb.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: me.userId } },
    });

    channel.on('presence', { event: 'sync' }, () => {
      this.handlers.onSync?.(this.collect());
    });

    await new Promise<void>((resolve, reject) => {
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track(this.me!);
          resolve();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error('Не удалось подключить presence'));
        }
      });
    });

    this.channel = channel;
    this.handlers.onSync?.(this.collect());
  }

  async updateLocation(lat: number, lng: number): Promise<void> {
    if (!this.channel || !this.me) return;
    if (this.me.lat === lat && this.me.lng === lng) return;
    this.me = { ...this.me, lat, lng, updatedAt: Date.now(), online: true };
    await this.channel.track(this.me);
  }

  async updateProfile(
    patch: Partial<Pick<PresenceUser, 'name' | 'color' | 'avatarUrl' | 'themeFon' | 'lat' | 'lng'>>
  ): Promise<void> {
    if (!this.channel || !this.me) return;
    this.me = { ...this.me, ...patch, updatedAt: Date.now(), online: true };
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
        out.push({ ...latest, online: true });
      }
    }
    return out;
  }

  async stop(): Promise<void> {
    const ch = this.channel;
    this.channel = null;
    this.me = null;
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
