import { useCallback, useRef, useState } from 'react';
import { AI_SECRETARY_FUNCTION, BODYGUARD_SYSTEM_PROMPT } from './aiSettings';
import { ensureAuthSession, getSupabase, hasSupabaseConfig } from './lib/supabase';

type OpenAiCompletion = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: string | { message?: string };
};

function parseReply(data: unknown): string {
  if (!data) throw new Error('Пустой ответ от сервера');

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

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    return /failed to fetch|network|load failed|fetch error/i.test(err.message);
  }
  return false;
}

/** Сообщение для UI чата (с префиксом «Канал оборван»). */
export function formatAiChannelError(err: unknown): string {
  if (isNetworkError(err)) {
    return 'Канал оборван: Нет связи с сервером';
  }
  const detail =
    err instanceof Error ? err.message : 'Не удалось связаться с ИИ-секретарём';
  return `Канал оборван: ${detail}`;
}

/**
 * ИИ-телохранитель через Supabase Edge Function → OpenAI gpt-4o-mini.
 * Прямых запросов к OpenAI / Ollama с клиента нет.
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

        const messages = [
          { role: 'system' as const, content: BODYGUARD_SYSTEM_PROMPT },
          { role: 'user' as const, content: userContent },
        ];

        const { data, error: invokeError } = await sb.functions.invoke(AI_SECRETARY_FUNCTION, {
          body: { messages },
        });

        if (cancelledRef.current) {
          throw new Error('Запрос отменён');
        }

        if (invokeError) {
          // Тело ошибки иногда приходит в data (non-2xx от Edge Function).
          if (data && typeof data === 'object' && 'error' in data) {
            const bodyErr = (data as { error?: string }).error;
            if (bodyErr) throw new Error(bodyErr);
          }
          throw invokeError;
        }

        return parseReply(data);
      } catch (e) {
        if (cancelledRef.current) {
          throw new Error('Запрос отменён');
        }
        const msg = formatAiChannelError(e);
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
