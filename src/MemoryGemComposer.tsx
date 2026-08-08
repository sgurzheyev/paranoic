import { useEffect, useRef, useState } from 'react';
import { Gem, ImagePlus, Type, Video, X } from 'lucide-react';
import {
  createMapGem,
  uploadGemMedia,
  type MapGem,
  type MapGemType,
} from './mapGems';
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
  const fileRef = useRef<HTMLInputElement>(null);

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
    try {
      let mediaUrl: string | null = null;
      if (type === 'photo' || type === 'video') {
        if (!file) throw new Error(type === 'photo' ? 'Выберите фото' : 'Выберите видео');
        setPhase('upload');
        mediaUrl = await uploadGemMedia(file, (ratio) => setProgress(ratio));
      }
      if (type === 'text' && !text.trim()) {
        throw new Error('Введите текст капсулы');
      }
      setPhase('save');
      setProgress(1);
      const gem = await createMapGem({
        lat,
        lng,
        type,
        mediaUrl,
        content: text.trim() || null,
      });
      playSuccessSound();
      onCreated(gem);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
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

  return (
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
            className="icon-btn"
            onClick={onClose}
            aria-label="Закрыть"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>

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

        {busy && (
          <div className="memory-gem-progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
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
  );
}
