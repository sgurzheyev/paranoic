import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Ghost, ImagePlus, Link2, Timer, X } from 'lucide-react';
import Avatar from './Avatar';
import {
  buildMagicLink,
  forcePersistSession,
  THEME_FON_PRESETS,
  updateIdentity,
  validateUsername,
  type UserIdentity,
} from './identity';
import { assertUsernameAvailable, isUsernameAvailable, syncProfileToSupabase, uploadAvatar } from './profile';
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
  const [username, setUsername] = useState(identity.username || '');
  const [avatarUrl, setAvatarUrl] = useState(identity.avatarUrl);
  const [themeFon, setThemeFon] = useState(identity.themeFon);
  const [ghostMode, setGhostMode] = useState(settings.ghostMode);
  const [ephemeral24h, setEphemeral24h] = useState(settings.ephemeral24h);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [usernameHint, setUsernameHint] = useState('');
  const [password, setPassword] = useState('');
  const [passwordHint, setPasswordHint] = useState('');
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewIdentity = useMemo(
    () => ({ ...identity, username: username.trim().toLowerCase() }),
    [identity, username]
  );
  // Короткая ссылка при заданном никнейме, иначе fallback на id.
  const shareLink = useMemo(() => {
    const u = previewIdentity.username;
    return u ? buildMagicLink(u) : buildMagicLink(identity.id);
  }, [previewIdentity.username, identity.id]);

  useEffect(() => {
    const check = validateUsername(username);
    if (!check.ok) {
      setUsernameHint(check.error);
      return;
    }
    if (!check.value) {
      setUsernameHint('Без никнейма ссылка будет с вашим ID.');
      return;
    }
    if (check.value === (identity.username || '')) {
      setUsernameHint(`Ссылка: ${buildMagicLink({ ...identity, username: check.value })}`);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void isUsernameAvailable(check.value, identity.id).then((free) => {
        if (cancelled) return;
        setUsernameHint(
          free
            ? `Свободен · ${buildMagicLink(check.value)}`
            : 'Имя занято'
        );
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [username, identity]);

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

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Не удалось скопировать ссылку');
    }
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const userCheck = validateUsername(username);
      if (!userCheck.ok) {
        setError(userCheck.error);
        return;
      }
      if (userCheck.value) {
        await assertUsernameAvailable(userCheck.value, identity.id);
      }
      if (password.trim()) {
        if (password.trim().length < 4) {
          setError('Пароль: минимум 4 символа');
          return;
        }
        if (!userCheck.value) {
          setError('Задайте никнейм перед установкой пароля');
          return;
        }
      }
      const next = updateIdentity({
        name: name.trim() || 'Я',
        username: userCheck.value,
        avatarUrl,
        themeFon,
      });
      applyPrivacy({ ghostMode, ephemeral24h });
      await syncProfileToSupabase(next, password.trim() ? { password: password.trim() } : undefined);
      const saved = password.trim() ? forcePersistSession(next) : next;
      if (password.trim()) setPassword('');
      onSaved(saved);
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

        <label className="profile-field">
          <span>Ваш никнейм (username)</span>
          <div className="username-input-row">
            <span className="username-at">@</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/\s+/g, ''))}
              maxLength={24}
              placeholder="gurgini"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="username-hint"
            />
          </div>
          <p id="username-hint" className="profile-field-hint">
            {usernameHint || 'Латиница, цифры и _. Короткая ссылка без длинного ID.'}
          </p>
        </label>

        <label className="profile-field">
          <span>Пароль (для входа на другом устройстве)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordHint(
                e.target.value.trim()
                  ? 'Сохраните профиль — пароль будет записан в облако.'
                  : 'Оставьте пустым, если не меняете пароль.'
              );
            }}
            placeholder="Минимум 4 символа"
            autoComplete="new-password"
          />
          <p className="profile-field-hint">{passwordHint || 'Нужен никнейм + пароль для восстановления аккаунта.'}</p>
        </label>

        <div className="profile-share-card">
          <p className="profile-share-label">
            <Link2 size={14} /> Ваша магическая ссылка
          </p>
          <p className="profile-share-url mono-box">{shareLink}</p>
          <button
            type="button"
            className="accept-file-btn"
            onClick={() => void copyShareLink()}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Скопировано' : 'Поделиться ссылкой'}
          </button>
        </div>

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
