import { Download, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { signInWithEmailPassword, signUpWithEmailPassword } from './authCredentials';
import { useLanguage } from './i18n';
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
  const { t } = useLanguage();
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
            {mode === 'signup' ? t('auth.createAccount') : t('auth.signIn')}
          </h1>
          <p className="auth-screen__sub">{t('auth.subtitle')}</p>
        </header>

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

        <a href="/app-release.apk" download className="auth-screen__download">
          <span className="auth-screen__download-icon" aria-hidden>
            <Smartphone size={15} strokeWidth={2} />
            <Download size={13} strokeWidth={2.5} />
          </span>
          {t('auth.downloadAndroid')}
        </a>
      </div>
    </div>
  );
}
