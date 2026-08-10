import { Smartphone } from 'lucide-react';
import ParanoicLogo from './ParanoicLogo';

export type AppModeChoice = 'paranoic' | 'family';

type ModeSelectorProps = {
  onSelect: (mode: AppModeChoice) => void;
};

function resolveClientUrl(platform: 'android' | 'ios'): string | null {
  const raw =
    platform === 'android'
      ? (import.meta.env.VITE_ANDROID_CLIENT_URL as string | undefined)
      : (import.meta.env.VITE_IOS_CLIENT_URL as string | undefined);
  const url = raw?.trim();
  return url || null;
}

/**
 * Стартовый экран: Liquid Glass логотип + две кнопки клиентов (Android / iOS).
 * Если URL сборки не задан в env — открываем веб-клиент для тестов звонков.
 */
export default function ModeSelector({ onSelect }: ModeSelectorProps) {
  const openClient = (platform: 'android' | 'ios') => {
    const external = resolveClientUrl(platform);
    if (external) {
      window.location.assign(external);
      return;
    }
    // Fallback для тестировщиков: сразу в приложение, чтобы позвонить.
    const url = new URL(window.location.href);
    url.searchParams.set('platform', platform);
    url.searchParams.set('start', 'paranoic');
    window.history.replaceState({}, '', url);
    onSelect('paranoic');
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

      <div className="relative z-10 mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-10 px-5 py-12 sm:px-8">
        <header className="flex flex-col items-center text-center">
          <ParanoicLogo size={96} withWordmark className="mb-6" />
          <h1 className="m-0 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Как соединяемся?
          </h1>
          <p className="mx-auto mt-3 max-w-md text-base text-slate-400 sm:text-lg">
            Скачайте клиент под вашу ОС — или откройте веб-версию, чтобы сразу протестировать
            звонок.
          </p>
        </header>

        <div className="flex flex-col gap-3.5">
          <button
            type="button"
            onClick={() => openClient('android')}
            className="start-client-btn start-client-btn--android group"
          >
            <span className="start-client-btn__icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24A11.46 11.46 0 0 0 12 8.25c-1.53 0-2.98.3-4.29.84L5.83 5.67c-.18-.28-.54-.37-.83-.22-.3.16-.42.54-.26.85L6.58 9.48C3.7 11.14 1.74 14.07 1.5 17.5h21c-.24-3.43-2.2-6.36-5.08-8.02zM7.75 15a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm8.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
              </svg>
            </span>
            <span className="start-client-btn__copy">
              <span className="start-client-btn__title">Скачать для Android</span>
              <span className="start-client-btn__sub">Android Client · тест звонков</span>
            </span>
            <Smartphone size={18} className="start-client-btn__chev" aria-hidden />
          </button>

          <button
            type="button"
            onClick={() => openClient('ios')}
            className="start-client-btn start-client-btn--ios group"
          >
            <span className="start-client-btn__icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16.7 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.5.9-.7 0-1.9-.8-3.1-.8-1.6 0-3.1 1-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.1 1.7 2.4 3 2.3 1.2-.1 1.6-.7 3.1-.7s1.8.7 3.1.7c1.3 0 2.1-1.1 2.9-2.2.9-1.3 1.3-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8zm-2.3-6.7c.6-.8 1.1-1.9.9-3-.9.1-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 .1 2-.5 2.7-1.3z" />
              </svg>
            </span>
            <span className="start-client-btn__copy">
              <span className="start-client-btn__title">Скачать для iOS</span>
              <span className="start-client-btn__sub">iOS Client · тест звонков</span>
            </span>
            <Smartphone size={18} className="start-client-btn__chev" aria-hidden />
          </button>
        </div>

        <p className="text-center text-xs leading-relaxed text-slate-500">
          Нажмите кнопку — откроется клиент для вашей ОС. Если сборка ещё не
          подключена, сразу откроется веб-версия для теста звонка.
        </p>
      </div>
    </div>
  );
}
