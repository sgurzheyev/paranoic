import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloudOff, Images, Send, Sparkles, Square, X, Zap } from 'lucide-react';
import { useAiSecretary } from './useAiSecretary';
import {
  buildScanConfirmation,
  isHeavyMediaQuery,
  totalMediaCount,
  type MediaLibraryIndex,
} from './mediaLibrary';

export type AiChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  /** Ждём нажатия «Да, погнали» перед тяжёлым сканом медиатеки. */
  pendingQuery?: string;
};

type AiBodyguardChatProps = {
  /** Сбор realtime-контекста (локация, контакты, P2P, капсулы, медиатека) → system prompt. */
  collectSituationContext: () => string | Promise<string>;
  /** Метаданные фото/видео семьи — для оценки масштаба запроса. */
  getMediaLibrary?: () => MediaLibraryIndex;
  onClose: () => void;
};

/** Скорость печати ответа, символов за кадр. */
const TYPE_CHARS_PER_TICK = 2;
const TYPE_TICK_MS = 16;

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Плавающий чат Omni-Helper поверх карты (glassmorphism). */
export default function AiBodyguardChat({
  collectSituationContext,
  getMediaLibrary,
  onClose,
}: AiBodyguardChatProps) {
  const { generate, loading, error, cancel, setError } = useAiSecretary();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AiChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'На связи, шеф. Вижу карту, контакты и всю вашу медиатеку. Спрашивай — найду что угодно.',
    },
  ]);
  /** Текст ответа, который сейчас «печатается». */
  const [typing, setTyping] = useState<{ id: string; full: string; shown: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading, typing]);

  /** Посимвольная выдача ответа ассистента. */
  useEffect(() => {
    if (!typing) return;
    if (typing.shown >= typing.full.length) {
      setMessages((prev) => [
        ...prev,
        { id: typing.id, role: 'assistant', content: typing.full },
      ]);
      setTyping(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setTyping((prev) =>
        prev && prev.id === typing.id
          ? { ...prev, shown: Math.min(prev.full.length, prev.shown + TYPE_CHARS_PER_TICK) }
          : prev
      );
    }, TYPE_TICK_MS);
    return () => window.clearTimeout(timer);
  }, [typing]);

  const runQuery = useCallback(
    async (text: string) => {
      const situation = await Promise.resolve(collectSituationContext());
      try {
        const reply = await generate(text, situation);
        setTyping({ id: uid(), full: reply, shown: 0 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Канал оборван: Нет связи с сервером';
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
    },
    [collectSituationContext, generate]
  );

  const send = async () => {
    const text = input.trim();
    if (!text || loading || typing) return;
    setInput('');
    setError('');
    setMessages((prev) => [...prev, { id: uid(), role: 'user', content: text }]);

    const library = getMediaLibrary?.();
    if (library && isHeavyMediaQuery(text, library)) {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          content: buildScanConfirmation(library),
          pendingQuery: text,
        },
      ]);
      return;
    }

    await runQuery(text);
  };

  const confirmScan = async (messageId: string, query: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, pendingQuery: undefined } : m))
    );
    await runQuery(query);
  };

  const library = getMediaLibrary?.();
  const mediaTotal = library ? totalMediaCount(library) : 0;

  return createPortal(
    <div
      className={`ai-bodyguard-backdrop${visible ? ' is-visible' : ''}`}
      role="presentation"
      onClick={onClose}
    >
      <div
        className="ai-bodyguard-card"
        role="dialog"
        aria-label="Секретарь — ИИ-агент"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ai-bodyguard-head">
          <div className="ai-bodyguard-title">
            <span className="ai-bodyguard-radar" aria-hidden>
              <Sparkles size={18} />
            </span>
            <div>
              <h2>Секретарь</h2>
              <p>
                {mediaTotal > 0
                  ? `Медиатека: ${library?.photos ?? 0} фото · ${library?.videos ?? 0} видео`
                  : 'Анализ обстановки…'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn overlay-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={20} />
          </button>
        </div>

        <div className="ai-bodyguard-messages" ref={listRef}>
          {messages.map((m) => (
            <div key={m.id} className="ai-bodyguard-row">
              <div
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
              {m.pendingQuery && (
                <button
                  type="button"
                  className="ai-bodyguard-confirm"
                  disabled={loading}
                  onClick={() => void confirmScan(m.id, m.pendingQuery!)}
                >
                  <Zap size={15} aria-hidden />
                  Да, погнали
                </button>
              )}
            </div>
          ))}

          {typing && (
            <div className="ai-bodyguard-row">
              <div className="ai-bodyguard-bubble is-ai">
                {typing.full.slice(0, typing.shown)}
                <span className="ai-bodyguard-caret" aria-hidden />
              </div>
            </div>
          )}

          {loading && (
            <div className="ai-bodyguard-row">
              <div className="ai-bodyguard-bubble is-ai is-typing">
                <span className="ai-bodyguard-scan-dots" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
                {mediaTotal > 0 ? (
                  <>
                    <Images size={13} aria-hidden /> Просматриваю медиатеку…
                  </>
                ) : (
                  'Собираю данные…'
                )}
              </div>
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
            placeholder="Спроси о фото, местах или контактах…"
            maxLength={2000}
            autoComplete="off"
            autoFocus
          />
          {loading ? (
            <button
              type="button"
              className="ai-bodyguard-send"
              onClick={cancel}
              aria-label="Стоп"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              type="submit"
              className="ai-bodyguard-send"
              aria-label="Отправить"
              disabled={Boolean(typing)}
            >
              <Send size={16} />
            </button>
          )}
        </form>
      </div>
    </div>,
    document.body
  );
}
