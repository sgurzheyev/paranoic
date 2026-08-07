/// <reference types="node" />
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
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      console.error('Twilio Error: missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
      return json({ error: 'Twilio credentials not configured' }, 503);
    }

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

    if (iceServers.length === 0) {
      console.error('Twilio Error: tokens.create returned empty iceServers', token);
      return new Response(JSON.stringify({ error: 'Twilio returned empty iceServers' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    return json({ iceServers });
  } catch (error) {
    console.error('Twilio Error:', error);
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
