import { useMemo, useState } from 'react';
import { Check, Copy, Link2, X } from 'lucide-react';
import Avatar from './Avatar';
import { buildMagicLink } from './identity';
import type { StoredMessage } from './storage';

export type PeerProfileData = {
  id: string;
  name: string;
  username?: string;
  color: string;
  avatarUrl?: string;
  online: boolean;
  typing?: boolean;
};

type PeerProfileModalProps = {
  peer: PeerProfileData;
  messages: Array<StoredMessage & { mediaUrl?: string }>;
  onClose: () => void;
};

function isImageUrl(url: string, name?: string): boolean {
  const hay = `${url} ${name || ''}`.toLowerCase();
  return /\.(png|jpe?g|gif|webp|avif|heic|bmp)(\?|$)/i.test(hay) || hay.includes('image/');
}

/**
 * Read-only профиль собеседника из шапки чата.
 * Закрытие не трогает P2P / conversation — возврат в тот же чат.
 */
export default function PeerProfileModal({ peer, messages, onClose }: PeerProfileModalProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const shareLink = useMemo(() => {
    const handle = peer.username?.trim() || peer.id;
    return buildMagicLink(handle);
  }, [peer.id, peer.username]);

  const mediaItems = useMemo(() => {
    const out: { id: string; url: string; name?: string }[] = [];
    for (const m of messages) {
      if (m.kind !== 'media' || !m.mediaUrl) continue;
      if (m.mediaKind === 'voice') continue;
      out.push({ id: m.id, url: m.mediaUrl, name: m.mediaName });
    }
    return out.slice(-24).reverse();
  }, [messages]);

  const copy = async (value: string, kind: 'link' | 'id') => {
    try {
      await navigator.clipboard.writeText(value);
      if (kind === 'link') {
        setCopiedLink(true);
        window.setTimeout(() => setCopiedLink(false), 1600);
      } else {
        setCopiedId(true);
        window.setTimeout(() => setCopiedId(false), 1600);
      }
    } catch {
      /* */
    }
  };

  const statusLabel = peer.typing ? 'печатает…' : peer.online ? 'на связи' : 'офлайн';

  return (
    <div
      className="peer-profile-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="peer-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="peer-profile-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="peer-profile-head">
          <h2 id="peer-profile-title">Профиль</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="peer-profile-hero">
          <Avatar
            name={peer.name}
            color={peer.color}
            avatarUrl={peer.avatarUrl}
            size="lg"
          />
          <div className="peer-profile-hero-meta">
            <p className="peer-profile-name">{peer.name}</p>
            {peer.username ? (
              <p className="peer-profile-username">@{peer.username}</p>
            ) : null}
            <p className={`peer-profile-status${peer.online ? ' is-online' : ''}`}>
              {statusLabel}
            </p>
          </div>
        </div>

        <section className="peer-profile-section">
          <p className="peer-profile-label">User ID</p>
          <div className="peer-profile-row">
            <code className="peer-profile-mono">{peer.id}</code>
            <button
              type="button"
              className="peer-profile-copy"
              onClick={() => void copy(peer.id, 'id')}
              aria-label="Скопировать ID"
            >
              {copiedId ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </section>

        <section className="peer-profile-section">
          <p className="peer-profile-label">
            <Link2 size={12} aria-hidden /> Ссылка
          </p>
          <div className="peer-profile-row">
            <code className="peer-profile-mono">{shareLink}</code>
            <button
              type="button"
              className="peer-profile-copy"
              onClick={() => void copy(shareLink, 'link')}
              aria-label="Скопировать ссылку"
            >
              {copiedLink ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </section>

        <section className="peer-profile-section">
          <p className="peer-profile-label">Медиа в этом чате</p>
          {mediaItems.length === 0 ? (
            <p className="peer-profile-empty">Пока нет фото или видео в переписке.</p>
          ) : (
            <div className="peer-profile-media-grid">
              {mediaItems.map((item) =>
                isImageUrl(item.url, item.name) ? (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="peer-profile-media-cell"
                  >
                    <img src={item.url} alt="" loading="lazy" />
                  </a>
                ) : (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="peer-profile-media-cell is-file"
                  >
                    ▶
                  </a>
                )
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
