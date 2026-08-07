import type { VercelRequest, VercelResponse } from '@vercel/node';
import twilio from 'twilio';

/**
 * Vercel Serverless: Twilio Network Traversal Service → ephemeral ICE credentials.
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    res.status(503).json({ error: 'Twilio credentials not configured' });
    return;
  }

  try {
    const client = twilio(accountSid, authToken);
    const token = await client.tokens.create();

    const iceServers = (token.iceServers ?? [])
      .map((server) => {
        const urls = server.urls ?? server.url;
        if (!urls) return null;
        const entry: {
          urls: string;
          username?: string;
          credential?: string;
        } = { urls };
        if (server.username) entry.username = server.username;
        if (server.credential) entry.credential = server.credential;
        return entry;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ iceServers });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to create TURN token';
    res.status(500).json({ error: message });
  }
}
