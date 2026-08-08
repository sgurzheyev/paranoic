import { Globe2, Shield } from 'lucide-react';

export type AppModeChoice = 'paranoic' | 'family';

type ModeSelectorProps = {
  onSelect: (mode: AppModeChoice) => void;
};

export default function ModeSelector({ onSelect }: ModeSelectorProps) {
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

      <div className="relative z-10 mx-auto flex min-h-svh max-w-3xl flex-col justify-center gap-10 px-5 py-12 sm:px-8">
        <header className="text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.32em] text-slate-400">
            Paranoic
          </p>
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
      </div>
    </div>
  );
}
