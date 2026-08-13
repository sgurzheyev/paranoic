import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { ChevronLeft, ChevronRight, Gem, Trash2, Type, X } from 'lucide-react';
import { deleteMapGem, formatGemTime, type MapGem } from './mapGems';

type MemoryGemDrawerProps = {
  gems: MapGem[];
  activeId: string;
  currentUserId: string;
  authorLabel: (authorId: string) => string;
  onActiveChange: (gem: MapGem) => void;
  onClose: () => void;
  onDeleted: (gemId: string) => void;
};

/**
 * Left glass drawer for Memory Gems.
 * Swipe / next-prev browse gems; parent flies the map to each gem.
 */
export default function MemoryGemDrawer({
  gems,
  activeId,
  currentUserId,
  authorLabel,
  onActiveChange,
  onClose,
  onDeleted,
}: MemoryGemDrawerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const touchStartX = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const index = useMemo(() => {
    const i = gems.findIndex((g) => g.id === activeId);
    return i >= 0 ? i : 0;
  }, [gems, activeId]);

  const gem = gems[index] ?? null;
  const canPrev = index > 0;
  const canNext = index < gems.length - 1;
  const canDelete = Boolean(currentUserId && gem && gem.author_id === currentUserId);

  const goTo = (nextIndex: number) => {
    const next = gems[nextIndex];
    if (!next) return;
    onActiveChange(next);
  };

  const goPrev = () => {
    if (canPrev) goTo(index - 1);
  };

  const goNext = () => {
    if (canNext) goTo(index + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, gems, onClose]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.loop = true;
    v.muted = true;
    void v.play().catch(() => undefined);
  }, [gem?.id, gem?.media_url]);

  useEffect(() => {
    setDeleteError('');
  }, [gem?.id]);

  if (!gem) return null;

  const typeLabel =
    gem.type === 'photo' ? 'Фото' : gem.type === 'video' ? 'Видео' : 'Текст';

  const onTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
    setDragOffset(0);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (touchStartX.current == null) return;
    const x = e.touches[0]?.clientX ?? touchStartX.current;
    setDragOffset(x - touchStartX.current);
  };

  const onTouchEnd = () => {
    const delta = dragOffset;
    touchStartX.current = null;
    setDragOffset(0);
    if (delta > 64) goPrev();
    else if (delta < -64) goNext();
  };

  const handleDelete = async () => {
    if (!canDelete || deleting) return;
    if (!window.confirm('Удалить эту капсулу безвозвратно? Файл и запись будут стерты.')) {
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteMapGem(gem);
      onDeleted(gem.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось удалить капсулу';
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <aside
      className="memory-gem-drawer"
      role="dialog"
      aria-label="Капсула памяти"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={
        dragOffset
          ? { transform: `translateX(calc(0px + ${dragOffset * 0.15}px))` }
          : undefined
      }
    >
      <div className="memory-gem-drawer__glass">
        <div className="memory-gem-head">
          <div className="memory-gem-title-row">
            <span className="memory-gem-icon" aria-hidden>
              <Gem size={16} />
            </span>
            <div>
              <p className="memory-gem-eyebrow">Memory Gem · {typeLabel}</p>
              <p className="memory-gem-meta">
                {authorLabel(gem.author_id)}
                {gem.created_at ? ` · ${formatGemTime(gem.created_at)}` : ''}
              </p>
            </div>
          </div>
          <div className="memory-gem-head-actions">
            {canDelete && (
              <button
                type="button"
                className="icon-btn memory-gem-delete-btn"
                onClick={() => void handleDelete()}
                disabled={deleting}
                aria-label="Удалить капсулу"
                title="Удалить капсулу"
              >
                <Trash2 size={18} />
              </button>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="memory-gem-drawer__media">
          {gem.type === 'photo' && gem.media_url && (
            <img
              src={gem.media_url}
              alt=""
              className="memory-gem-drawer__photo"
              draggable={false}
            />
          )}
          {gem.type === 'video' && gem.media_url && (
            <video
              ref={videoRef}
              className="memory-gem-drawer__video"
              src={gem.media_url}
              playsInline
              loop
              muted
              autoPlay
              controls
            />
          )}
          {gem.type === 'text' && (
            <div className="memory-gem-drawer__text-card">
              <Type size={22} />
              <p>{gem.content || 'Пустая текстовая капсула'}</p>
            </div>
          )}
          {gem.type !== 'text' && !gem.media_url && (
            <p className="memory-gem-empty">Медиа недоступно</p>
          )}
        </div>

        {gem.content && gem.type !== 'text' && (
          <p className="memory-gem-drawer__caption">{gem.content}</p>
        )}
        {gem.type === 'text' && gem.content && (
          <p className="memory-gem-drawer__coords">
            {gem.lat.toFixed(4)}°, {gem.lng.toFixed(4)}°
          </p>
        )}

        {deleteError && (
          <p className="memory-gem-error" role="alert">
            {deleteError}
          </p>
        )}

        <div className="memory-gem-drawer__nav">
          <button
            type="button"
            className="memory-gem-drawer__nav-btn"
            onClick={goPrev}
            disabled={!canPrev || deleting}
            aria-label="Предыдущая капсула"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="memory-gem-drawer__counter">
            {deleting ? 'Удаляем…' : `${index + 1} / ${gems.length}`}
          </span>
          <button
            type="button"
            className="memory-gem-drawer__nav-btn"
            onClick={goNext}
            disabled={!canNext || deleting}
            aria-label="Следующая капсула"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
