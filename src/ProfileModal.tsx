import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, ImagePlus, Link2, LogOut, X } from 'lucide-react';
import Avatar from './Avatar';
import { useLanguage } from './i18n';
import ProfilePrivacyIcons from './ProfilePrivacyIcons';
import ZipLiftSlider from './ZipLiftSlider';
import {
  buildMagicLink,
  forcePersistSession,
  updateIdentity,
  validateUsername,
  type UserIdentity,
} from './identity';
import { assertUsernameAvailable, isUsernameAvailable, syncProfileToSupabase, uploadAvatar } from './profile';
import { saveSettings, type AppSettings } from './settings';
import { migrateThemeSpectrumFromFon, shellBackgroundAt } from './themeSpectrum';

type ProfileModalProps = {
  identity: UserIdentity;
  settings: AppSettings;
  onClose: () => void;
  onSaved: (next: UserIdentity) => void;
  onSettingsChange: (next: AppSettings) => void;
  onSignOut?: () => void | Promise<void>;
};

export default function ProfileModal({
  identity,
  settings,
  onClose,
  onSaved,
  onSettingsChange,
  onSignOut,
}: ProfileModalProps) {
  const { t } = useLanguage();
  const [name, setName] = useState(identity.name);
  const [username, setUsername] = useState(identity.username || '');
  const [avatarUrl, setAvatarUrl] = useState(identity.avatarUrl);
  const [themeSpectrum, setThemeSpectrum] = useState(
    settings.themeSpectrum ?? migrateThemeSpectrumFromFon(identity.themeFon)
  );
  const [ghostMode, setGhostMode] = useState(settings.ghostMode);
  const [ephemeral24h, setEphemeral24h] = useState(settings.ephemeral24h);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  const [usernameHint, setUsernameHint] = useState('');
  const [password, setPassword] = useState('');
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const themeSnapshot = useRef(themeSpectrum);

  const previewIdentity = useMemo(
    () => ({ ...identity, username: username.trim().toLowerCase() }),
    [identity, username]
  );
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
      setUsernameHint(t('profileModal.usernameHintNoNick'));
      return;
    }
    if (check.value === (identity.username || '')) {
      setUsernameHint(`${t('profile.magicLink')}: ${buildMagicLink({ ...identity, username: check.value })}`);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void isUsernameAvailable(check.value, identity.id).then((free) => {
        if (cancelled) return;
        setUsernameHint(
          free
            ? t('profileModal.usernameHintFree', { link: buildMagicLink(check.value) })
            : t('profileModal.usernameHintTaken')
        );
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [username, identity, t]);

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const url = await uploadAvatar(identity.id, file);
      setAvatarUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('profileModal.uploadFailed'));
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

  const onSpectrumChange = (next: number) => {
    setThemeSpectrum(next);
    const saved = saveSettings({ themeSpectrum: next });
    onSettingsChange(saved);
  };

  const handleDismiss = () => {
    if (themeSpectrum !== themeSnapshot.current) {
      const saved = saveSettings({ themeSpectrum: themeSnapshot.current });
      onSettingsChange(saved);
    }
    onClose();
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(t('profileModal.copyLinkFailed'));
    }
  };

  const copyUserId = async () => {
    try {
      await navigator.clipboard.writeText(identity.id);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 1800);
    } catch {
      setError(t('profileModal.copyIdFailed'));
    }
  };

  const handleSignOut = async () => {
    if (!onSignOut || signingOut) return;
    if (!window.confirm(t('profileModal.signOutConfirm'))) return;
    setSigningOut(true);
    setError('');
    try {
      await onSignOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('profileModal.signOutFailed'));
      setSigningOut(false);
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
          setError(t('profileModal.passwordShort'));
          return;
        }
        if (!userCheck.value) {
          setError(t('profileModal.passwordNeedsUsername'));
          return;
        }
      }
      const shellBg = shellBackgroundAt(themeSpectrum / 100);
      const next = updateIdentity({
        name: name.trim() || t('common.you'),
        username: userCheck.value,
        avatarUrl,
        themeFon: shellBg,
      });
      applyPrivacy({ ghostMode, ephemeral24h });
      saveSettings({ themeSpectrum });
      themeSnapshot.current = themeSpectrum;
      await syncProfileToSupabase(next, password.trim() ? { password: password.trim() } : undefined);
      const saved = password.trim() ? forcePersistSession(next) : next;
      if (password.trim()) setPassword('');
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('profileModal.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-modal-backdrop" role="presentation" onClick={handleDismiss}>
      <div
        className="profile-modal profile-modal--compact"
        role="dialog"
        aria-labelledby="profile-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="profile-modal-head">
          <h2 id="profile-modal-title">{t('profileModal.title')}</h2>
          <button type="button" className="icon-btn" onClick={handleDismiss} aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </div>

        <div className="profile-modal-top-row">
          <div className="profile-modal-avatar-block profile-modal-avatar-block--compact">
            <Avatar name={name || identity.name} color={identity.color} avatarUrl={avatarUrl} size="lg" />
            <button
              type="button"
              className="profile-photo-chip"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus size={14} />
              {uploading ? t('profileModal.uploading') : avatarUrl ? t('profileModal.changePhoto') : t('profileModal.uploadPhoto')}
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
          <ProfilePrivacyIcons
            ghostMode={ghostMode}
            ephemeral24h={ephemeral24h}
            onGhostMode={(next) => applyPrivacy({ ghostMode: next })}
            onEphemeral={(next) => applyPrivacy({ ephemeral24h: next })}
            ghostLabel={t('profileModal.ghostMode')}
            ephemeralLabel={t('profileModal.ephemeral')}
            disabled={busy || signingOut}
          />
        </div>

        <ZipLiftSlider
          value={themeSpectrum}
          onChange={onSpectrumChange}
          disabled={busy || signingOut}
        />

        <div className="profile-fields-grid">
          <label className="profile-field">
            <span>{t('profileModal.displayName')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder={t('profileModal.displayNamePlaceholder')}
            />
          </label>

          <label className="profile-field">
            <span>{t('profileModal.username')}</span>
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
              {usernameHint || t('profileModal.usernameHintDefault')}
            </p>
          </label>
        </div>

        <label className="profile-field profile-field--inline">
          <span>{t('profileModal.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('profileModal.passwordShort')}
            autoComplete="new-password"
          />
        </label>

        <div className="profile-share-row">
          <div className="profile-share-card profile-share-card--compact">
            <p className="profile-share-label">
              <Link2 size={14} /> {t('profileModal.magicLink')}
            </p>
            <p className="profile-share-url mono-box profile-share-url--truncate">{shareLink}</p>
            <button type="button" className="profile-icon-copy" onClick={() => void copyShareLink()} aria-label={t('profileModal.shareLink')}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
          <div className="profile-share-card profile-share-card--compact">
            <p className="profile-share-label">{t('profileModal.userId')}</p>
            <p className="profile-share-url mono-box profile-share-url--truncate">{identity.id}</p>
            <button type="button" className="profile-icon-copy" onClick={() => void copyUserId()} aria-label={t('profileModal.copyId')}>
              {copiedId ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        </div>

        {error && (
          <p className="profile-error" role="alert">
            {error}
          </p>
        )}

        <div className="profile-modal-actions">
          <button
            type="button"
            className="mega-btn primary compact"
            disabled={busy || uploading || signingOut}
            onClick={() => void save()}
          >
            {busy ? t('profileModal.saving') : t('profileModal.save')}
          </button>
          {onSignOut && (
            <button
              type="button"
              className="profile-logout-icon"
              disabled={signingOut || busy}
              onClick={() => void handleSignOut()}
              aria-label={signingOut ? t('profileModal.signingOut') : t('profileModal.signOut')}
              title={t('profileModal.signOut')}
            >
              <LogOut size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
