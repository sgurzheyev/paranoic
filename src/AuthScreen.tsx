import { useState } from 'react';
import { KeyRound, LogIn, Mail, UserPlus } from 'lucide-react';
import {
  signInWithEmailPassword,
  signInWithGoogleOAuth,
  signUpWithEmailPassword,
} from './authCredentials';
import ParanoicLogo from './ParanoicLogo';
import type { UserIdentity } from './identity';

type AuthScreenProps = {
  onAuthenticated: (identity: UserIdentity) => void;
};

const CONFIRM_MESSAGE =
  'На вашу почту отправлено письмо с подтверждением. Перейдите по ссылке или введите код.';

function GoogleGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.6h5.1c-.2 1.2-.9 2.3-1.9 3l3.1 2.4c1.8-1.7 2.9-4.1 2.9-7 0-.7-.1-1.3-.2-1.9H12z"
      />
      <path
        fill="#34A853"
        d="M6.6 14.3l-.9.7-2.5 1.9C5 19.5 8.2 21.5 12 21.5c2.4 0 4.4-.8 5.9-2.1l-3.1-2.4c-.8.6-1.9.9-2.8.9-2.2 0-4-1.5-4.7-3.5z"
      />
      <path
        fill="#4A90E2"
        d="M3.2 7.1C2.4 8.6 2 10.2 2 12s.4 3.4 1.2 4.9c0 .1 3.4-2.6 3.4-2.6-.2-.6-.3-1.2-.3-1.8s.1-1.3.3-1.9L3.2 7.1z"
      />
      <path
        fill="#FBBC05"
        d="M12 5.1c1.3 0 2.5.5 3.5 1.3l2.6-2.6C16.4 2.3 14.4 1.5 12 1.5 8.2 1.5 5 3.5 3.2 7.1l3.4 2.6C7.9 6.6 9.8 5.1 12 5.1z"
      />
    </svg>
  );
}

/**
 * Постоянный вход: Email + пароль или Google OAuth.
 * Username в profiles — из email; имя — full_name (Google) или email.
 */
export default function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState('');

  const run = async (mode: 'login' | 'signup') => {
    setError('');
    setPendingConfirmEmail('');
    setBusy(true);
    try {
      const result =
        mode === 'login'
          ? await signInWithEmailPassword(email, password)
          : await signUpWithEmailPassword(email, password);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if ('pendingConfirmation' in result && result.pendingConfirmation) {
        setPassword('');
        setPendingConfirmEmail(result.email);
        return;
      }
      if ('identity' in result) {
        setPassword('');
        onAuthenticated(result.identity);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выполнить вход');
    } finally {
      setBusy(false);
    }
  };

  const runGoogle = async () => {
    setError('');
    setBusy(true);
    try {
      const result = await signInWithGoogleOAuth();
      if (!result.ok) {
        setError(result.message);
        setBusy(false);
        return;
      }
      // Редирект на Google — страница уйдёт сама.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось войти через Google');
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-screen__bg" aria-hidden />
      <div className="auth-screen__grid" aria-hidden />

      <div className="auth-screen__card">
        <header className="auth-screen__header">
          <ParanoicLogo size={52} compact withWordmark className="auth-screen__logo" />
          <h1 className="auth-screen__title">Вход в Paranoic</h1>
          <p className="auth-screen__sub">Email, пароль или Google</p>
        </header>

        {pendingConfirmEmail ? (
          <div className="auth-screen__confirm" role="status">
            <Mail size={22} aria-hidden />
            <p className="auth-screen__confirm-title">Проверьте почту</p>
            <p className="auth-screen__confirm-text">{CONFIRM_MESSAGE}</p>
            <p className="auth-screen__confirm-email">{pendingConfirmEmail}</p>
            <button
              type="button"
              className="auth-screen__btn auth-screen__btn--primary"
              disabled={busy}
              onClick={() => void run('login')}
            >
              <LogIn size={18} aria-hidden />
              Я подтвердил — войти
            </button>
            <button
              type="button"
              className="auth-screen__btn auth-screen__btn--secondary"
              disabled={busy}
              onClick={() => setPendingConfirmEmail('')}
            >
              Изменить email
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="auth-screen__btn auth-screen__btn--google"
              disabled={busy}
              onClick={() => void runGoogle()}
            >
              <GoogleGlyph />
              {busy ? '…' : 'Войти через Google'}
            </button>

            <div className="auth-screen__divider" role="separator">
              <span>или email</span>
            </div>

            <label className="auth-screen__field">
              <span>Email</span>
              <input
                type="email"
                className="auth-screen__password"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="email"
                inputMode="email"
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void run('login');
                }}
              />
            </label>

            <label className="auth-screen__field">
              <span>Пароль</span>
              <input
                type="password"
                className="auth-screen__password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void run('login');
                }}
              />
            </label>

            {error && (
              <p className="auth-screen__error" role="alert">
                {error}
              </p>
            )}

            <div className="auth-screen__actions">
              <button
                type="button"
                className="auth-screen__btn auth-screen__btn--primary"
                disabled={busy}
                onClick={() => void run('login')}
              >
                <LogIn size={18} aria-hidden />
                {busy ? '…' : 'Войти'}
              </button>
              <button
                type="button"
                className="auth-screen__btn auth-screen__btn--secondary"
                disabled={busy}
                onClick={() => void run('signup')}
              >
                <UserPlus size={18} aria-hidden />
                Создать аккаунт
              </button>
            </div>
          </>
        )}

        {pendingConfirmEmail && error && (
          <p className="auth-screen__error" role="alert">
            {error}
          </p>
        )}

        <p className="auth-screen__hint">
          <KeyRound size={14} aria-hidden />
          Никнейм — из email; имя профиля — из Google (full_name) или email.
        </p>
      </div>
    </div>
  );
}
