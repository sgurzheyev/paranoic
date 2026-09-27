/**
 * Viewport bbox, GeoJSON, heading icons, and colored trails
 * for live planes (OpenSky / ADS-B) and ships (AISStream).
 */

export type GeoBbox = {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
};

export type LiveTrafficKind = 'flight' | 'ship';

export type LiveTrafficEntity = {
  id: string;
  kind: LiveTrafficKind;
  lat: number;
  lng: number;
  heading: number | null;
  callsign: string;
  altitudeM: number | null;
  speedKn: number | null;
  onGround?: boolean;
  demo?: boolean;
};

export type LiveTrafficPointProps = {
  id: string;
  kind: LiveTrafficKind;
  callsign: string;
  heading: number;
  altitude_m: number;
  speed_kn: number;
  on_ground: number;
  demo: number;
  label: string;
};

export const LIVE_FLIGHTS_SOURCE_ID = 'live-flights';
export const LIVE_SHIPS_SOURCE_ID = 'live-ships';
export const LIVE_FLIGHTS_TRAILS_SOURCE_ID = 'live-flights-trails';
export const LIVE_SHIPS_TRAILS_SOURCE_ID = 'live-ships-trails';
export const LIVE_FLIGHTS_GLOW_LAYER_ID = 'live-flights-glow';
export const LIVE_FLIGHTS_CORE_LAYER_ID = 'live-flights-core';
export const LIVE_FLIGHTS_ICON_LAYER_ID = 'live-flights-icon';
export const LIVE_FLIGHTS_LABEL_LAYER_ID = 'live-flights-label';
export const LIVE_FLIGHTS_TRAIL_GLOW_LAYER_ID = 'live-flights-trail-glow';
export const LIVE_FLIGHTS_TRAIL_LAYER_ID = 'live-flights-trail';
export const LIVE_SHIPS_GLOW_LAYER_ID = 'live-ships-glow';
export const LIVE_SHIPS_CORE_LAYER_ID = 'live-ships-core';
export const LIVE_SHIPS_ICON_LAYER_ID = 'live-ships-icon';
export const LIVE_SHIPS_LABEL_LAYER_ID = 'live-ships-label';
export const LIVE_SHIPS_TRAIL_GLOW_LAYER_ID = 'live-ships-trail-glow';
export const LIVE_SHIPS_TRAIL_LAYER_ID = 'live-ships-trail';
export const LIVE_PLANE_IMAGE_ID = 'px-live-plane';
export const LIVE_SHIP_IMAGE_ID = 'px-live-ship';

export const LIVE_TRAFFIC_SLOT = 'top';
export const FLIGHT_TRAIL_COLOR = '#4ade80';
export const FLIGHT_TRAIL_CORE_COLOR = '#bbf7d0';
export const SHIP_TRAIL_COLOR = '#f59e0b';
export const SHIP_TRAIL_CORE_COLOR = '#fdba74';
export const FLIGHT_MARKER_COLOR = '#86efac';
export const SHIP_MARKER_COLOR = '#fb923c';

export const OPENSKY_POLL_MS = 12_000;
export const AIS_POLL_MS = 8_000;
export const TRAFFIC_BBOX_MAX_LAT_SPAN = 8;
export const TRAFFIC_BBOX_MAX_LNG_SPAN = 10;
export const TRAFFIC_BBOX_MIN_LAT_SPAN = 1.4;
export const TRAFFIC_BBOX_MIN_LNG_SPAN = 1.8;

export const FLIGHT_HIT_LAYERS = [
  LIVE_FLIGHTS_ICON_LAYER_ID,
  LIVE_FLIGHTS_CORE_LAYER_ID,
  LIVE_FLIGHTS_LABEL_LAYER_ID,
] as const;

export const SHIP_HIT_LAYERS = [
  LIVE_SHIPS_ICON_LAYER_ID,
  LIVE_SHIPS_CORE_LAYER_ID,
  LIVE_SHIPS_LABEL_LAYER_ID,
] as const;

export type TrafficGeoJSON = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id?: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: LiveTrafficPointProps;
  }>;
};

