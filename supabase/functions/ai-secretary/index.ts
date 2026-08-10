/**
 * AI Secretary — безопасный прокси к OpenAI Chat Completions.
 * Секрет: supabase secrets set OPENAI_API_KEY=sk-...
 *
 * Deploy: supabase functions deploy ai-secretary
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type RequestBody = {
  messages?: ChatMessage[];
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAiKey) {
    return jsonResponse({ error: 'OPENAI_API_KEY is not configured' }, 500);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse({ error: 'messages array is required' }, 400);
  }

  for (const msg of messages) {
    if (
      !msg ||
      typeof msg.content !== 'string' ||
      !['system', 'user', 'assistant'].includes(msg.role)
    ) {
      return jsonResponse({ error: 'Invalid message format' }, 400);
    }
  }

  try {
    const openaiRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.7,
      }),
    });

    const payload = await openaiRes.json();

    if (!openaiRes.ok) {
      const errMsg =
        (payload as { error?: { message?: string } })?.error?.message ||
        `OpenAI error (${openaiRes.status})`;
      return jsonResponse({ error: errMsg }, openaiRes.status);
    }

    return jsonResponse(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upstream request failed';
    return jsonResponse({ error: message }, 502);
  }
});
