import { useState } from 'react';
import { KeyRound, LogIn, Mail, UserPlus } from 'lucide-react';
import {
  signInWithEmailPassword,
  signUpWithEmailPassword,
} from './authCredentials';
import ParanoicLogo from './ParanoicLogo';
import type { UserIdentity } from './identity';

type AuthScreenProps = {
  onAuthenticated: (identity: UserIdentity) => void;
};

const CONFIRM_MESSAGE =
  'На вашу почту отправлено письмо с подтверждением. Перейдите по ссылке или введите код.';

/**
 * Постоянный вход: реальный Email + пароль (Supabase Auth).
 * Username в profiles берётся из части email до @ после подтверждения.
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

  return (
    <div className="auth-screen">
      <div className="auth-screen__bg" aria-hidden />
      <div className="auth-screen__grid" aria-hidden />

      <div className="auth-screen__card">
        <header className="auth-screen__header">
          <ParanoicLogo size={52} compact withWordmark className="auth-screen__logo" />
          <h1 className="auth-screen__title">Вход в Paranoic</h1>
          <p className="auth-screen__sub">Email и пароль — постоянный аккаунт</p>
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
          Никнейм в профиле создаётся из email (часть до @) после подтверждения почты.
        </p>
      </div>
    </div>
  );
}
