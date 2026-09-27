/**
 * Open-Meteo → visual weather for the Family map.
 * Coordinates are rounded to 0.1° and cached for 12 minutes.
 * HTTP 429 backs off (15 min, then doubles, capped at 60 min).
 */
import type { MapSpectrumLook } from '../lib/mapbox';

export type MapWeatherMode = 'clear' | 'sandstorm' | 'rain';

export type OpenMeteoCurrent = {
  temperature?: number;
  windspeed?: number;
  winddirection?: number;
  weathercode?: number;
  time?: string;
};

export type WeatherSnapshot = {
  mode: MapWeatherMode;
  current: OpenMeteoCurrent | null;
  error: string | null;
  cooling: boolean;
  demo: boolean;
  fetchedAt: number | null;
};

export const WEATHER_IDLE: WeatherSnapshot = {
  mode: 'clear',
  current: null,
  error: null,
  cooling: false,
  demo: false,
  fetchedAt: null,
};

/** Labeled sample so screenshots work without a live Open-Meteo response. */
export const DEMO_WEATHER: WeatherSnapshot = {
  mode: 'rain',
  current: { temperature: 22, windspeed: 18, weathercode: 63 },
  error: null,
  cooling: false,
  demo: true,
  fetchedAt: null,
};

const CACHE_MS = 12 * 60 * 1000;
const CELL_DEG = 0.1;
const MIN_GAP_MS = 8_000;
const BACKOFF_START_MS = 15 * 60 * 1000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;

type CacheRow = {
  at: number;
  mode: MapWeatherMode;
  current: OpenMeteoCurrent;
};

const cache = new Map<string, CacheRow>();
let lastRequestAt = 0;
let backoffUntil = 0;
let backoffMs = 0;

export function roundWeatherCell(lat: number, lng: number): { lat: number; lng: number; key: string } {
  const latN = Math.max(-90, Math.min(90, Math.round(lat / CELL_DEG) * CELL_DEG));
  const lngN = Math.max(-180, Math.min(180, Math.round(lng / CELL_DEG) * CELL_DEG));
  return { lat: latN, lng: lngN, key: `${latN.toFixed(1)},${lngN.toFixed(1)}` };
}

/**
 * Open-Meteo current_weather → visual mode.
 * Wind is km/h; 36 km/h ≈ 10 m/s. WMO 51–67 and 80–82 are rain.
 */
export function weatherModeFromOpenMeteo(windspeedKmh: number, weathercode: number): MapWeatherMode {
  const wind = Number(windspeedKmh);
  const code = Math.floor(Number(weathercode));
  if (Number.isFinite(wind) && wind > 36) return 'sandstorm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'clear';
}

type Fog = MapSpectrumLook['fog'];

export const SANDSTORM_FOG: Fog = {
  range: [0.15, 3.2],
  color: '#D8D0C1',
  'high-color': '#E1DACB',
  'horizon-blend': 0.42,
  'space-color': '#C5BFA9',
  'star-intensity': 0.04,
};

export function applyWeatherFog(mode: MapWeatherMode, base: Fog): Fog {
  if (mode === 'sandstorm') return { ...SANDSTORM_FOG };
  if (mode === 'rain') {
    return {
      ...base,
      range: [0.45, 5.5],
      color: '#1e293b',
      'high-color': '#334155',
      'horizon-blend': 0.28,
      'star-intensity': Math.min(0.35, base['star-intensity']),
    };
  }
  return base;
}

function aborted(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

async function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(aborted());
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchCachedOpenMeteo(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<WeatherSnapshot> {
  const cell = roundWeatherCell(latitude, longitude);
  const now = Date.now();
  const hit = cache.get(cell.key);
  if (hit && now - hit.at < CACHE_MS) {
    return {
      mode: hit.mode,
      current: hit.current,
      error: null,
      cooling: false,
      demo: false,
      fetchedAt: hit.at,
    };
  }
  if (now < backoffUntil) {
    if (hit) {
      return {
        mode: hit.mode,
        current: hit.current,
        error: null,
        cooling: true,
        demo: false,
        fetchedAt: hit.at,
      };
    }
    return { ...WEATHER_IDLE, error: 'cooling', cooling: true };
  }

  await waitMs(MIN_GAP_MS - (now - lastRequestAt), signal);
  if (signal?.aborted) throw aborted();

  lastRequestAt = Date.now();
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', cell.lat.toFixed(1));
  url.searchParams.set('longitude', cell.lng.toFixed(1));
  url.searchParams.set('current_weather', 'true');

  const res = await fetch(url.toString(), { signal });
  if (res.status === 429) {
    backoffMs = backoffMs === 0 ? BACKOFF_START_MS : Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    backoffUntil = Date.now() + backoffMs;
    if (hit) {
      return {
        mode: hit.mode,
        current: hit.current,
        error: null,
        cooling: true,
        demo: false,
        fetchedAt: hit.at,
      };
    }
    return { ...WEATHER_IDLE, error: 'cooling', cooling: true };
  }
  if (!res.ok) {
    return { ...WEATHER_IDLE, error: `http-${res.status}` };
  }

  backoffMs = 0;
  backoffUntil = 0;
  const data = (await res.json()) as { current_weather?: OpenMeteoCurrent };
  const current = data.current_weather ?? {};
  const mode = weatherModeFromOpenMeteo(Number(current.windspeed ?? 0), Number(current.weathercode ?? 0));
  const row: CacheRow = { at: Date.now(), mode, current };
  cache.set(cell.key, row);
  return {
    mode,
    current,
    error: null,
    cooling: false,
    demo: false,
    fetchedAt: row.at,
  };
}
