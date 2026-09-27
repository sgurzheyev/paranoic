/**
 * Same-origin live-traffic fetches. The browser never opens AISStream
 * and never sees AISSTREAM_API_KEY. The Capacitor shell calls the
 * deployed site because the WebView origin is not Vercel.
 */
import { Capacitor } from '@capacitor/core';
import { PUBLIC_APP_ORIGIN } from '../identity';
import {
  bboxCenter,
  bboxRadiusNm,
  capTrafficEntities,
  type GeoBbox,
  type LiveTrafficEntity,
} from './liveTraffic';

export const OPENSKY_STATES_PATH = '/api/opensky-states';
export const ADSB_NEARBY_PATH = '/api/adsb-nearby';
export const AIS_NEARBY_PATH = '/api/ais-nearby';

function liveApiUrl(path: string): string {
  if (import.meta.env.DEV) return path;
  if (Capacitor.isNativePlatform()) return `${PUBLIC_APP_ORIGIN}${path}`;
  return path;
}

function finiteNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

type OpenSkyResponse = {
  time?: number;
  states?: unknown[] | null;
  error?: string;
};

type AdsbAircraft = {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  track?: number;
  gs?: number;
};

type AdsbResponse = {
  ac?: AdsbAircraft[] | null;
  aircraft?: AdsbAircraft[] | null;
  error?: string;
};

export function parseOpenSkyStates(payload: OpenSkyResponse | null | undefined): LiveTrafficEntity[] {
  const rows = Array.isArray(payload?.states) ? payload.states : [];
  const out: LiveTrafficEntity[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 8) continue;
    const lng = finiteNum(row[5]);
    const lat = finiteNum(row[6]);
    if (lat == null || lng == null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const icao = String(row[0] || '').trim().toLowerCase();
    if (!icao) continue;
    const callsign = String(row[1] || '').trim() || icao.toUpperCase();
    const baro = finiteNum(row[7]);
    const geo = finiteNum(row[13]);
    const heading = finiteNum(row[10]);
    const velocityMs = finiteNum(row[9]);
    const onGround = row[8] === true;
    out.push({
      id: `flt-${icao}`,
      kind: 'flight',
      lat,
      lng,
      heading,
      callsign,
      altitudeM: geo ?? baro,
      speedKn: velocityMs == null ? null : velocityMs * 1.94384,
      onGround,
    });
  }
  return out;
}