export type TrafficTrailGeoJSON = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id?: string;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    properties: { id: string; kind: LiveTrafficKind };
  }>;
};

const EMPTY_FC: TrafficGeoJSON = { type: 'FeatureCollection', features: [] };
const EMPTY_TRAILS: TrafficTrailGeoJSON = { type: 'FeatureCollection', features: [] };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function clampBbox(bbox: GeoBbox): GeoBbox {
  const south = Math.min(clamp(bbox.lamin, -90, 90), clamp(bbox.lamax, -90, 90));
  const north = Math.max(clamp(bbox.lamin, -90, 90), clamp(bbox.lamax, -90, 90));
  let west = clamp(bbox.lomin, -180, 180);
  let east = clamp(bbox.lomax, -180, 180);
  if (west > east) {
    const swap = west;
    west = east;
    east = swap;
  }
  const latMid = (south + north) / 2;
  const lngMid = (west + east) / 2;
  const latSpan = clamp(north - south, TRAFFIC_BBOX_MIN_LAT_SPAN, TRAFFIC_BBOX_MAX_LAT_SPAN);
  const lngSpan = clamp(east - west, TRAFFIC_BBOX_MIN_LNG_SPAN, TRAFFIC_BBOX_MAX_LNG_SPAN);
  return {
    lamin: clamp(latMid - latSpan / 2, -90, 90),
    lamax: clamp(latMid + latSpan / 2, -90, 90),
    lomin: clamp(lngMid - lngSpan / 2, -180, 180),
    lomax: clamp(lngMid + lngSpan / 2, -180, 180),
  };
}

type BoundsLike = {
  getSouth?: () => number;
  getWest?: () => number;
  getNorth?: () => number;
  getEast?: () => number;
};

