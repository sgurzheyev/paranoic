import { Globe2, Shield } from 'lucide-react';

export type AppModeChoice = 'paranoic' | 'family';

type ModeSelectorProps = {
  onSelect: (mode: AppModeChoice) => void;
};

export default function ModeSelector({ onSelect }: ModeSelectorProps) {
  return (
    <div className="relative min-h-svh w-full overflow-hidden bg-[#07090f] text-slate-200">
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(94,234,212,0.14), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(96,165,250,0.1), transparent 50%), radial-gradient(ellipse 50% 30% at 0% 80%, rgba(52,211,153,0.08), transparent 45%)',
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-svh max-w-3xl flex-col justify-center gap-10 px-5 py-12 sm:px-8">
        <header className="text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.28em] text-teal-300/80">
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
            className="group flex min-h-[220px] flex-col items-start gap-4 rounded-3xl border border-teal-400/30 bg-teal-400/5 p-6 text-left transition duration-200 hover:-translate-y-1 hover:border-teal-300/60 hover:bg-teal-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-400/15 text-teal-300 transition group-hover:scale-105">
              <Shield size={30} strokeWidth={2.2} />
            </span>
            <div>
              <h2 className="m-0 text-2xl font-extrabold text-white">Paranoic Mode</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400 sm:text-base">
                Максимальная приватность. Ручной обмен ключами, без серверов.
              </p>
            </div>
            <span className="mt-auto text-sm font-bold text-teal-300/90">Открыть →</span>
          </button>

          <button
            type="button"
            onClick={() => onSelect('family')}
            className="group flex min-h-[220px] flex-col items-start gap-4 rounded-3xl border border-amber-300/30 bg-amber-300/5 p-6 text-left transition duration-200 hover:-translate-y-1 hover:border-amber-200/55 hover:bg-amber-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-300/15 text-amber-200 transition group-hover:scale-105">
              <Globe2 size={30} strokeWidth={2.2} />
            </span>
            <div>
              <h2 className="m-0 text-2xl font-extrabold text-white">Family Mode</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400 sm:text-base">
                В один клик. Поиск близких через визуальную сеть.
              </p>
            </div>
            <span className="mt-auto text-sm font-bold text-amber-200/90">Открыть →</span>
          </button>
        </div>
      </div>
    </div>
  );
}
