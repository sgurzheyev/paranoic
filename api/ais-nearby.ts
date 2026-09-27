/**
 * AISStream proxy. The API key stays in AISSTREAM_API_KEY on the server.
 * Browsers cannot open wss://stream.aisstream.io (401 / CORS), so the map polls this.
 * Frames are often binary — decode UTF-8 before JSON.parse.
 * Never returns the key. Missing key → { ships: [], error: "need-key" }.
 */
export const maxDuration = 10;

const AISSTREAM_WS_URL = 'wss://stream.aisstream.io/v0/stream';
const CACHE_MS = 8_000;
const COLLECT_MS = 2_800;
const OPEN_TIMEOUT_MS = 2_500;

const POSITION_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'LongRangeAisBroadcastMessage',
] as const;

type AisShip = {
  mmsi: string;
  name: string;
  lat: number;
  lon: number;
  heading: number | null;
  sog: number | null;
};

type CacheEntry = { at: number; body: unknown };
const cache = new Map<string, CacheEntry>();

const KEY_PLACEHOLDERS = new Set([
  '',
  'undefined',
  'null',
  'none',
  'n/a',
  'na',
  'changeme',
  'your_api_key',
  'your-api-key',
]);

const CORS_ALLOW = new Set([
  'https://paranoic.men',
  'https://www.paranoic.men',
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]);

function corsHeaders(request?: Request): HeadersInit {
  const origin = request?.headers.get('origin') || '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    Vary: 'Origin',
  };
  const local = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
  if (CORS_ALLOW.has(origin) || local) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body: unknown, request?: Request, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
      ...extra,
    },
  });
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function usableKey(raw: string): boolean {
  const key = String(raw || '').trim();
  if (key.length < 16) return false;
  if (KEY_PLACEHOLDERS.has(key.toLowerCase())) return false;
  if (/^[A-Z][A-Z0-9_]{8,}$/.test(key)) return false;
  return true;
}

function readAisKey(): string {
  const key = String(process.env.AISSTREAM_API_KEY || '').trim();
  return usableKey(key) ? key : '';
}

function decodeFrame(data: unknown): unknown | null {
  try {
    let text = '';
    if (typeof data === 'string') text = data;
    else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) text = data.toString('utf8');
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else if (ArrayBuffer.isView(data)) text = new TextDecoder().decode(data);
    else text = String(data ?? '');
    if (!text || text === '[object Blob]' || text === '[object ArrayBuffer]') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function parseShip(raw: unknown): AisShip | null {
  if (!raw || typeof raw !== 'object') return null;
  const env = raw as {
    MetaData?: { MMSI?: number | string; ShipName?: string; latitude?: number; longitude?: number };
    Message?: Record<
      string,
      { UserID?: number; Latitude?: number; Longitude?: number; Cog?: number; Sog?: number; TrueHeading?: number }
    >;
    error?: unknown;
    Error?: unknown;
  };
  if (env.error ?? env.Error) return null;
  const msg = env.Message || {};
  const report =
    msg.PositionReport ||
    msg.StandardClassBPositionReport ||
    msg.ExtendedClassBPositionReport ||
    msg.LongRangeAisBroadcastMessage;
  const meta = env.MetaData;
  const lat = num(report?.Latitude) ?? num(meta?.latitude);
  const lon = num(report?.Longitude) ?? num(meta?.longitude);
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) return null;
  const mmsi = String(report?.UserID ?? meta?.MMSI ?? '').trim();
  if (!mmsi) return null;
  const heading = num(report?.TrueHeading);
  const cog = num(report?.Cog);
  const sog = num(report?.Sog);
  return {
    mmsi,
    name: String(meta?.ShipName || '').trim() || `MMSI ${mmsi}`,
    lat,
    lon,
    heading: heading != null && heading < 360 ? heading : cog,
    sog: sog != null && sog < 102.2 ? sog : null,
  };
}