/** Camera-centered box. Globe getBounds() can span the whole world. */
export function bboxFromCamera(opts: {
  lat: number;
  lng: number;
  zoom?: number;
  bounds?: BoundsLike | null;
}): GeoBbox | null {
  const lat = Number(opts.lat);
  const lng = Number(opts.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  let latSpan = TRAFFIC_BBOX_MIN_LAT_SPAN;
  let lngSpan = TRAFFIC_BBOX_MIN_LNG_SPAN;
  const zoom = Number(opts.zoom);
  if (Number.isFinite(zoom)) {
    const zSpan = 360 / 2 ** Math.max(1, Math.min(20, zoom));
    latSpan = Math.max(latSpan, zSpan);
    lngSpan = Math.max(lngSpan, zSpan / Math.max(0.35, Math.cos((lat * Math.PI) / 180)));
  }

  try {
    const b = opts.bounds;
    if (b?.getSouth && b.getWest && b.getNorth && b.getEast) {
      const south = Number(b.getSouth());
      const west = Number(b.getWest());
      const north = Number(b.getNorth());
      const east = Number(b.getEast());
      if ([south, west, north, east].every(Number.isFinite)) {
        const boundLat = Math.abs(north - south);
        const boundLng = Math.abs(east - west);
        if (boundLat > 0.05 && boundLat <= TRAFFIC_BBOX_MAX_LAT_SPAN + 4) {
          latSpan = Math.max(latSpan, boundLat);
        }
        if (boundLng > 0.05 && boundLng <= TRAFFIC_BBOX_MAX_LNG_SPAN + 4) {
          lngSpan = Math.max(lngSpan, boundLng);
        }
      }
    }
  } catch {
    /* globe getBounds can throw */
  }

  return clampBbox({
    lamin: lat - latSpan / 2,
    lamax: lat + latSpan / 2,
    lomin: lng - lngSpan / 2,
    lomax: lng + lngSpan / 2,
  });
}

export function bboxCenter(bbox: GeoBbox): { lat: number; lng: number } {
  return {
    lat: (bbox.lamin + bbox.lamax) / 2,
    lng: (bbox.lomin + bbox.lomax) / 2,
  };
}

/** Approx radius in nautical miles for ADS-B (capped). */
export function bboxRadiusNm(bbox: GeoBbox): number {
  const latSpan = bbox.lamax - bbox.lamin;
  const lngSpan = bbox.lomax - bbox.lomin;
  const latMid = (bbox.lamin + bbox.lamax) / 2;
  const kmLat = latSpan * 111.32;
  const kmLng = lngSpan * 111.32 * Math.cos((latMid * Math.PI) / 180);
  const km = Math.max(kmLat, kmLng) / 2;
  const nm = km / 1.852;
  return clamp(Math.round(nm), 40, 220);
}

export function liveTrafficCap(zoom: number, kind: LiveTrafficKind): number {
  if (zoom < 6) return kind === 'flight' ? 28 : 16;
  if (zoom < 9) return kind === 'flight' ? 55 : 32;
  if (zoom < 12) return kind === 'flight' ? 90 : 55;
  return kind === 'flight' ? 120 : 80;
}

export function capTrafficEntities(
  entities: LiveTrafficEntity[],
  zoom: number,
  kind: LiveTrafficKind
): LiveTrafficEntity[] {
  const cap = liveTrafficCap(zoom, kind);
  if (entities.length <= cap) return entities;
  const midLat = entities.reduce((s, e) => s + e.lat, 0) / Math.max(1, entities.length);
  const midLng = entities.reduce((s, e) => s + e.lng, 0) / Math.max(1, entities.length);
  return [...entities]
    .sort((a, b) => {
      const da = (a.lat - midLat) ** 2 + (a.lng - midLng) ** 2;
      const db = (b.lat - midLat) ** 2 + (b.lng - midLng) ** 2;
      return da - db;
    })
    .slice(0, cap);
}

export function formatAltitudeLabel(altitudeM: number | null, onGround?: boolean): string {
  if (onGround) return 'GND';
  if (altitudeM == null || !Number.isFinite(altitudeM)) return '';
  const m = Math.round(altitudeM / 10) * 10;
  return `${m.toLocaleString('en-US')} m`;
}

export function formatSpeedKn(speedKn: number | null): string {
  if (speedKn == null || !Number.isFinite(speedKn)) return '';
  return `${Math.round(speedKn)} kn`;
}

export function formatSpeedKmh(speedKn: number | null): string {
  if (speedKn == null || !Number.isFinite(speedKn)) return '';
  return `${Math.round(speedKn * 1.852)} km/h`;
}

export function formatHeading(heading: number | null): string {
  if (heading == null || !Number.isFinite(heading)) return '';
  const deg = ((Math.round(heading) % 360) + 360) % 360;
  return `${deg}°`;
}

export function trafficTooltipLabel(entity: LiveTrafficEntity): string {
  const demo = entity.demo ? 'DEMO' : '';
  if (entity.kind === 'flight') {
    const alt = formatAltitudeLabel(entity.altitudeM, entity.onGround);
    const spd = formatSpeedKmh(entity.speedKn);
    return [demo, entity.callsign, alt, spd].filter(Boolean).join(' · ');
  }
  const hdg = formatHeading(entity.heading);
  const spd = formatSpeedKn(entity.speedKn);
  return [demo, entity.callsign, hdg, spd].filter(Boolean).join(' · ');
}

export function entitiesToGeoJSON(entities: LiveTrafficEntity[]): TrafficGeoJSON {
  return {
    type: 'FeatureCollection',
    features: entities.map((e) => ({
      type: 'Feature',
      id: e.id,
      geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
      properties: {
        id: e.id,
        kind: e.kind,
        callsign: e.callsign,
        heading: Number.isFinite(e.heading) ? Number(e.heading) : 0,
        altitude_m: e.altitudeM == null ? -1 : e.altitudeM,
        speed_kn: e.speedKn == null ? -1 : e.speedKn,
        on_ground: e.onGround ? 1 : 0,
        demo: e.demo ? 1 : 0,
        label: trafficTooltipLabel(e),
      },
    })),
  };
}

export function emptyTrafficGeoJSON(): TrafficGeoJSON {
  return EMPTY_FC;
}

export function emptyTrailGeoJSON(): TrafficTrailGeoJSON {
  return EMPTY_TRAILS;
}

export type TrafficTrailTracker = {
  sync: (entities: LiveTrafficEntity[], kind: LiveTrafficKind) => TrafficTrailGeoJSON;
  clear: () => void;
};

export function createTrailTracker(opts?: {
  maxPoints?: number;
  minStepDeg?: number;
}): TrafficTrailTracker {
  const maxPoints = opts?.maxPoints ?? 12;
  const minStepDeg = opts?.minStepDeg ?? 0.00028;
  const byId = new Map<string, { kind: LiveTrafficKind; coords: [number, number][] }>();

  return {
    sync(entities, kind) {
      const seen = new Set<string>();
      for (const e of entities) {
        seen.add(e.id);
        const pt: [number, number] = [e.lng, e.lat];
        const prev = byId.get(e.id);
        if (!prev) {
          byId.set(e.id, { kind, coords: [pt] });
          continue;
        }
        const last = prev.coords[prev.coords.length - 1];
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < minStepDeg) continue;
        prev.coords.push(pt);
        if (prev.coords.length > maxPoints) prev.coords.shift();
      }
      for (const [id, row] of byId) {
        if (row.kind === kind && !seen.has(id)) byId.delete(id);
      }
      return {
        type: 'FeatureCollection',
        features: [...byId.entries()]
          .filter(([, row]) => row.kind === kind && row.coords.length >= 2)
          .map(([id, row]) => ({
            type: 'Feature' as const,
            id,
            geometry: { type: 'LineString' as const, coordinates: row.coords },
            properties: { id, kind: row.kind },
          })),
      };
    },
    clear() {
      byId.clear();
    },
  };
}

