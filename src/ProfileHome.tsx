import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  FileText,
  ImagePlus,
  Link2,
  Mic,
  Pencil,
  Settings2,
} from 'lucide-react';
import Avatar from './Avatar';
import { updateIdentity, type UserIdentity } from './identity';
import { bumpMediaViewCount, getMediaViewCounts } from './mediaViews';
import { uploadAvatar } from './profile';
import {
  formatFileSize,
  loadMediaBlob,
  loadOwnMediaArchive,
  mediaStorageKey,
  type OwnMediaArchiveItem,
} from './storage';

type ProfileHomeProps = {
  identity: UserIdentity;
  magicLink: string;
  accountHint?: string;
  ghostMode: boolean;
  connected: boolean;
  peerLabel: string;
  e2eeHint?: string;
  onIdentityChange: (next: UserIdentity) => void;
  onOpenEditor: () => void;
  onCopyMagicLink: () => void | Promise<void>;
  copiedLink: boolean;
};

function ArchiveThumb({ item }: { item: OwnMediaArchiveItem }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    const key = item.message.mediaKey || mediaStorageKey(item.message.id);
    void (async () => {
      const blob = await loadMediaBlob(key);
      if (cancelled || !blob) return;
      const objectUrl = URL.createObjectURL(blob);
      revoked = objectUrl;
      setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [item.message.id, item.message.mediaKey]);

  if (item.category === 'media' && url) {
    if (item.message.mediaMime?.startsWith('video/')) {
      return <video src={url} muted playsInline className="profile-archive-media" />;
    }
    return <img src={url} alt="" className="profile-archive-media" />;
  }

  const Icon = item.category === 'voice' ? Mic : FileText;
  return (
    <span className={`profile-archive-fallback profile-archive-fallback--${item.category}`}>
      <Icon size={18} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/** Вкладка «Профиль»: шапка, быстрые действия, медиа-архив. */
export default function ProfileHome({
  identity,
  magicLink,
  accountHint,
  ghostMode,
  connected,
  peerLabel,
  e2eeHint,
  onIdentityChange,
  onOpenEditor,
  onCopyMagicLink,
  copiedLink,
}: ProfileHomeProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [error, setError] = useState('');
  const [archive, setArchive] = useState<OwnMediaArchiveItem[]>([]);
  const [views, setViews] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<{
    item: OwnMediaArchiveItem;
    url: string;
  } | null>(null);

  const handle = identity.username?.trim();
  const subtitle = handle
    ? `@${handle}`
    : accountHint
      ? accountHint
      : `ID · ${identity.id.slice(0, 10)}…`;

  useEffect(() => {
    let cancelled = false;
    void loadOwnMediaArchive(identity.id, 36).then((rows) => {
      if (cancelled) return;
      setArchive(rows);
      setViews(getMediaViewCounts(rows.map((r) => r.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [identity.id]);

  const totalViews = useMemo(
    () => Object.values(views).reduce((sum, n) => sum + n, 0),
    [views]
  );

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const url = await uploadAvatar(identity.id, file);
      const next = updateIdentity({ avatarUrl: url });
      onIdentityChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить фото');
    } finally {
      setUploading(false);
    }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(identity.id);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 1600);
    } catch {
      setError('Не удалось скопировать User ID');
    }
  };

  const openItem = async (item: OwnMediaArchiveItem) => {
    const nextCount = bumpMediaViewCount(item.id);
    setViews((prev) => ({ ...prev, [item.id]: nextCount }));
    const key = item.message.mediaKey || mediaStorageKey(item.message.id);
    const blob = await loadMediaBlob(key);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return { item, url };
    });
  };

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  return (
    <div className="profile-home">
      <header className="profile-hero liquid-glass-card">
        <div className="profile-hero-glow" aria-hidden />
        <div className="profile-hero-top">
          <div className="profile-hero-avatar-wrap">
            <Avatar
              name={identity.name}
              color={identity.color}
              avatarUrl={identity.avatarUrl}
              size="lg"
              online="self"
            />
            <button
              type="button"
              className="profile-hero-photo-btn"
              disabled={uploading}
              aria-label="Сменить фото"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus size={14} strokeWidth={1.75} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void onPickAvatar(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <div className="profile-hero-meta">
            <button type="button" className="profile-hero-name" onClick={onOpenEditor}>
              <span>{identity.name}</span>
              <Pencil size={13} strokeWidth={1.75} />
            </button>
            <p className="profile-hero-handle">{subtitle}</p>
            {ghostMode && <p className="ghost-mode-pill">Ghost Mode · Антарктида</p>}
          </div>
          <button
            type="button"
            className="icon-btn profile-settings-btn"
            onClick={onOpenEditor}
            aria-label="Редактировать профиль"
          >
            <Settings2 size={16} />
          </button>
        </div>

        <div className="profile-hero-actions">
          <button
            type="button"
            className="profile-action-chip"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            <ImagePlus size={14} />
            {uploading ? 'Загрузка…' : 'Фото'}
          </button>
          <button type="button" className="profile-action-chip" onClick={() => void copyId()}>
            {copiedId ? <Check size={14} /> : <Copy size={14} />}
            {copiedId ? 'ID скопирован' : 'User ID'}
          </button>
          <button
            type="button"
            className="profile-action-chip profile-action-chip--accent"
            onClick={() => void onCopyMagicLink()}
          >
            {copiedLink ? <Check size={14} /> : <Link2 size={14} />}
            {copiedLink ? 'Ссылка' : 'Magic link'}
          </button>
        </div>

        <div className="profile-id-row">
          <code className="profile-id-mono">{identity.id}</code>
        </div>
        <p className="profile-magic-url mono-box magic-url">{magicLink}</p>
        <p className="hint" style={{ margin: 0 }}>
          {handle
            ? `Короткая ссылка: ?u=${handle}`
            : 'Задайте никнейм в редакторе — ссылка станет короткой.'}
        </p>
        {error ? <p className="profile-home-error">{error}</p> : null}
      </header>

      <section className="profile-archive liquid-glass-card">
        <div className="profile-archive-head">
          <div>
            <h3>Медиа-архив</h3>
            <p>Ваши публикации из локальных чатов</p>
          </div>
          <div className="profile-archive-stats">
            <span>
              <strong>{archive.length}</strong> файлов
            </span>
            <span>
              <Eye size={12} /> <strong>{totalViews}</strong>
            </span>
          </div>
        </div>

        {archive.length === 0 ? (
          <p className="profile-archive-empty">
            Пока пусто. Отправьте фото, файл или голосовое — они появятся здесь.
          </p>
        ) : (
          <div className="profile-archive-grid">
            {archive.map((item) => (
              <button
                key={item.id}
                type="button"
                className="profile-archive-card"
                onClick={() => void openItem(item)}
              >
                <span className="profile-archive-thumb">
                  <ArchiveThumb item={item} />
                </span>
                <span className="profile-archive-card-meta">
                  <span className="profile-archive-card-title truncate">
                    {item.message.mediaName ||
                      (item.category === 'voice'
                        ? 'Голосовое'
                        : item.category === 'files'
                          ? 'Файл'
                          : 'Медиа')}
                  </span>
                  <span className="profile-archive-card-foot">
                    <span className="profile-archive-views">
                      <Eye size={11} /> {views[item.id] ?? 0}
                    </span>
                    <span>
                      {item.message.mediaSize
                        ? formatFileSize(item.message.mediaSize)
                        : item.timeLabel}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <p className="lead" style={{ margin: '4px 2px 0' }}>
        {connected ? (
          <>
            На связи: <strong>{peerLabel}</strong>
          </>
        ) : (
          'Ссылка активна. Поделитесь ею — гости сохранят вас в контакты.'
        )}
      </p>
      {e2eeHint ? <p className="hint muted-sep">{e2eeHint}</p> : null}

      {preview && (
        <div
          className="profile-archive-preview-backdrop"
          role="presentation"
          onClick={() => {
            URL.revokeObjectURL(preview.url);
            setPreview(null);
          }}
        >
          <div
            className="profile-archive-preview"
            role="dialog"
            aria-label="Просмотр медиа"
            onClick={(e) => e.stopPropagation()}
          >
            {preview.item.category === 'voice' ||
            preview.item.message.mediaMime?.startsWith('audio/') ? (
              <audio src={preview.url} controls autoPlay className="profile-archive-preview-audio" />
            ) : preview.item.message.mediaMime?.startsWith('video/') ? (
              <video src={preview.url} controls autoPlay playsInline className="profile-archive-preview-media" />
            ) : preview.item.category === 'media' ? (
              <img src={preview.url} alt="" className="profile-archive-preview-media" />
            ) : (
              <a href={preview.url} download={preview.item.message.mediaName || 'file'} className="mega-btn primary compact">
                Скачать файл
              </a>
            )}
            <p className="profile-archive-preview-views">
              <Eye size={14} /> {views[preview.item.id] ?? 0} просмотров
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
