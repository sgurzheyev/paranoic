/**
 * OpenSky bbox proxy. No API key. Soft-200 so the map can fall back to ADS-B.
 * Self-contained: Vercel does not rewrite relative ESM imports in /api.
 */
export const maxDuration = 10;

const OPENSKY_URL = 'https://opensky-network.org/api/states/all';
const MAX_LAT_SPAN = 8;
const MAX_LNG_SPAN = 10;
const CACHE_MS = 10_000;
const ERROR_CACHE_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 5_000;

type CacheEntry = { at: number; ttl: number; body: unknown };

const cache = new Map<string, CacheEntry>();

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

export function OPTIONS(request?: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request): Promise<Response> {
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
    lomin >= lomax ||
    lamax - lamin > MAX_LAT_SPAN + 0.01 ||
    lomax - lomin > MAX_LNG_SPAN + 0.01
  ) {
    return json({ error: 'lamin,lomin,lamax,lomax required', states: [] }, request);
  }

  const key = `${lamin.toFixed(2)}:${lomin.toFixed(2)}:${lamax.toFixed(2)}:${lomax.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    return json(hit.body, request, { 'Cache-Control': 'public, max-age=8', 'X-Live-Flights-Cache': 'hit' });
  }

  const upstreamUrl = `${OPENSKY_URL}?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Paranoic/1.0 (+https://paranoic.men)',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await upstream.text();
    let body: unknown = { states: [] };
    try {
      body = text ? JSON.parse(text) : { states: [] };
    } catch {
      body = { error: 'OpenSky returned non-JSON', states: [] };
    }
    if (!upstream.ok) {
      const soft = {
        error: `OpenSky ${upstream.status}`,
        states: Array.isArray((body as { states?: unknown }).states)
          ? (body as { states: unknown[] }).states
          : [],
      };
      const ttl = upstream.status === 429 ? ERROR_CACHE_MS : 15_000;
      cache.set(key, { at: Date.now(), ttl, body: soft });
      return json(soft, request, { 'X-Live-Flights-Source': 'opensky' });
    }
    cache.set(key, { at: Date.now(), ttl: CACHE_MS, body });
    return json(body, request, {
      'Cache-Control': 'public, max-age=8',
      'X-Live-Flights-Source': 'opensky',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OpenSky unreachable';
    const soft = { error: message, states: [] as unknown[] };
    cache.set(key, { at: Date.now(), ttl: 15_000, body: soft });
    return json(soft, request, { 'X-Live-Flights-Source': 'opensky' });
  }
}
