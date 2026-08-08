import { useEffect, useRef, useState } from 'react';
import { Radar, Send, Square, X } from 'lucide-react';
import { useLocalAI } from './useLocalAI';

export type AiChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type AiBodyguardChatProps = {
  /** Тихий сбор: content видимых map_gems → [Контекст обстановки]. */
  collectSituationContext: () => string;
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
  const { generate, loading, error, cancel, setError } = useLocalAI();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AiChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'На связи. Я вижу карту лучше, чем ты думаешь. Спрашивай — или молчи и не светись.',
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

    // Тихо: контекст капсул не показываем в UI.
    const situation = collectSituationContext();

    try {
      const reply = await generate(text, situation);
      setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Сбой канала';
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          content: `Канал оборван: ${msg}`,
        },
      ]);
    }
  };

  return (
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
              <p>Локальный LLM · контекст капсул без утечки в UI</p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="ai-bodyguard-messages" ref={listRef}>
          {messages.map((m) => (
            <div
              key={m.id}
              className={`ai-bodyguard-bubble ${m.role === 'user' ? 'is-user' : 'is-ai'}`}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="ai-bodyguard-bubble is-ai is-typing">Сканирую обстановку…</div>
          )}
        </div>

        {error && (
          <p className="ai-bodyguard-error" role="alert">
            {error}
          </p>
        )}

        <form
          className="ai-bodyguard-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Шёпотом в канал…"
            disabled={loading}
            maxLength={2000}
            autoComplete="off"
          />
          {loading ? (
            <button type="button" className="ai-bodyguard-send" onClick={cancel} aria-label="Стоп">
              <Square size={16} />
            </button>
          ) : (
            <button
              type="submit"
              className="ai-bodyguard-send"
              disabled={!input.trim()}
              aria-label="Отправить"
            >
              <Send size={16} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
