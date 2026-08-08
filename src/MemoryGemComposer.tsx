import { useRef, useState } from 'react';
import { Gem, ImagePlus, Type, Video, X } from 'lucide-react';
import {
  createMapGem,
  uploadGemMedia,
  type MapGem,
  type MapGemType,
} from './mapGems';

type MemoryGemComposerProps = {
  authorId: string;
  lat: number;
  lng: number;
  onClose: () => void;
  onCreated: (gem: MapGem) => void;
};

/** Быстрое создание капсулы в текущей GPS-точке. */
export default function MemoryGemComposer({
  authorId,
  lat,
  lng,
  onClose,
  onCreated,
}: MemoryGemComposerProps) {
  const [type, setType] = useState<MapGemType>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      let mediaUrl: string | null = null;
      if ((type === 'photo' || type === 'video') && file) {
        mediaUrl = await uploadGemMedia(authorId, file);
      } else if (type === 'photo' || type === 'video') {
        throw new Error(type === 'photo' ? 'Выберите фото' : 'Выберите видео');
      }
      if (type === 'text' && !text.trim()) {
        throw new Error('Введите текст капсулы');
      }
      const gem = await createMapGem({
        authorId,
        lat,
        lng,
        type,
        mediaUrl,
        content: text.trim() || null,
      });
      onCreated(gem);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="memory-gem-backdrop" role="presentation" onClick={onClose}>
      <div
        className="memory-gem-card composer"
        role="dialog"
        aria-label="Новая капсула памяти"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="memory-gem-head">
          <div className="memory-gem-title-row">
            <span className="memory-gem-icon" aria-hidden>
              <Gem size={16} />
            </span>
            <div>
              <p className="memory-gem-eyebrow">Новая капсула</p>
              <p className="memory-gem-meta">
                {lat.toFixed(4)}, {lng.toFixed(4)}
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div className="memory-gem-type-row">
          {(
            [
              { id: 'text', label: 'Текст', icon: <Type size={15} /> },
              { id: 'photo', label: 'Фото', icon: <ImagePlus size={15} /> },
              { id: 'video', label: 'Видео', icon: <Video size={15} /> },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`memory-gem-type-btn${type === opt.id ? ' active' : ''}`}
              onClick={() => {
                setType(opt.id);
                setFile(null);
              }}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>

        {type === 'text' ? (
          <textarea
            className="memory-gem-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Что хотите оставить в этом месте?"
            maxLength={500}
            rows={4}
          />
        ) : (
          <div className="memory-gem-file-block">
            <button
              type="button"
              className="accept-file-btn"
              onClick={() => fileRef.current?.click()}
            >
              {type === 'photo' ? <ImagePlus size={16} /> : <Video size={16} />}
              {file ? file.name : type === 'photo' ? 'Выбрать фото' : 'Выбрать видео'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={type === 'photo' ? 'image/*' : 'video/*'}
              hidden
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            <textarea
              className="memory-gem-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Подпись (необязательно)"
              maxLength={280}
              rows={2}
            />
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
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? 'Сохраняем…' : 'Оставить капсулу'}
        </button>
      </div>
    </div>
  );
}
