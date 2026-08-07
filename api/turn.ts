/// <reference types="node" />

/**
 * Vercel Function: Metered.ca TURN credentials → ICE servers.
 * Env: METERED_DOMAIN (e.g. yourapp.metered.live), METERED_API_KEY
 */

const CORS: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}

async function createTurnToken(): Promise<Response> {
  try {
    const domain = process.env.METERED_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const apiKey = process.env.METERED_API_KEY;

    console.log('Using Metered Domain:', process.env.METERED_DOMAIN);
    console.log('API Key length:', process.env.METERED_API_KEY ? process.env.METERED_API_KEY.length : 0);

    if (!domain || !apiKey) {
      console.error('Metered Error: missing METERED_DOMAIN or METERED_API_KEY');
      return json({ error: 'Metered credentials not configured' }, 503);
    }

    const url = `https://${domain}/api/v1/turn/credentials?secretKey=${encodeURIComponent(apiKey)}`;
    const safeUrl = `https://${domain}/api/v1/turn/credentials?secretKey=<len:${apiKey.length}>`;
    console.log('Metered request URL:', safeUrl);
    console.log('Metered auth: secretKey query (key length', apiKey.length, ')');

    // GET без Authorization/Content-Type — Metered ждёт secretKey только в query.
    const res = await fetch(url, { method: 'GET' });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('Metered Error: HTTP', res.status, text, 'request:', safeUrl);
      return new Response(
        JSON.stringify({
          error: text || `Metered API error (${res.status})`,
          requestUrl: safeUrl,
          status: res.status,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS },
        }
      );
    }

    const data: unknown = await res.json();

    // Metered отдаёт массив ICE-серверов; оборачиваем для клиента, если нужно.
    const iceServers = Array.isArray(data)
      ? data
      : data &&
          typeof data === 'object' &&
          Array.isArray((data as { iceServers?: unknown }).iceServers)
        ? (data as { iceServers: unknown[] }).iceServers
        : null;

    if (!iceServers || iceServers.length === 0) {
      console.error('Metered Error: empty iceServers', data, 'request:', safeUrl);
      return new Response(
        JSON.stringify({
          error: 'Metered returned empty iceServers',
          requestUrl: safeUrl,
          body: data,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS },
        }
      );
    }

    return json({ iceServers });
  } catch (error) {
    console.error('Metered Error:', error);
    const message =
      error instanceof Error ? error.message || 'Unknown error' : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function GET(): Promise<Response> {
  return createTurnToken();
}

export function POST(): Promise<Response> {
  return createTurnToken();
}