export function parseAdsbNearby(payload: AdsbResponse | null | undefined): LiveTrafficEntity[] {
  const rows = Array.isArray(payload?.ac)
    ? payload.ac
    : Array.isArray(payload?.aircraft)
      ? payload.aircraft
      : [];
  const out: LiveTrafficEntity[] = [];
  for (const row of rows) {
    const lat = finiteNum(row.lat);
    const lng = finiteNum(row.lon);
    if (lat == null || lng == null) continue;
    const hex = String(row.hex || '').trim().toLowerCase();
    if (!hex) continue;
    const flight = String(row.flight || '').trim();
    const altBaro = row.alt_baro === 'ground' ? 0 : finiteNum(row.alt_baro);
    const altGeom = finiteNum(row.alt_geom);
    const altFt = altGeom ?? altBaro;
    out.push({
      id: `flt-${hex}`,
      kind: 'flight',
      lat,
      lng,
      heading: finiteNum(row.track),
      callsign: flight || hex.toUpperCase(),
      altitudeM: altFt == null ? null : altFt / 3.28084,
      speedKn: finiteNum(row.gs),
      onGround: row.alt_baro === 'ground',
    });
  }
  return out;
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(liveApiUrl(url), {
    method: 'GET',
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`live-flights ${res.status}`);
  return res.json();
}

export type FlightFetchMeta = {
  source: 'opensky' | 'adsb' | 'merged' | 'none';
  error: string | null;
};

function mergeFlights(primary: LiveTrafficEntity[], secondary: LiveTrafficEntity[]): LiveTrafficEntity[] {
  if (primary.length === 0) return secondary;
  if (secondary.length === 0) return primary;
  const byId = new Map<string, LiveTrafficEntity>();
  for (const entity of secondary) byId.set(entity.id, entity);
  for (const entity of primary) byId.set(entity.id, entity);
  return [...byId.values()];
}

export async function fetchViewportFlights(
  bbox: GeoBbox,
  zoom: number,
  signal?: AbortSignal
): Promise<{ entities: LiveTrafficEntity[]; meta: FlightFetchMeta }> {
  const skyQs = new URLSearchParams({
    lamin: bbox.lamin.toFixed(4),
    lomin: bbox.lomin.toFixed(4),
    lamax: bbox.lamax.toFixed(4),
    lomax: bbox.lomax.toFixed(4),
  });
  const center = bboxCenter(bbox);
  const adsbQs = new URLSearchParams({
    lat: center.lat.toFixed(4),
    lon: center.lng.toFixed(4),
    dist: String(bboxRadiusNm(bbox)),
  });

  const [openSkySettled, adsbSettled] = await Promise.allSettled([
    fetchJson(`${OPENSKY_STATES_PATH}?${skyQs}`, signal),
    fetchJson(`${ADSB_NEARBY_PATH}?${adsbQs}`, signal),
  ]);

  if (signal?.aborted) {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  const openSkyPayload = openSkySettled.status === 'fulfilled' ? (openSkySettled.value as OpenSkyResponse) : null;
  const adsbPayload = adsbSettled.status === 'fulfilled' ? (adsbSettled.value as AdsbResponse) : null;
  const openSky = parseOpenSkyStates(openSkyPayload);
  const adsb = parseAdsbNearby(adsbPayload);
  const openSkyErr =
    openSkySettled.status === 'rejected'
      ? openSkySettled.reason instanceof Error
        ? openSkySettled.reason.message
        : 'opensky failed'
      : openSky.length === 0
        ? openSkyPayload?.error || null
        : null;
  const adsbErr =
    adsbSettled.status === 'rejected'
      ? adsbSettled.reason instanceof Error
        ? adsbSettled.reason.message
        : 'adsb failed'
      : adsb.length === 0
        ? adsbPayload?.error || null
        : null;

  const merged = mergeFlights(openSky, adsb);
  if (merged.length > 0) {
    const source: FlightFetchMeta['source'] =
      openSky.length > 0 && adsb.length > 0 ? 'merged' : openSky.length > 0 ? 'opensky' : 'adsb';
    return {
      entities: capTrafficEntities(merged, zoom, 'flight'),
      meta: { source, error: null },
    };
  }
  const error = openSkyErr && adsbErr ? `${openSkyErr}; ${adsbErr}` : openSkyErr || adsbErr || null;
  return { entities: [], meta: { source: 'none', error } };
}

type AisNearbyShip = {
  mmsi?: string;
  name?: string;
  lat?: number;
  lon?: number;
  heading?: number | null;
  sog?: number | null;
};

export function parseAisNearby(payload: { ships?: unknown } | null | undefined): LiveTrafficEntity[] {
  const rows = Array.isArray(payload?.ships) ? payload.ships : [];
  const out: LiveTrafficEntity[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const ship = row as AisNearbyShip;
    const lat = finiteNum(ship.lat);
    const lng = finiteNum(ship.lon);
    if (lat == null || lng == null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const mmsi = String(ship.mmsi || '').trim();
    if (!mmsi) continue;
    const heading = finiteNum(ship.heading);
    const sog = finiteNum(ship.sog);
    out.push({
      id: `shp-${mmsi}`,
      kind: 'ship',
      lat,
      lng,
      heading: heading != null && heading < 360 ? heading : null,
      callsign: String(ship.name || '').trim() || `MMSI ${mmsi}`,
      altitudeM: null,
      speedKn: sog != null && sog < 102.2 ? sog : null,
    });
  }
  return out;
}

export type ShipFetchMeta = {
  source: 'aisstream' | 'none';
  error: string | null;
};

export async function fetchViewportShips(
  bbox: GeoBbox,
  zoom: number,
  signal?: AbortSignal
): Promise<{ entities: LiveTrafficEntity[]; meta: ShipFetchMeta }> {
  const qs = new URLSearchParams({
    lamin: bbox.lamin.toFixed(4),
    lomin: bbox.lomin.toFixed(4),
    lamax: bbox.lamax.toFixed(4),
    lomax: bbox.lomax.toFixed(4),
  });
  const res = await fetch(liveApiUrl(`${AIS_NEARBY_PATH}?${qs}`), {
    method: 'GET',
    signal,
    headers: { Accept: 'application/json' },
  });
  let payload: { ships?: unknown; error?: string } = { ships: [] };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    payload = { ships: [], error: 'ais non-JSON' };
  }
  const entities = parseAisNearby(payload);
  if (entities.length > 0) {
    return {
      entities: capTrafficEntities(entities, zoom, 'ship'),
      meta: { source: 'aisstream', error: null },
    };
  }
  const err = payload.error || (!res.ok ? `ais ${res.status}` : null);
  return { entities: [], meta: { source: 'none', error: err } };
}
