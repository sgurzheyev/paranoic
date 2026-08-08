import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, hasSupabaseConfig } from './lib/supabase';

export type PresenceUser = {
  userId: string;
  name: string;
  color: string;
  lat: number;
  lng: number;
  online: boolean;
  updatedAt: number;
};

export type GeoPoint = { lat: number; lng: number; source: 'gps' | 'antarctica' };

/** Условная «Антарктида», если GPS недоступен. */
export const ANTARCTICA: GeoPoint = { lat: -78.5, lng: 16.5, source: 'antarctica' };

const PRESENCE_CHANNEL = 'paranoic-world';

export async function resolveGeo(): Promise<GeoPoint> {
  if (!navigator.geolocation) return { ...ANTARCTICA };

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ...ANTARCTICA }), 6000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          source: 'gps',
        });
      },
      () => {
        clearTimeout(timer);
        resolve({ ...ANTARCTICA });
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 120_000 }
    );
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
    this.me = { ...this.me, lat, lng, updatedAt: Date.now(), online: true };
    await this.channel.track(this.me);
  }

  async updateProfile(patch: Partial<Pick<PresenceUser, 'name' | 'color' | 'lat' | 'lng'>>): Promise<void> {
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
