import twilio from 'twilio';

/**
 * Vercel Function: Twilio Network Traversal → ephemeral ICE credentials.
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 *
 * Web Standard method exports (GET/POST) — корректный формат /api для Vite на Vercel.
 */

type IceServer = {
  urls: string;
  username?: string;
  credential?: string;
};

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
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return json({ error: 'Twilio credentials not configured' }, 503);
  }

  try {
    const client = twilio(accountSid, authToken);
    const token = await client.tokens.create();

    const iceServers: IceServer[] = (token.iceServers ?? [])
      .map((server) => {
        const urls = server.urls ?? server.url;
        if (!urls) return null;
        const entry: IceServer = { urls };
        if (server.username) entry.username = server.username;
        if (server.credential) entry.credential = server.credential;
        return entry;
      })
      .filter((s): s is IceServer => s !== null);

    return json({ iceServers });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to create TURN token';
    return json({ error: message }, 500);
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
