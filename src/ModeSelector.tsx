import { useState, type MouseEvent } from 'react';
import { Globe2, Shield, X } from 'lucide-react';
import ParanoicLogo from './ParanoicLogo';

export type AppModeChoice = 'paranoic' | 'family';

type ModeSelectorProps = {
  onSelect: (mode: AppModeChoice) => void;
};

type ClientPlatform = 'android' | 'ios';

function resolveClientUrl(platform: ClientPlatform): string {
  const raw =
    platform === 'android'
      ? (import.meta.env.VITE_ANDROID_CLIENT_URL as string | undefined)
      : (import.meta.env.VITE_IOS_CLIENT_URL as string | undefined);
  const envUrl = raw?.trim();
  if (envUrl) return envUrl;
  return platform === 'android' ? '/download/android' : '/download/ios';
}

function hasStoreUrl(platform: ClientPlatform): boolean {
  const raw =
    platform === 'android'
      ? (import.meta.env.VITE_ANDROID_CLIENT_URL as string | undefined)
      : (import.meta.env.VITE_IOS_CLIENT_URL as string | undefined);
  return Boolean(raw?.trim());
}

/**
 * Стартовый экран: компактная сетка режимов + иконки нативных клиентов.
 */
export default function ModeSelector({ onSelect }: ModeSelectorProps) {
  const [downloadHint, setDownloadHint] = useState<ClientPlatform | null>(null);

  const onDownloadClick = (platform: ClientPlatform, e: MouseEvent<HTMLAnchorElement>) => {
    if (hasStoreUrl(platform)) return;
    e.preventDefault();
    setDownloadHint(platform);
  };

  return (
    <div className="relative min-h-svh w-full overflow-hidden text-slate-200">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(200,210,230,0.16), transparent 55%), radial-gradient(ellipse 55% 40% at 100% 100%, rgba(140,150,170,0.12), transparent 50%), radial-gradient(ellipse 45% 30% at 0% 80%, rgba(120,130,150,0.1), transparent 45%), linear-gradient(180deg, #16181f 0%, #0a0b0e 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent)',
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-5 px-5 py-10 sm:px-8">
        <header className="flex flex-col items-center text-center">
          <ParanoicLogo size={56} compact withWordmark className="mb-3" />
          <h1 className="m-0 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Как соединяемся?
          </h1>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onSelect('paranoic')}
            className="start-mode-card group"
          >
            <span className="start-mode-card__icon" aria-hidden>
              <Shield size={22} strokeWidth={2.2} />
            </span>
            <span className="start-mode-card__title">Paranoic Mode</span>
            <span className="start-mode-card__sub">Полная приватность</span>
          </button>

          <button
            type="button"
            onClick={() => onSelect('family')}
            className="start-mode-card group"
          >
            <span className="start-mode-card__icon" aria-hidden>
              <Globe2 size={22} strokeWidth={2.2} />
            </span>
            <span className="start-mode-card__title">Family Mode</span>
            <span className="start-mode-card__sub">Для семьи</span>
          </button>
        </div>

        <div className="start-os-row">
          <a
            href={resolveClientUrl('android')}
            className="start-os-btn start-os-btn--android"
            aria-label="Android client"
            onClick={(e) => onDownloadClick('android', e)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24A11.46 11.46 0 0 0 12 8.25c-1.53 0-2.98.3-4.29.84L5.83 5.67c-.18-.28-.54-.37-.83-.22-.3.16-.42.54-.26.85L6.58 9.48C3.7 11.14 1.74 14.07 1.5 17.5h21c-.24-3.43-2.2-6.36-5.08-8.02zM7.75 15a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm8.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
            </svg>
          </a>

          <a
            href={resolveClientUrl('ios')}
            className="start-os-btn start-os-btn--ios"
            aria-label="iOS client"
            onClick={(e) => onDownloadClick('ios', e)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M16.7 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.5.9-.7 0-1.9-.8-3.1-.8-1.6 0-3.1 1-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.1 1.7 2.4 3 2.3 1.2-.1 1.6-.7 3.1-.7s1.8.7 3.1.7c1.3 0 2.1-1.1 2.9-2.2.9-1.3 1.3-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8zm-2.3-6.7c.6-.8 1.1-1.9.9-3-.9.1-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 .1 2-.5 2.7-1.3z" />
            </svg>
          </a>
        </div>
      </div>

      {downloadHint && (
        <div
          className="start-download-modal-backdrop"
          role="presentation"
          onClick={() => setDownloadHint(null)}
        >
          <div
            className="start-download-modal"
            role="dialog"
            aria-labelledby="download-hint-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="start-download-modal__close"
              aria-label="Закрыть"
              onClick={() => setDownloadHint(null)}
            >
              <X size={18} />
            </button>
            <h2 id="download-hint-title">
              {downloadHint === 'android' ? 'Android Client' : 'iOS Client'}
            </h2>
            <p>
              Нативная сборка ещё не опубликована. Ссылка-заглушка:{' '}
              <code>{resolveClientUrl(downloadHint)}</code>
            </p>
            <p>
              Чтобы протестировать звонки прямо сейчас, откройте{' '}
              <strong>Paranoic Mode</strong> или <strong>Family Mode</strong> выше — веб-версия
              уже работает.
            </p>
            <div className="start-download-modal__actions">
              <button
                type="button"
                className="start-download-modal__primary"
                onClick={() => {
                  setDownloadHint(null);
                  onSelect('paranoic');
                }}
              >
                Открыть Paranoic Mode
              </button>
              <button
                type="button"
                className="start-download-modal__ghost"
                onClick={() => setDownloadHint(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
