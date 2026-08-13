import { useEffect, useMemo, useRef, useState, type FormEvent, type TouchEvent } from 'react';
import { ChevronLeft, ChevronRight, Gem, Heart, Send, Trash2, Type, X } from 'lucide-react';
import { initials } from './identity';
import { deleteMapGem, formatGemTime, type MapGem } from './mapGems';
import {
  addGemComment,
  fetchGemSocial,
  subscribeGemSocial,
  toggleGemLike,
  type GemAuthorInfo,
  type GemComment,
} from './gemSocial';

type MemoryGemDrawerProps = {
  gems: MapGem[];
  activeId: string;
  currentUserId: string;
  authorLabel: (authorId: string) => string;
  resolveAuthor: (userId: string) => GemAuthorInfo;
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
  resolveAuthor,
  onActiveChange,
  onClose,
  onDeleted,
}: MemoryGemDrawerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const commentsRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeBusy, setLikeBusy] = useState(false);
  const [comments, setComments] = useState<GemComment[]>([]);
  const [draft, setDraft] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [socialError, setSocialError] = useState('');

  const index = useMemo(() => {
    const i = gems.findIndex((g) => g.id === activeId);
    return i >= 0 ? i : 0;
  }, [gems, activeId]);

  const gem = gems[index] ?? null;
  const canPrev = index > 0;
  const canNext = index < gems.length - 1;
  const canDelete = Boolean(currentUserId && gem && gem.author_id === currentUserId);
  const resolveAuthorRef = useRef(resolveAuthor);
  resolveAuthorRef.current = resolveAuthor;

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
    setSocialError('');
    setDraft('');
  }, [gem?.id]);

  useEffect(() => {
    if (!gem?.id) return;
    let cancelled = false;
    void fetchGemSocial(gem.id, currentUserId, resolveAuthorRef.current).then((snap) => {
      if (cancelled) return;
      setLiked(snap.liked);
      setLikeCount(snap.likeCount);
      setComments(snap.comments);
    });
    const stop = subscribeGemSocial(gem.id, {
      onLikeChange: () => {
        void fetchGemSocial(gem.id, currentUserId, resolveAuthorRef.current).then((snap) => {
          if (cancelled) return;
          setLiked(snap.liked);
          setLikeCount(snap.likeCount);
        });
      },
      onCommentInsert: (row) => {
        const incoming: GemComment = {
          id: String(row.id ?? ''),
          gem_id: String(row.gem_id ?? gem.id),
          user_id: String(row.user_id ?? ''),
          content: String(row.content ?? ''),
          created_at: String(row.created_at ?? new Date().toISOString()),
          author: resolveAuthorRef.current(String(row.user_id ?? '')),
        };
        if (!incoming.id) return;
        setComments((prev) => {
          if (prev.some((c) => c.id === incoming.id)) return prev;
          const optimistic = prev.findIndex(
            (c) =>
              c.id.startsWith('tmp-') &&
              c.user_id === incoming.user_id &&
              c.content === incoming.content
          );
          if (optimistic >= 0) {
            const next = [...prev];
            next[optimistic] = incoming;
            return next;
          }
          return [...prev, incoming];
        });
      },
      onCommentDelete: (id) => {
        setComments((prev) => prev.filter((c) => c.id !== id));
      },
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [gem?.id, currentUserId]);

  useEffect(() => {
    const el = commentsRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [comments.length]);

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

  const handleLike = async () => {
    if (!currentUserId || likeBusy) return;
    const nextLiked = !liked;
    setLiked(nextLiked);
    setLikeCount((n) => Math.max(0, n + (nextLiked ? 1 : -1)));
    setLikeBusy(true);
    setSocialError('');
    try {
      const confirmed = await toggleGemLike(gem.id, liked);
      setLiked(confirmed);
    } catch (e) {
      setLiked(liked);
      setLikeCount((n) => Math.max(0, n + (nextLiked ? -1 : 1)));
      setSocialError(e instanceof Error ? e.message : 'Не удалось обновить лайк');
    } finally {
      setLikeBusy(false);
    }
  };

  const handleComment = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || commentBusy || !currentUserId) return;
    const temp: GemComment = {
      id: `tmp-${Date.now()}`,
      gem_id: gem.id,
      user_id: currentUserId,
      content: text,
      created_at: new Date().toISOString(),
      author: resolveAuthor(currentUserId),
    };
    setComments((prev) => [...prev, temp]);
    setDraft('');
    setCommentBusy(true);
    setSocialError('');
    try {
      const saved = await addGemComment(gem.id, text, resolveAuthor);
      setComments((prev) => {
        const withoutTemp = prev.filter((c) => c.id !== temp.id);
        if (withoutTemp.some((c) => c.id === saved.id)) return withoutTemp;
        return [...withoutTemp, saved];
      });
    } catch (err) {
      setComments((prev) => prev.filter((c) => c.id !== temp.id));
      setDraft(text);
      setSocialError(err instanceof Error ? err.message : 'Не удалось отправить комментарий');
    } finally {
      setCommentBusy(false);
    }
  };

  return (
    <aside
      className="memory-gem-drawer"
      role="dialog"
      aria-label="Капсула памяти"
      style={
        dragOffset
          ? { transform: `translateX(calc(0px + ${dragOffset * 0.15}px))` }
          : undefined
      }
    >
      <div className="memory-gem-drawer__glass">
        <div className="memory-gem-head-scrim" aria-hidden />
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
          <div className="memory-gem-head-actions overlay-close">
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

        <div
          className="memory-gem-drawer__media"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
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

        <div
          className="memory-gem-social"
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={`memory-gem-like${liked ? ' is-liked' : ''}`}
            onClick={() => void handleLike()}
            disabled={!currentUserId || likeBusy}
            aria-pressed={liked}
            aria-label={liked ? 'Убрать лайк' : 'Нравится'}
          >
            <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
            <span>{likeCount}</span>
          </button>

          <div className="memory-gem-comments" ref={commentsRef}>
            {comments.length === 0 ? (
              <p className="memory-gem-comments__empty">Пока нет комментариев</p>
            ) : (
              comments.map((c) => (
                <div key={c.id} className="memory-gem-comment">
                  <span
                    className="memory-gem-comment__avatar"
                    style={{ background: c.author.avatarUrl ? '#1a1d28' : c.author.color || '#60a5fa' }}
                  >
                    {c.author.avatarUrl ? (
                      <img src={c.author.avatarUrl} alt="" draggable={false} />
                    ) : (
                      initials(c.author.name)
                    )}
                  </span>
                  <div className="memory-gem-comment__body">
                    <p className="memory-gem-comment__meta">
                      <strong>{c.author.name}</strong>
                      <span>{formatGemTime(c.created_at)}</span>
                    </p>
                    <p className="memory-gem-comment__text">{c.content}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          <form className="memory-gem-comment-form" onSubmit={(e) => void handleComment(e)}>
            <input
              className="memory-gem-comment-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Написать комментарий…"
              maxLength={500}
              disabled={commentBusy || !currentUserId}
              aria-label="Комментарий"
            />
            <button
              type="submit"
              className="memory-gem-comment-send"
              disabled={commentBusy || !draft.trim() || !currentUserId}
              aria-label="Отправить"
            >
              <Send size={15} />
            </button>
          </form>
        </div>

        {(deleteError || socialError) && (
          <p className="memory-gem-error" role="alert">
            {deleteError || socialError}
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
