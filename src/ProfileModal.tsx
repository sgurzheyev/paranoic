import { useRef, useState, type ReactNode } from 'react';
import { Check, Ghost, ImagePlus, Timer, X } from 'lucide-react';
import Avatar from './Avatar';
import {
  THEME_FON_PRESETS,
  updateIdentity,
  type UserIdentity,
} from './identity';
import { syncProfileToSupabase, uploadAvatar } from './profile';
import { saveSettings, type AppSettings } from './settings';

type ProfileModalProps = {
  identity: UserIdentity;
  settings: AppSettings;
  onClose: () => void;
  onSaved: (next: UserIdentity) => void;
  onSettingsChange: (next: AppSettings) => void;
};

function IosToggle({
  checked,
  onChange,
  label,
  description,
  icon,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div className="ios-toggle-row">
      <div className="ios-toggle-copy">
        <div className="ios-toggle-label">
          {icon}
          <span>{label}</span>
        </div>
        <p>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`ios-switch ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="ios-switch-knob" />
      </button>
    </div>
  );
}

export default function ProfileModal({
  identity,
  settings,
  onClose,
  onSaved,
  onSettingsChange,
}: ProfileModalProps) {
  const [name, setName] = useState(identity.name);
  const [avatarUrl, setAvatarUrl] = useState(identity.avatarUrl);
  const [themeFon, setThemeFon] = useState(identity.themeFon);
  const [ghostMode, setGhostMode] = useState(settings.ghostMode);
  const [ephemeral24h, setEphemeral24h] = useState(settings.ephemeral24h);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const url = await uploadAvatar(identity.id, file);
      setAvatarUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить аватар');
    } finally {
      setUploading(false);
    }
  };

  const applyPrivacy = (patch: Partial<AppSettings>) => {
    const nextGhost = patch.ghostMode ?? ghostMode;
    const nextEph = patch.ephemeral24h ?? ephemeral24h;
    if (patch.ghostMode != null) setGhostMode(patch.ghostMode);
    if (patch.ephemeral24h != null) setEphemeral24h(patch.ephemeral24h);
    const saved = saveSettings({ ghostMode: nextGhost, ephemeral24h: nextEph });
    onSettingsChange(saved);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const next = updateIdentity({
        name: name.trim() || 'Я',
        avatarUrl,
        themeFon,
      });
      applyPrivacy({ ghostMode, ephemeral24h });
      await syncProfileToSupabase(next);
      onSaved(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="profile-modal"
        role="dialog"
        aria-labelledby="profile-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="profile-modal-head">
          <h2 id="profile-modal-title">Профиль</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="profile-modal-avatar-block">
          <Avatar name={name || identity.name} color={identity.color} avatarUrl={avatarUrl} size="lg" />
          <button
            type="button"
            className="accept-file-btn"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus size={16} />
            {uploading ? 'Загрузка…' : avatarUrl ? 'Сменить фото' : 'Загрузить фото'}
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

        <label className="profile-field">
          <span>Отображаемое имя</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            placeholder="Ваше имя"
          />
        </label>

        <div className="profile-field">
          <span>Фон интерфейса</span>
          <div className="theme-fon-grid">
            {THEME_FON_PRESETS.map((preset) => {
              const active = themeFon === preset.value;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`theme-fon-swatch ${active ? 'active' : ''}`}
                  style={{ background: preset.value }}
                  onClick={() => setThemeFon(preset.value)}
                  aria-label={preset.label}
                  title={preset.label}
                >
                  {active && <Check size={16} />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="profile-privacy-card">
          <p className="profile-privacy-title">Приватность</p>
          <IosToggle
            checked={ghostMode}
            onChange={(next) => applyPrivacy({ ghostMode: next })}
            label="Ghost Mode"
            description="Режим невидимки: на карте вы в условной Антарктиде, GPS выключен."
            icon={<Ghost size={16} />}
          />
          <IosToggle
            checked={ephemeral24h}
            onChange={(next) => applyPrivacy({ ephemeral24h: next })}
            label="Удалять через 24 часа"
            description="Старые сообщения автоматически стираются из локального хранилища чата."
            icon={<Timer size={16} />}
          />
        </div>

        {error && (
          <p className="profile-error" role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          className="mega-btn primary compact"
          disabled={busy || uploading}
          onClick={() => void save()}
        >
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
