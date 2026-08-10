import { useState, type MouseEvent } from 'react';
import { Download, Globe2, Shield, X } from 'lucide-react';
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
 * Стартовый экран: режимы Paranoic / Family + блок скачивания нативных клиентов.
 */
export default function ModeSelector({ onSelect }: ModeSelectorProps) {
  const [downloadHint, setDownloadHint] = useState<ClientPlatform | null>(null);

  const onDownloadClick = (platform: ClientPlatform, e: MouseEvent<HTMLAnchorElement>) => {
    // Реальная ссылка из env — обычный переход.
    if (hasStoreUrl(platform)) return;
    // Заглушка /download/* — показываем инструкцию, не уводим в 404 веб-клиента.
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

      <div className="relative z-10 mx-auto flex min-h-svh max-w-3xl flex-col justify-center gap-8 px-5 py-12 sm:px-8">
        <header className="flex flex-col items-center text-center">
          <ParanoicLogo size={88} withWordmark className="mb-5" />
          <h1 className="m-0 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Как соединяемся?
          </h1>
          <p className="mx-auto mt-3 max-w-md text-base text-slate-400 sm:text-lg">
            Выберите простой режим для семьи или максимальный контроль своими руками.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
          <button
            type="button"
            onClick={() => onSelect('paranoic')}
            className="group flex min-h-[220px] flex-col items-start gap-4 rounded-3xl border border-white/15 bg-white/[0.06] p-6 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-[20px] transition duration-200 hover:-translate-y-1 hover:border-white/30 hover:bg-white/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition group-hover:scale-105">
              <Shield size={30} strokeWidth={2.2} />
            </span>
            <div>
              <h2 className="m-0 text-2xl font-extrabold text-white">Paranoic Mode</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400 sm:text-base">
                Максимальная приватность. Ручной обмен ключами, без серверов.
              </p>
            </div>
            <span className="mt-auto text-sm font-bold text-slate-300">Открыть →</span>
          </button>

          <button
            type="button"
            onClick={() => onSelect('family')}
            className="group flex min-h-[220px] flex-col items-start gap-4 rounded-3xl border border-white/15 bg-white/[0.06] p-6 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-[20px] transition duration-200 hover:-translate-y-1 hover:border-white/30 hover:bg-white/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition group-hover:scale-105">
              <Globe2 size={30} strokeWidth={2.2} />
            </span>
            <div>
              <h2 className="m-0 text-2xl font-extrabold text-white">Family Mode</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400 sm:text-base">
                Карта мира изнутри планеты: контакты, кто в сети, звонок в один тап.
              </p>
            </div>
            <span className="mt-auto text-sm font-bold text-slate-300">Открыть →</span>
          </button>
        </div>

        <div className="start-download-panel">
          <p className="start-download-panel__label">
            <Download size={14} aria-hidden />
            Для тестировщиков · нативные клиенты
          </p>
          <div className="start-download-panel__row">
            <a
              href={resolveClientUrl('android')}
              className="start-client-btn start-client-btn--android start-client-btn--compact group"
              onClick={(e) => onDownloadClick('android', e)}
            >
              <span className="start-client-btn__icon" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24A11.46 11.46 0 0 0 12 8.25c-1.53 0-2.98.3-4.29.84L5.83 5.67c-.18-.28-.54-.37-.83-.22-.3.16-.42.54-.26.85L6.58 9.48C3.7 11.14 1.74 14.07 1.5 17.5h21c-.24-3.43-2.2-6.36-5.08-8.02zM7.75 15a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm8.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
                </svg>
              </span>
              <span className="start-client-btn__copy">
                <span className="start-client-btn__title">Скачать для Android</span>
              </span>
            </a>

            <a
              href={resolveClientUrl('ios')}
              className="start-client-btn start-client-btn--ios start-client-btn--compact group"
              onClick={(e) => onDownloadClick('ios', e)}
            >
              <span className="start-client-btn__icon" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16.7 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.5.9-.7 0-1.9-.8-3.1-.8-1.6 0-3.1 1-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.1 1.7 2.4 3 2.3 1.2-.1 1.6-.7 3.1-.7s1.8.7 3.1.7c1.3 0 2.1-1.1 2.9-2.2.9-1.3 1.3-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8zm-2.3-6.7c.6-.8 1.1-1.9.9-3-.9.1-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 .1 2-.5 2.7-1.3z" />
                </svg>
              </span>
              <span className="start-client-btn__copy">
                <span className="start-client-btn__title">Скачать для iOS</span>
              </span>
            </a>
          </div>
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
