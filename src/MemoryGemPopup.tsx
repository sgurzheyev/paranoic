import { useEffect, useRef } from 'react';
import { Gem, X } from 'lucide-react';
import { formatGemTime, type MapGem } from './mapGems';

type MemoryGemPopupProps = {
  gem: MapGem;
  authorLabel?: string;
  onClose: () => void;
};

/** Распаковка капсулы памяти — Liquid Glass. */
export default function MemoryGemPopup({
  gem,
  authorLabel,
  onClose,
}: MemoryGemPopupProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.loop = true;
    v.muted = true;
    void v.play().catch(() => undefined);
  }, [gem.id, gem.media_url]);

  const typeLabel =
    gem.type === 'photo' ? 'Фото' : gem.type === 'video' ? 'Видео' : 'Текст';

  return (
    <div className="memory-gem-backdrop" role="presentation" onClick={onClose}>
      <div
        className="memory-gem-card"
        role="dialog"
        aria-label="Капсула памяти"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="memory-gem-head">
          <div className="memory-gem-title-row">
            <span className="memory-gem-icon" aria-hidden>
              <Gem size={16} />
            </span>
            <div>
              <p className="memory-gem-eyebrow">Memory Gem · {typeLabel}</p>
              <p className="memory-gem-meta">
                {authorLabel || gem.author_id.slice(0, 10)}
                {gem.created_at ? ` · ${formatGemTime(gem.created_at)}` : ''}
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn overlay-close" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div className="memory-gem-body">
          {gem.type === 'photo' && gem.media_url && (
            <img
              src={gem.media_url}
              alt=""
              className="memory-gem-photo"
              draggable={false}
            />
          )}
          {gem.type === 'video' && gem.media_url && (
            <video
              ref={videoRef}
              className="memory-gem-video"
              src={gem.media_url}
              playsInline
              loop
              muted
              autoPlay
            />
          )}
          {(gem.type === 'text' || gem.content) && gem.content && (
            <p className="memory-gem-text">{gem.content}</p>
          )}
          {gem.type !== 'text' && !gem.media_url && !gem.content && (
            <p className="memory-gem-empty">Пустая капсула</p>
          )}
        </div>
      </div>
    </div>
  );
}
