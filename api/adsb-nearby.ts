/**
 * ADS-B nearby proxy (adsb.lol + adsb.fi). No API key.
 * Self-contained: do not import sibling modules (Vercel ESM rewrite).
 */
export const maxDuration = 10;

const CACHE_MS = 10_000;
const ERROR_CACHE_MS = 20_000;
const UPSTREAM_TIMEOUT_MS = 6_000;

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

type CacheEntry = { at: number; ttl: number; body: unknown; source: string };
const cache = new Map<string, CacheEntry>();

const HOSTS = [
  {
    id: 'adsb.lol',
    buildUrl: (lat: number, lon: number, dist: number) =>
      `https://api.adsb.lol/v2/lat/${encodeURIComponent(String(lat))}/lon/${encodeURIComponent(String(lon))}/dist/${encodeURIComponent(String(dist))}`,
  },
  {
    id: 'adsb.fi',
    buildUrl: (lat: number, lon: number, dist: number) =>
      `https://opendata.adsb.fi/api/v2/lat/${encodeURIComponent(String(lat))}/lon/${encodeURIComponent(String(lon))}/dist/${encodeURIComponent(String(dist))}`,
  },
];

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

function pickList(body: unknown): AdsbAircraft[] {
  if (!body || typeof body !== 'object') return [];
  const rec = body as { ac?: unknown; aircraft?: unknown };
  if (Array.isArray(rec.ac)) return rec.ac as AdsbAircraft[];
  if (Array.isArray(rec.aircraft)) return rec.aircraft as AdsbAircraft[];
  return [];
}

function merge(lists: AdsbAircraft[][]): AdsbAircraft[] {
  const merged = new Map<string, AdsbAircraft>();
  for (const list of lists) {
    for (const craft of list) {
      const hex = String(craft?.hex || '').trim().toLowerCase();
      if (hex) merged.set(hex, craft);
    }
  }
  return [...merged.values()];
}

export function OPTIONS(request?: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lat = num(url.searchParams.get('lat'));
  const lon = num(url.searchParams.get('lon'));
  let dist = num(url.searchParams.get('dist')) ?? 80;
  if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return json({ error: 'lat,lon required', ac: [] }, request);
  }
  dist = Math.max(15, Math.min(220, Math.round(dist)));
  const key = `${lat.toFixed(2)}:${lon.toFixed(2)}:${dist}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    return json(hit.body, request, {
      'Cache-Control': 'public, max-age=8',
      'X-Live-Flights-Cache': 'hit',
      'X-Live-Flights-Source': hit.source,
    });
  }

  const settled = await Promise.all(
    HOSTS.map(async (host) => {
      try {
        const upstream = await fetch(host.buildUrl(lat, lon, dist), {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Paranoic/1.0 (+https://paranoic.men)',
          },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        const contentType = upstream.headers.get('content-type') || '';
        const text = await upstream.text();
        if (!upstream.ok || !contentType.toLowerCase().includes('json')) {
          return { id: host.id, ac: [] as AdsbAircraft[], error: `${host.id} ${upstream.status}` };
        }
        let parsed: unknown = {};
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          return { id: host.id, ac: [] as AdsbAircraft[], error: `${host.id} non-JSON` };
        }
        const ac = pickList(parsed);
        return { id: host.id, ac, error: ac.length === 0 ? `${host.id} empty` : null };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unreachable';
        return { id: host.id, ac: [] as AdsbAircraft[], error: `${host.id} ${message}` };
      }
    })
  );

  const lists: AdsbAircraft[][] = [];
  const sources: string[] = [];
  const errors: string[] = [];
  for (const row of settled) {
    if (row.error) errors.push(row.error);
    if (row.ac.length === 0) continue;
    sources.push(row.id);
    lists.push(row.ac);
  }
  const ac = merge(lists);
  const body = ac.length > 0 ? { ac } : { ac: [] as AdsbAircraft[], error: errors.join('; ') || 'adsb unreachable' };
  const source = ac.length > 0 ? sources.join('+') : 'none';
  cache.set(key, { at: Date.now(), ttl: ac.length > 0 ? CACHE_MS : ERROR_CACHE_MS, body, source });
  return json(body, request, {
    'Cache-Control': ac.length > 0 ? 'public, max-age=8' : 'public, max-age=4',
    'X-Live-Flights-Source': source,
  });
}
