import { useState } from 'react';
import { signInWithEmailPassword, signUpWithEmailPassword } from './authCredentials';
import ParanoicLogo from './ParanoicLogo';
import type { UserIdentity } from './identity';

type AuthScreenProps = {
  onAuthenticated: (identity: UserIdentity) => void;
};

type AuthMode = 'signup' | 'login';

/**
 * Регистрация / вход: никнейм (только signup), email, пароль → GO PARANOIC.
 */
export default function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('signup');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggleMode = () => {
    setMode((m) => (m === 'login' ? 'signup' : 'login'));
    setError('');
  };

  const submit = async () => {
    setError('');
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
        setError('Подтвердите email по ссылке из письма, затем войдите.');
        setPassword('');
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
          <ParanoicLogo size={40} compact withWordmark className="auth-screen__logo" />
          <h1 className="auth-screen__title">
            {mode === 'signup' ? 'Создать аккаунт' : 'Войти'}
          </h1>
          <p className="auth-screen__sub">Paranoic — анонимный мессенджер</p>
        </header>

        {mode === 'signup' && (
          <label className="auth-screen__field">
            <span>Уникальный никнейм</span>
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
              if (e.key === 'Enter') void submit();
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
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
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
          onClick={() => void submit()}
        >
          {busy ? '…' : 'GO PARANOIC'}
        </button>

        <button type="button" className="auth-screen__toggle" disabled={busy} onClick={toggleMode}>
          {mode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}
        </button>
      </div>
    </div>
  );
}
