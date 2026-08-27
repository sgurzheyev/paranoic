import { Download, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  completePasswordReset,
  isValidAuthEmail,
  requestPasswordReset,
  signInWithEmailPassword,
  signUpWithEmailPassword,
} from './authCredentials';
import { useLanguage } from './i18n';
import ParanoicLogo from './ParanoicLogo';
import type { UserIdentity } from './identity';
import { isPasswordRecoveryPending } from './lib/supabase';

type AuthScreenProps = {
  onAuthenticated: (identity: UserIdentity) => void;
};

type AuthMode = 'signup' | 'login' | 'reset';

/**
 * Регистрация / вход: никнейм (только signup), email, пароль → GO PARANOIC.
 * Forgot password + сброс по ссылке из письма (PASSWORD_RECOVERY).
 */
export default function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const { t } = useLanguage();
  const emailRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<AuthMode>(() =>
    isPasswordRecoveryPending() ? 'reset' : 'signup'
  );
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resetNeedsEmail, setResetNeedsEmail] = useState(false);

  useEffect(() => {
    if (isPasswordRecoveryPending()) {
      setMode('reset');
    }
  }, []);

  const toggleMode = () => {
    setMode((m) => (m === 'login' ? 'signup' : 'login'));
    setError('');
    setSuccess('');
    setResetNeedsEmail(false);
  };

  const requestReset = async () => {
    setError('');
    setSuccess('');
    const trimmed = email.trim();
    if (!trimmed) {
      setResetNeedsEmail(true);
      emailRef.current?.focus();
      return;
    }
    setResetNeedsEmail(false);
    if (!isValidAuthEmail(trimmed)) {
      setError(t('auth.invalidEmail'));
      emailRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const result = await requestPasswordReset(trimmed);
      if (!result.ok) {
        setError(result.message || t('auth.resetPasswordFailed'));
        return;
      }
      setSuccess(t('auth.resetPasswordSent'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.resetPasswordFailed'));
    } finally {
      setBusy(false);
    }
  };

  const saveNewPassword = async () => {
    setError('');
    setSuccess('');
    if (password.trim() !== confirmPassword.trim()) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      const result = await completePasswordReset(password);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if ('identity' in result) {
        onAuthenticated(result.identity);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.resetPasswordFailed'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setError('');
    setSuccess('');
    setResetNeedsEmail(false);
    setBusy(true);
    try {
      const result =
        mode === 'login'
          ? await signInWithEmailPassword(email, password)
          : await signUpWithEmailPassword(email, password, nickname);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if ('pendingConfirmation' in result && result.pendingConfirmation) {
        setError(t('auth.confirmEmail'));
        setPassword('');
        return;
      }
      if ('identity' in result) {
        setPassword('');
        onAuthenticated(result.identity);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-screen__bg" aria-hidden />
      <div className="auth-screen__grid" aria-hidden />

      <div className="auth-screen__card">
        <header className="auth-screen__header">
          <ParanoicLogo size={40} compact withWordmark className="auth-screen__logo" />
          <h1 className="auth-screen__title">
            {mode === 'reset'
              ? t('auth.setNewPassword')
              : mode === 'signup'
                ? t('auth.createAccount')
                : t('auth.signIn')}
          </h1>
          <p className="auth-screen__sub">
            {mode === 'reset' ? t('auth.setNewPasswordHint') : t('auth.subtitle')}
          </p>
        </header>

        {mode === 'reset' ? (
          <>
            <label className="auth-screen__field">
              <span>{t('auth.password')}</span>
              <input
                type="password"
                className="auth-screen__password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveNewPassword();
                }}
              />
            </label>
            <label className="auth-screen__field">
              <span>{t('auth.confirmPassword')}</span>
              <input
                type="password"
                className="auth-screen__password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveNewPassword();
                }}
              />
            </label>
            {error && (
              <p className="auth-screen__error" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              className="auth-screen__btn auth-screen__btn--go"
              disabled={busy}
              onClick={() => void saveNewPassword()}
            >
              {busy ? '…' : t('auth.saveNewPassword')}
            </button>
          </>
        ) : (
          <>
            {mode === 'signup' && (
              <label className="auth-screen__field">
                <span>{t('auth.nickname')}</span>
                <input
                  type="text"
                  className="auth-screen__password auth-screen__username"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="paranoic_user"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submit();
                  }}
                />
              </label>
            )}

            <label className="auth-screen__field">
              <span>{t('auth.email')}</span>
              <input
                ref={emailRef}
                type="email"
                className="auth-screen__password"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (resetNeedsEmail && e.target.value.trim()) setResetNeedsEmail(false);
                  if (success) setSuccess('');
                }}
                placeholder="you@example.com"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="email"
                inputMode="email"
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
              />
            </label>

            <div className="auth-screen__password-block">
              <label className="auth-screen__field">
                <span>{t('auth.password')}</span>
                <input
                  type="password"
                  className="auth-screen__password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submit();
                  }}
                />
              </label>
              <button
                type="button"
                className="auth-screen__forgot"
                disabled={busy}
                onClick={() => void requestReset()}
              >
                {t('auth.forgotPassword')}
              </button>
            </div>

            {resetNeedsEmail && (
              <p className="auth-screen__reset-hint" role="status">
                {t('auth.enterEmailForReset')}
              </p>
            )}

            {success && (
              <p className="auth-screen__success" role="status">
                {success}
              </p>
            )}

            {error && (
              <p className="auth-screen__error" role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              className="auth-screen__btn auth-screen__btn--go"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? '…' : t('auth.go')}
            </button>

            <button type="button" className="auth-screen__toggle" disabled={busy} onClick={toggleMode}>
              {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}
            </button>
          </>
        )}

        <a
          href="https://pub-6c68eb1792d54c69819903a67b19a7a1.r2.dev/app-release.apk"
          download
          className="auth-screen__download"
        >          <span className="auth-screen__download-icon" aria-hidden>
            <Smartphone size={15} strokeWidth={2} />
            <Download size={13} strokeWidth={2.5} />
          </span>
          {t('auth.downloadAndroid')}
        </a>
      </div>
    </div>
  );
}
