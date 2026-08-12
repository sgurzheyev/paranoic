import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import { hasSavedLoginSession, normalizeUsername, type UserIdentity } from './identity';
import { loginWithUsernamePassword } from './profile';

type AccountLoginPanelProps = {
  onRestored: (identity: UserIdentity) => void;
  onLobbyEnter?: () => void;
  compact?: boolean;
};

/** Вход по username + password — восстановление user_id и профиля из Supabase. */
export default function AccountLoginPanel({
  onRestored,
  onLobbyEnter,
  compact = false,
}: AccountLoginPanelProps) {
  const [username, setUsername] = useState('');
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
    const handle = normalizeUsername(username);
    if (!handle) {
      setError('Введите никнейм');
      return;
    }
    if (!password.trim()) {
      setError('Введите пароль');
      return;
    }

    setBusy(true);
    try {
      const result = await loginWithUsernamePassword(handle, password);
      if (!result.ok) {
        if (result.reason === 'password_mismatch') {
          showToast('Неверный пароль');
          return;
        }
        setError(result.message);
        return;
      }
      setPassword('');
      onRestored(result.identity);
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
        <div className="username-input-row account-login-panel__username">
          <span className="username-at">@</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s+/g, ''))}
            placeholder="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleLogin();
            }}
          />
        </div>
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
