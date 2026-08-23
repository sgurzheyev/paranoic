import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Gem, ImagePlus, Lock, Type, Video, X } from 'lucide-react';
import { useLanguage } from './i18n';
import {
  FREE_MAP_GEM_LIMIT,
  createMapGem,
  isFreeGemLimitReached,
  uploadGemMedia,
  type GemVisibility,
  type MapGem,
  type MapGemType,
} from './mapGems';
import { MAX_UPLOAD_BYTES_BEFORE_COMPRESS } from './s3Storage';
import { playSuccessSound } from './notify';

type MemoryGemComposerProps = {
  lat: number;
  lng: number;
  onClose: () => void;
  onCreated: (gem: MapGem) => void;
};

/** Модалка «Создать капсулу» (Drop a Gem) — Liquid Glass. */
export default function MemoryGemComposer({
  lat,
  lng,
  onClose,
  onCreated,
}: MemoryGemComposerProps) {
  const [type, setType] = useState<MapGemType | null>(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'upload' | 'save'>('idle');
  const [error, setError] = useState('');
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [visibility, setVisibility] = useState<GemVisibility>('family');
  const fileRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const pickType = (next: MapGemType) => {
    setType(next);
    setError('');
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (next === 'photo' || next === 'video') {
      const input = fileRef.current;
      if (input) {
        input.accept = next === 'video' ? 'video/*' : 'image/*';
        input.value = '';
        input.click();
      }
    }
  };

  const onFile = (picked: File | undefined) => {
    if (!picked) return;
    if (picked.size > MAX_UPLOAD_BYTES_BEFORE_COMPRESS) {
      const mb = (picked.size / (1024 * 1024)).toFixed(1);
      setError(
        `Файл слишком большой (${mb} МБ). Максимум ${MAX_UPLOAD_BYTES_BEFORE_COMPRESS / (1024 * 1024)} МБ.`
      );
      setFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      return;
    }
    setError('');
    setFile(picked);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(picked));
  };

  const save = async () => {
    if (!type) {
      setError('Выберите тип капсулы');
      return;
    }
    setBusy(true);
    setError('');
    setProgress(0);
    let step: 'idle' | 'upload' | 'save' = 'idle';
    try {
      if (await isFreeGemLimitReached()) {
        setPaywallOpen(true);
        return;
      }

      let mediaUrl: string | null = null;
      if (type === 'photo' || type === 'video') {
        if (!file) throw new Error(type === 'photo' ? 'Выберите фото' : 'Выберите видео');
        step = 'upload';
        setPhase('upload');
        mediaUrl = await uploadGemMedia(file, (ratio) => setProgress(ratio));
      }
      if (type === 'text' && !text.trim()) {
        throw new Error('Введите текст капсулы');
      }
      step = 'save';
      setPhase('save');
      setProgress(1);
      const gem = await createMapGem({
        lat,
        lng,
        type,
        mediaUrl,
        content: text.trim() || null,
        visibility,
      });
      playSuccessSound();
      onCreated(gem);
      onClose();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const detail = `[${step}] ${err.message} | ${err.stack ?? 'no stack'}`;
      alert(detail);
      setError(detail);
      setPhase('idle');
    } finally {
      setBusy(false);
    }
  };

  const progressLabel =
    phase === 'upload'
      ? `Загрузка… ${Math.round(progress * 100)}%`
      : phase === 'save'
        ? 'Сохраняем капсулу…'
        : busy
          ? 'Сохраняем…'
          : 'Создать капсулу';

  return createPortal(
    <div className="memory-gem-backdrop" role="presentation" onClick={onClose}>
      <div
        className="memory-gem-card composer"
        role="dialog"
        aria-label="Создать капсулу"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="memory-gem-head">
          <div className="memory-gem-title-row">
            <span className="memory-gem-icon" aria-hidden>
              <Gem size={16} />
            </span>
            <div>
              <p className="memory-gem-eyebrow">Drop a Gem</p>
              <h2 className="memory-gem-heading">Создать капсулу</h2>
              <p className="memory-gem-meta">
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn overlay-close"
            onClick={onClose}
            aria-label="Закрыть"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>

        <div className="memory-gem-composer-body">
          <div className="memory-gem-type-row">
            <button
              type="button"
              className={`memory-gem-type-btn${type === 'photo' ? ' active' : ''}`}
              onClick={() => pickType('photo')}
              disabled={busy}
            >
              <ImagePlus size={15} />
              Фото
            </button>
            <button
              type="button"
              className={`memory-gem-type-btn${type === 'video' ? ' active' : ''}`}
              onClick={() => pickType('video')}
              disabled={busy}
            >
              <Video size={15} />
              Видео
            </button>
            <button
              type="button"
              className={`memory-gem-type-btn${type === 'text' ? ' active' : ''}`}
              onClick={() => pickType('text')}
              disabled={busy}
            >
              <Type size={15} />
              Текст
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept={type === 'video' ? 'video/*' : 'image/*'}
            hidden
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          {type === 'text' && (
            <textarea
              className="memory-gem-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Что хотите оставить в этом месте?"
              maxLength={500}
              rows={4}
              disabled={busy}
            />
          )}

          {(type === 'photo' || type === 'video') && (
            <div className="memory-gem-file-block">
              {previewUrl && type === 'photo' && (
                <img src={previewUrl} alt="" className="memory-gem-preview" draggable={false} />
              )}
              {previewUrl && type === 'video' && (
                <video
                  src={previewUrl}
                  className="memory-gem-preview"
                  muted
                  playsInline
                  loop
                  autoPlay
                />
              )}
              <button
                type="button"
                className="accept-file-btn"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                {type === 'photo' ? <ImagePlus size={16} /> : <Video size={16} />}
                {file ? file.name : type === 'photo' ? 'Выбрать фото' : 'Выбрать видео'}
              </button>
              <textarea
                className="memory-gem-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Подпись (необязательно)"
                maxLength={280}
                rows={2}
                disabled={busy}
              />
            </div>
          )}

          <div className="gem-visibility-picker" role="radiogroup" aria-label={t('gems.visibility')}>
            <p className="gem-visibility-label">{t('gems.visibility')}</p>
            {(
              [
                ['private', 'gems.visibilityPrivate', 'gems.visibilityPrivateDesc'],
                ['family', 'gems.visibilityFamily', 'gems.visibilityFamilyDesc'],
                ['public', 'gems.visibilityPublic', 'gems.visibilityPublicDesc'],
              ] as const
            ).map(([vis, labelKey, descKey]) => (
              <label
                key={vis}
                className={`gem-visibility-option${visibility === vis ? ' is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="gem-visibility"
                  value={vis}
                  checked={visibility === vis}
                  onChange={() => setVisibility(vis)}
                  disabled={busy}
                />
                <span className="gem-visibility-copy">
                  <strong>{t(labelKey)}</strong>
                  <span>{t(descKey)}</span>
                </span>
              </label>
            ))}
          </div>

          {busy && (
            <div
              className="memory-gem-progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <div className="memory-gem-progress-track">
                <div
                  className="memory-gem-progress-fill"
                  style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
                />
              </div>
              <p className="memory-gem-progress-label">{progressLabel}</p>
            </div>
          )}

          {error && (
            <p className="memory-gem-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="memory-gem-composer-footer">
          <button
            type="button"
            className="mega-btn primary compact"
            disabled={busy || !type}
            onClick={() => void save()}
          >
            {busy ? progressLabel : 'Сохранить капсулу'}
          </button>
        </div>
      </div>

      {paywallOpen && (
        <div
          className="memory-gem-paywall"
          role="dialog"
          aria-modal="true"
          aria-label="Лимит бесплатных капсул"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="memory-gem-paywall__card">
            <span className="memory-gem-paywall__icon" aria-hidden>
              <Lock size={20} />
            </span>
            <h3 className="memory-gem-paywall__title">Premium</h3>
            <p className="memory-gem-paywall__text">
              Лимит бесплатных капсул ({FREE_MAP_GEM_LIMIT}/{FREE_MAP_GEM_LIMIT}) исчерпан.
              Оформите подписку для безлимитного хранения.
            </p>
            <button
              type="button"
              className="mega-btn primary compact"
              onClick={() => {
                setPaywallOpen(false);
                onClose();
              }}
            >
              Понятно
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
