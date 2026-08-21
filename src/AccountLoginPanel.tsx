import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import { hasSavedLoginSession, type UserIdentity } from './identity';
import { signInWithEmailPassword } from './authCredentials';

type AccountLoginPanelProps = {
  onRestored: (identity: UserIdentity) => void;
  onLobbyEnter?: () => void;
  compact?: boolean;
};

/** Вход по email + password (Supabase Auth). */
export default function AccountLoginPanel({
  onRestored,
  onLobbyEnter,
  compact = false,
}: AccountLoginPanelProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    onLobbyEnter?.();
  }, [onLobbyEnter]);

  if (hasSavedLoginSession()) {
    return null;
  }

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3500);
  };

  const handleLogin = async () => {
    setError('');
    setToast('');
    if (!email.trim()) {
      setError('Введите email');
      return;
    }
    if (!password.trim()) {
      setError('Введите пароль');
      return;
    }

    setBusy(true);
    try {
      const result = await signInWithEmailPassword(email, password);
      if (!result.ok) {
        if (result.reason === 'password_mismatch' || result.reason === 'email_not_confirmed') {
          showToast(result.message);
          return;
        }
        setError(result.message);
        return;
      }
      if ('pendingConfirmation' in result && result.pendingConfirmation) {
        setError(
          'На вашу почту отправлено письмо с подтверждением. Перейдите по ссылке или введите код.'
        );
        return;
      }
      if ('identity' in result) {
        setPassword('');
        onRestored(result.identity);
      }
    } catch (e) {
      console.error('[paranoic login] handleLogin exception', e);
      setError(e instanceof Error ? e.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {toast && (
        <div
          className="app-toast app-toast--error app-toast--top app-toast--visible account-login-toast"
          role="alert"
        >
          <span className="app-toast__text">{toast}</span>
        </div>
      )}
    <div className={`account-login-panel${compact ? ' account-login-panel--compact' : ''}`}>
      {!compact && (
        <p className="account-login-panel__title">
          <LogIn size={15} aria-hidden />
          Уже есть аккаунт?
        </p>
      )}
      <div className="account-login-panel__row">
        <input
          type="email"
          className="account-login-panel__password account-login-panel__email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="email"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleLogin();
          }}
        />
        <input
          type="password"
          className="account-login-panel__password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleLogin();
          }}
        />
        <button
          type="button"
          className="account-login-panel__submit"
          disabled={busy}
          onClick={() => void handleLogin()}
        >
          {busy ? '…' : 'Войти'}
        </button>
      </div>
      {error && (
        <p className="account-login-panel__error" role="alert">
          {error}
        </p>
      )}
    </div>
    </>
  );
}