export function featureToTrafficEntity(
  props: Record<string, unknown> | null | undefined,
  coords?: [number, number]
): LiveTrafficEntity | null {
  if (!props) return null;
  const kind = props.kind === 'ship' ? 'ship' : props.kind === 'flight' ? 'flight' : null;
  if (!kind) return null;
  const lat = coords?.[1];
  const lng = coords?.[0];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const altitudeM = Number(props.altitude_m);
  const speedKn = Number(props.speed_kn);
  return {
    id: String(props.id || ''),
    kind,
    lat: Number(lat),
    lng: Number(lng),
    heading: Number.isFinite(Number(props.heading)) ? Number(props.heading) : null,
    callsign: String(props.callsign || kind),
    altitudeM: Number.isFinite(altitudeM) && altitudeM >= 0 ? altitudeM : null,
    speedKn: Number.isFinite(speedKn) && speedKn >= 0 ? speedKn : null,
    onGround: Number(props.on_ground) === 1,
    demo: Number(props.demo) === 1,
  };
}

export type RushCraftMode = 'off' | 'ships' | 'planes';

export function cycleRushCraftMode(current: RushCraftMode): RushCraftMode {
  if (current === 'off') return 'ships';
  if (current === 'ships') return 'planes';
  return 'off';
}

const DEMO_SPECS = [
  { id: '1', dLat: 6.2, dLng: 4.4, hdg: 48 },
  { id: '2', dLat: -4.1, dLng: 8.6, hdg: 188 },
  { id: '3', dLat: 7.4, dLng: -7.2, hdg: 312 },
  { id: '4', dLat: -8.2, dLng: -3.5, hdg: 96 },
] as const;

/** Labeled craft around the camera so the map can be shown without live feeds. */
export function demoTrafficEntities(kind: LiveTrafficKind, lat: number, lng: number): LiveTrafficEntity[] {
  return DEMO_SPECS.map((spec) => ({
    id: `${kind === 'flight' ? 'flt' : 'shp'}-demo-${spec.id}`,
    kind,
    lat: lat + spec.dLat,
    lng: lng + spec.dLng,
    heading: spec.hdg,
    callsign: kind === 'flight' ? `DEMO ${spec.id}01` : `DEMO SHIP ${spec.id}`,
    altitudeM: kind === 'flight' ? 10680 - Number(spec.id) * 400 : null,
    speedKn: kind === 'flight' ? 450 : 12 + Number(spec.id),
    onGround: false,
    demo: true,
  }));
}

