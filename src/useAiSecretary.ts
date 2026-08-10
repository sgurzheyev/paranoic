import { useCallback, useRef, useState } from 'react';
import { AI_SECRETARY_FUNCTION, BODYGUARD_SYSTEM_PROMPT } from './aiSettings';
import { ensureAuthSession, getSupabase, hasSupabaseConfig } from './lib/supabase';

type OpenAiCompletion = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: string | { message?: string };
};

function parseReply(data: unknown): string {
  const payload = data as OpenAiCompletion;
  if (typeof payload?.error === 'string') {
    throw new Error(payload.error);
  }
  if (payload?.error?.message) {
    throw new Error(payload.error.message);
  }
  const reply = payload?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('Пустой ответ от облака');
  return reply;
}

function friendlyInvokeError(err: unknown): string {
  if (err instanceof Error) {
    if (/failed to fetch|network|load failed/i.test(err.message)) {
      return 'Облако недоступно. Проверьте сеть и что функция ai-secretary задеплоена.';
    }
    return err.message;
  }
  return 'Не удалось связаться с ИИ-секретарём';
}

/**
 * ИИ-телохранитель через Supabase Edge Function → OpenAI gpt-4o-mini.
 */
export function useAiSecretary() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cancelledRef = useRef(false);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setLoading(false);
  }, []);

  const generate = useCallback(
    async (userMessage: string, situationContext?: string): Promise<string> => {
      const trimmed = userMessage.trim();
      if (!trimmed) throw new Error('Пустое сообщение');
      if (!hasSupabaseConfig()) {
        throw new Error('Supabase не настроен');
      }

      cancelledRef.current = false;
      setLoading(true);
      setError('');

      try {
        await ensureAuthSession();
        const sb = getSupabase();

        const userContent = situationContext?.trim()
          ? `${trimmed}\n\n[Контекст обстановки]\n${situationContext.trim()}`
          : trimmed;

        const { data, error: invokeError } = await sb.functions.invoke(AI_SECRETARY_FUNCTION, {
          body: {
            messages: [
              { role: 'system', content: BODYGUARD_SYSTEM_PROMPT },
              { role: 'user', content: userContent },
            ],
          },
        });

        if (cancelledRef.current) {
          throw new Error('Запрос отменён');
        }

        if (invokeError) {
          throw new Error(invokeError.message || 'Edge Function недоступна');
        }

        return parseReply(data);
      } catch (e) {
        if (cancelledRef.current) {
          throw new Error('Запрос отменён');
        }
        const msg = friendlyInvokeError(e);
        setError(msg);
        throw new Error(msg);
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    },
    []
  );

  return { generate, loading, error, cancel, setError };
}
