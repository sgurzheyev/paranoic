import { useCallback, useRef, useState } from 'react';
import {
  BODYGUARD_SYSTEM_PROMPT,
  loadAiSettings,
} from './aiSettings';

export type LocalAiMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type GenerateResult = {
  response: string;
};

/**
 * Локальный LLM через Ollama-совместимый POST /api/generate.
 * Адрес и модель — из aiSettings (профиль / секретное меню).
 */
export function useLocalAI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  const generate = useCallback(
    async (userMessage: string, situationContext?: string): Promise<string> => {
      const trimmed = userMessage.trim();
      if (!trimmed) throw new Error('Пустое сообщение');

      const { apiUrl, model } = loadAiSettings();
      const prompt = situationContext?.trim()
        ? `${trimmed}\n\n[Контекст обстановки]\n${situationContext.trim()}`
        : trimmed;

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError('');

      try {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
            model,
            prompt,
            system: BODYGUARD_SYSTEM_PROMPT,
            stream: false,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(
            text || `Ollama ответила ${res.status}. Проверьте API URL и что сервер запущен.`
          );
        }

        const data = (await res.json()) as GenerateResult & { error?: string };
        if (data.error) throw new Error(data.error);
        const reply = (data.response || '').trim();
        if (!reply) throw new Error('Пустой ответ модели');
        return reply;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          throw new Error('Запрос отменён');
        }
        const msg =
          e instanceof TypeError
            ? 'Нет связи с локальным ИИ. Запустите Ollama на localhost:11434.'
            : e instanceof Error
              ? e.message
              : 'Ошибка локального ИИ';
        setError(msg);
        throw new Error(msg);
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setLoading(false);
      }
    },
    []
  );

  return { generate, loading, error, cancel, setError };
}