export function demoTrailGeoJSON(entities: LiveTrafficEntity[]): TrafficTrailGeoJSON {
  return {
    type: 'FeatureCollection',
    features: entities.map((entity) => {
      const rad = ((entity.heading ?? 0) * Math.PI) / 180;
      const cosLat = Math.max(0.35, Math.cos((entity.lat * Math.PI) / 180));
      const coords: [number, number][] = [];
      for (let i = 6; i >= 0; i -= 1) {
        const dist = i * 0.7;
        coords.push([
          entity.lng - (Math.sin(rad) * dist) / cosLat,
          entity.lat - Math.cos(rad) * dist,
        ]);
      }
      coords.push([entity.lng, entity.lat]);
      return {
        type: 'Feature' as const,
        id: `${entity.id}-trail`,
        geometry: { type: 'LineString' as const, coordinates: coords },
        properties: { id: entity.id, kind: entity.kind },
      };
    }),
  };
}

type ImageMap = {
  hasImage?: (id: string) => boolean;
  addImage?: (
    id: string,
    image: { width: number; height: number; data: Uint8Array },
    options?: { pixelRatio?: number }
  ) => void;
};

function setPx(
  data: Uint8Array,
  size: number,
  x: number,
  y: number,
  rgb: [number, number, number],
  a = 255
) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = a;
}

/** Top-view airplane, nose-up so icon-rotate follows heading. */
function paintPlane(data: Uint8Array, size: number, rgb: [number, number, number]): void {
  const cx = (size - 1) / 2;
  for (let y = 6; y < size - 6; y += 1) {
    const t = (y - 6) / (size - 12);
    const fuse = t < 0.12 ? 1.6 + t * 8 : t > 0.82 ? 2.2 : 2.8;
    for (let x = Math.floor(cx - fuse); x <= Math.ceil(cx + fuse); x += 1) {
      setPx(data, size, x, y, rgb, 245);
    }
  }
  const wingY = Math.floor(size * 0.42);
  for (let y = wingY - 3; y <= wingY + 4; y += 1) {
    const spread = 4 + (y - (wingY - 3)) * 3.6;
    for (let x = Math.floor(cx - spread); x <= Math.ceil(cx + spread); x += 1) {
      setPx(data, size, x, y, rgb, 255);
    }
  }
  const tailY = Math.floor(size * 0.78);
  for (let y = tailY - 2; y <= tailY + 2; y += 1) {
    const spread = 6 + Math.abs(y - tailY);
    for (let x = Math.floor(cx - spread); x <= Math.ceil(cx + spread); x += 1) {
      setPx(data, size, x, y, rgb, 255);
    }
  }
}

/** Bow-up hull so heading / COG rotates the ship. */
function paintShip(data: Uint8Array, size: number, rgb: [number, number, number]): void {
  const cx = (size - 1) / 2;
  const top = 8;
  const bot = size - 8;
  for (let y = top; y <= bot; y += 1) {
    const t = (y - top) / (bot - top);
    const half = t < 0.28 ? 2 + t * 18 : 7.2;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x += 1) {
      const edge = Math.abs(x - cx) > half - 1.1 || y < top + 1.5;
      setPx(data, size, x, y, rgb, edge ? 255 : 230);
    }
  }
}

export function registerLiveTrafficImages(map: ImageMap | null | undefined): void {
  if (!map?.addImage) return;
  const size = 80;
  try {
    if (!map.hasImage?.(LIVE_PLANE_IMAGE_ID)) {
      const data = new Uint8Array(size * size * 4);
      paintPlane(data, size, [134, 239, 172]);
      map.addImage(LIVE_PLANE_IMAGE_ID, { width: size, height: size, data }, { pixelRatio: 2 });
    }
  } catch {
    /* style not ready */
  }
  try {
    if (!map.hasImage?.(LIVE_SHIP_IMAGE_ID)) {
      const data = new Uint8Array(size * size * 4);
      paintShip(data, size, [251, 146, 60]);
      map.addImage(LIVE_SHIP_IMAGE_ID, { width: size, height: size, data }, { pixelRatio: 2 });
    }
  } catch {
    /* style not ready */
  }
}
