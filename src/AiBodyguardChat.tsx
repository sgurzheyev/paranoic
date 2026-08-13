import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloudOff, Radar, Send, Square, X } from 'lucide-react';
import { useAiSecretary } from './useAiSecretary';

export type AiChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
};

type AiBodyguardChatProps = {
  /** Сбор realtime-контекста (локация, контакты, P2P, капсулы) → system prompt. */
  collectSituationContext: () => string | Promise<string>;
  onClose: () => void;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Чат с ИИ-телохранителем поверх карты (Liquid Glass). */
export default function AiBodyguardChat({
  collectSituationContext,
  onClose,
}: AiBodyguardChatProps) {
  const { generate, loading, error, cancel, setError } = useAiSecretary();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AiChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'На связи. Облако подключено — карту вижу лучше, чем ты думаешь. Спрашивай или молчи.',
    },
  ]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError('');
    setMessages((prev) => [...prev, { id: uid(), role: 'user', content: text }]);

    const situation = await Promise.resolve(collectSituationContext());

    try {
      const reply = await generate(text, situation);
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: reply }]);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Канал оборван: Нет связи с сервером';
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          isError: true,
          content: msg.startsWith('Канал оборван:') ? msg : `Канал оборван: ${msg}`,
        },
      ]);
    }
  };

  return createPortal(
    <div className="ai-bodyguard-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ai-bodyguard-card"
        role="dialog"
        aria-label="ИИ-телохранитель"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ai-bodyguard-head">
          <div className="ai-bodyguard-title">
            <span className="ai-bodyguard-radar" aria-hidden>
              <Radar size={18} />
            </span>
            <div>
              <h2>ИИ-телохранитель</h2>
              <p>Анализ обстановки…</p>
            </div>
          </div>
          <button type="button" className="icon-btn overlay-close" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="ai-bodyguard-messages" ref={listRef}>
          {messages.map((m) => (
            <div
              key={m.id}
              className={`ai-bodyguard-bubble ${m.role === 'user' ? 'is-user' : 'is-ai'}${
                m.isError ? ' is-error' : ''
              }`}
            >
              {m.isError && (
                <span className="ai-bodyguard-error-icon" aria-hidden>
                  <CloudOff size={14} />
                </span>
              )}
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="ai-bodyguard-bubble is-ai is-typing">
              <span className="ai-bodyguard-scan-dots" aria-hidden>
                <span />
                <span />
                <span />
              </span>
              ИИ сканирует…
            </div>
          )}
        </div>

        {error && (
          <div className="ai-bodyguard-error-banner" role="alert">
            <CloudOff size={16} />
            <span>{error}</span>
          </div>
        )}

        <form
          className="ai-bodyguard-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Шёпотом в канал…"
            maxLength={2000}
            autoComplete="off"
            autoFocus
          />
          {loading ? (
            <button type="button" className="ai-bodyguard-send" onClick={cancel} aria-label="Стоп">
              <Square size={16} />
            </button>
          ) : (
            <button type="submit" className="ai-bodyguard-send" aria-label="Отправить">
              <Send size={16} />
            </button>
          )}
        </form>
      </div>
    </div>,
    document.body
  );
}