async function queryAisNearby(
  bbox: { lamin: number; lomin: number; lamax: number; lomax: number },
  apiKey: string
): Promise<{ ships: AisShip[]; error?: string; source: string }> {
  if (!usableKey(apiKey) || typeof WebSocket === 'undefined') {
    return { ships: [], error: typeof WebSocket === 'undefined' ? 'ws' : 'need-key', source: 'none' };
  }

  const sub = JSON.stringify({
    APIKey: apiKey,
    BoundingBoxes: [
      [
        [bbox.lamin, bbox.lomin],
        [bbox.lamax, bbox.lomax],
      ],
    ],
    FilterMessageTypes: [...POSITION_TYPES],
  });

  const merged = new Map<string, AisShip>();
  let lastError: string | null = null;

  await new Promise<void>((resolve) => {
    let settled = false;
    let ws: WebSocket;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let collectTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (openTimer) clearTimeout(openTimer);
      if (collectTimer) clearTimeout(collectTimer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve();
    };

    try {
      ws = new WebSocket(AISSTREAM_WS_URL);
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'ws';
      resolve();
      return;
    }

    try {
      ws.binaryType = 'arraybuffer';
    } catch {
      /* ignore */
    }

    openTimer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        lastError = lastError || 'ws';
        finish();
      }
    }, OPEN_TIMEOUT_MS);
    collectTimer = setTimeout(finish, COLLECT_MS);

    ws.addEventListener('open', () => {
      try {
        ws.send(sub);
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'ws';
        finish();
      }
    });
    ws.addEventListener('message', (ev) => {
      const parsed = decodeFrame((ev as MessageEvent).data);
      if (!parsed || typeof parsed !== 'object') return;
      const rec = parsed as { error?: unknown; Error?: unknown };
      const errText = rec.error ?? rec.Error;
      if (errText) {
        lastError = String(errText).slice(0, 80);
        return;
      }
      const ship = parseShip(parsed);
      if (ship) merged.set(ship.mmsi, ship);
    });
    ws.addEventListener('error', () => {
      lastError = lastError || 'ws';
    });
    ws.addEventListener('close', () => {
      if (!settled && merged.size === 0) lastError = lastError || 'ws';
      finish();
    });
  });

  const ships = [...merged.values()];
  if (ships.length > 0) return { ships, source: 'aisstream' };
  return { ships: [], error: lastError || 'empty', source: 'none' };
}

export function OPTIONS(request?: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const lamin = num(url.searchParams.get('lamin'));
    const lomin = num(url.searchParams.get('lomin'));
    const lamax = num(url.searchParams.get('lamax'));
    const lomax = num(url.searchParams.get('lomax'));
    if (
      lamin == null ||
      lomin == null ||
      lamax == null ||
      lomax == null ||
      lamin < -90 ||
      lamax > 90 ||
      lamin >= lamax ||
      lomin < -180 ||
      lomax > 180 ||
      lomin >= lomax
    ) {
      return json({ error: 'lamin,lomin,lamax,lomax required', ships: [] }, request);
    }

    const key = `${lamin.toFixed(2)}:${lomin.toFixed(2)}:${lamax.toFixed(2)}:${lomax.toFixed(2)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      return json(hit.body, request, { 'Cache-Control': 'public, max-age=6', 'X-Live-Ships-Cache': 'hit' });
    }

    const result = await queryAisNearby({ lamin, lomin, lamax, lomax }, readAisKey());
    const body =
      result.ships.length > 0
        ? { ships: result.ships }
        : { ships: [] as AisShip[], error: result.error || 'empty' };
    cache.set(key, { at: Date.now(), body });
    return json(body, request, {
      'Cache-Control': result.ships.length > 0 ? 'public, max-age=6' : 'public, max-age=3',
      'X-Live-Ships-Source': result.source,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ais proxy failed';
    return json({ ships: [], error: message }, request, { 'X-Live-Ships-Source': 'none' });
  }
}
