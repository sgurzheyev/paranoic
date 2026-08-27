import type { MapboxLightPreset } from './lib/mapbox';

/** Palette stop on the Zip Lift spectrum (0–1). */
export type ThemePaletteStop = {
  id: string;
  t: number;
  /** Country / language code shown on the slider badge. */
  label: string;
  vars: Record<string, string>;
  shellBackground: string;
  mapPreset: MapboxLightPreset;
};

/** 10 flag-inspired dark neon gradients — order matches APP_LANGUAGES. */
export const THEME_SPECTRUM_STOPS: ThemePaletteStop[] = [
  {
    id: 'en',
    t: 0,
    label: 'EN',
    vars: {
      '--lux-bg': '#060b16',
      '--lux-bg-elevated': '#0e1830',
      '--lux-emerald': '#7dd3fc',
      '--lux-emerald-dim': 'rgba(125, 211, 252, 0.18)',
      '--lux-emerald-glow': 'rgba(96, 165, 250, 0.36)',
      '--lux-gold': '#f87171',
      '--lux-gold-dim': 'rgba(248, 113, 113, 0.18)',
      '--lux-indigo': '#1e3a5f',
      '--lux-purple': '#7f1d1d',
      '--glass-border': 'rgba(226, 232, 240, 0.16)',
    },
    shellBackground:
      'radial-gradient(820px 480px at 12% -10%, rgba(226, 232, 240, 0.14), transparent 55%), radial-gradient(700px 420px at 88% 8%, rgba(239, 68, 68, 0.16), transparent 50%), linear-gradient(165deg, #071022 0%, #132448 48%, #1a0c12 100%)',
    mapPreset: 'dusk',
  },
  {
    id: 'ru',
    t: 1 / 9,
    label: 'RU',
    vars: {
      '--lux-bg': '#070b14',
      '--lux-bg-elevated': '#121a2c',
      '--lux-emerald': '#93c5fd',
      '--lux-emerald-dim': 'rgba(147, 197, 253, 0.18)',
      '--lux-emerald-glow': 'rgba(59, 130, 246, 0.34)',
      '--lux-gold': '#f87171',
      '--lux-gold-dim': 'rgba(248, 113, 113, 0.18)',
      '--lux-indigo': '#1d4ed8',
      '--lux-purple': '#9f1239',
      '--glass-border': 'rgba(248, 250, 252, 0.16)',
    },
    shellBackground:
      'radial-gradient(780px 460px at 50% -12%, rgba(248, 250, 252, 0.16), transparent 52%), linear-gradient(180deg, #0c1220 0%, #1e3a8a 46%, #3f0d18 100%)',
    mapPreset: 'dusk',
  },
  {
    id: 'pl',
    t: 2 / 9,
    label: 'PL',
    vars: {
      '--lux-bg': '#0c070a',
      '--lux-bg-elevated': '#1a0c12',
      '--lux-emerald': '#fb7185',
      '--lux-emerald-dim': 'rgba(251, 113, 133, 0.18)',
      '--lux-emerald-glow': 'rgba(225, 29, 72, 0.36)',
      '--lux-gold': '#f8fafc',
      '--lux-gold-dim': 'rgba(248, 250, 252, 0.14)',
      '--lux-indigo': '#4c0519',
      '--lux-purple': '#9f1239',
      '--glass-border': 'rgba(254, 226, 226, 0.18)',
    },
    shellBackground:
      'radial-gradient(760px 440px at 50% -8%, rgba(248, 250, 252, 0.18), transparent 50%), linear-gradient(165deg, #14080c 0%, #3f0a18 55%, #1a050a 100%)',
    mapPreset: 'night',
  },
  {
    id: 'es',
    t: 3 / 9,
    label: 'ES',
    vars: {
      '--lux-bg': '#100808',
      '--lux-bg-elevated': '#1c0e0a',
      '--lux-emerald': '#fbbf24',
      '--lux-emerald-dim': 'rgba(251, 191, 36, 0.2)',
      '--lux-emerald-glow': 'rgba(245, 158, 11, 0.38)',
      '--lux-gold': '#ef4444',
      '--lux-gold-dim': 'rgba(239, 68, 68, 0.2)',
      '--lux-indigo': '#7f1d1d',
      '--lux-purple': '#92400e',
      '--glass-border': 'rgba(251, 191, 36, 0.2)',
    },
    shellBackground:
      'radial-gradient(720px 420px at 18% -6%, rgba(239, 68, 68, 0.22), transparent 52%), radial-gradient(640px 380px at 88% 12%, rgba(251, 191, 36, 0.18), transparent 48%), linear-gradient(165deg, #140606 0%, #4a1010 42%, #3a2a08 100%)',
    mapPreset: 'dusk',
  },
  {
    id: 'fr',
    t: 4 / 9,
    label: 'FR',
    vars: {
      '--lux-bg': '#070b16',
      '--lux-bg-elevated': '#10182c',
      '--lux-emerald': '#60a5fa',
      '--lux-emerald-dim': 'rgba(96, 165, 250, 0.18)',
      '--lux-emerald-glow': 'rgba(59, 130, 246, 0.34)',
      '--lux-gold': '#f87171',
      '--lux-gold-dim': 'rgba(248, 113, 113, 0.18)',
      '--lux-indigo': '#1e3a8a',
      '--lux-purple': '#9f1239',
      '--glass-border': 'rgba(226, 232, 240, 0.16)',
    },
    shellBackground:
      'radial-gradient(700px 400px at 8% 0%, rgba(37, 99, 235, 0.28), transparent 50%), radial-gradient(640px 380px at 92% 10%, rgba(239, 68, 68, 0.2), transparent 48%), linear-gradient(165deg, #081018 0%, #1e3a8a 40%, #2a0a12 100%)',
    mapPreset: 'dusk',
  },
  {
    id: 'de',
    t: 5 / 9,
    label: 'DE',
    vars: {
      '--lux-bg': '#050505',
      '--lux-bg-elevated': '#121212',
      '--lux-emerald': '#fbbf24',
      '--lux-emerald-dim': 'rgba(251, 191, 36, 0.18)',
      '--lux-emerald-glow': 'rgba(234, 179, 8, 0.36)',
      '--lux-gold': '#ef4444',
      '--lux-gold-dim': 'rgba(239, 68, 68, 0.2)',
      '--lux-indigo': '#292524',
      '--lux-purple': '#7f1d1d',
      '--glass-border': 'rgba(251, 191, 36, 0.18)',
    },
    shellBackground:
      'radial-gradient(680px 400px at 50% -10%, rgba(239, 68, 68, 0.18), transparent 52%), linear-gradient(180deg, #050505 0%, #1a0808 48%, #2a2208 100%)',
    mapPreset: 'night',
  },
  {
    id: 'zh',
    t: 6 / 9,
    label: 'CN',
    vars: {
      '--lux-bg': '#120608',
      '--lux-bg-elevated': '#1f0a0c',
      '--lux-emerald': '#facc15',
      '--lux-emerald-dim': 'rgba(250, 204, 21, 0.18)',
      '--lux-emerald-glow': 'rgba(234, 179, 8, 0.4)',
      '--lux-gold': '#dc2626',
      '--lux-gold-dim': 'rgba(220, 38, 38, 0.22)',
      '--lux-indigo': '#7f1d1d',
      '--lux-purple': '#854d0e',
      '--glass-border': 'rgba(250, 204, 21, 0.2)',
    },
    shellBackground:
      'radial-gradient(760px 440px at 20% -8%, rgba(220, 38, 38, 0.28), transparent 55%), radial-gradient(520px 320px at 85% 20%, rgba(250, 204, 21, 0.16), transparent 45%), linear-gradient(165deg, #180608 0%, #5a1010 50%, #2a1a06 100%)',
    mapPreset: 'dusk',
  },
  {
    id: 'pt',
    t: 7 / 9,
    label: 'PT',
    vars: {
      '--lux-bg': '#06120c',
      '--lux-bg-elevated': '#0c1f14',
      '--lux-emerald': '#34d399',
      '--lux-emerald-dim': 'rgba(52, 211, 153, 0.18)',
      '--lux-emerald-glow': 'rgba(16, 185, 129, 0.36)',
      '--lux-gold': '#facc15',
      '--lux-gold-dim': 'rgba(250, 204, 21, 0.18)',
      '--lux-indigo': '#0e7490',
      '--lux-purple': '#166534',
      '--glass-border': 'rgba(52, 211, 153, 0.2)',
    },
    shellBackground:
      'radial-gradient(720px 420px at 15% -6%, rgba(16, 185, 129, 0.22), transparent 52%), radial-gradient(600px 360px at 90% 14%, rgba(56, 189, 248, 0.14), transparent 48%), linear-gradient(165deg, #06140c 0%, #14532d 42%, #1e3a2f 100%)',
    mapPreset: 'night',
  },
  {
    id: 'ar',
    t: 8 / 9,
    label: 'AR',
    vars: {
      '--lux-bg': '#050a06',
      '--lux-bg-elevated': '#0c1610',
      '--lux-emerald': '#22c55e',
      '--lux-emerald-dim': 'rgba(34, 197, 94, 0.18)',
      '--lux-emerald-glow': 'rgba(22, 163, 74, 0.36)',
      '--lux-gold': '#eab308',
      '--lux-gold-dim': 'rgba(234, 179, 8, 0.2)',
      '--lux-indigo': '#14532d',
      '--lux-purple': '#365314',
      '--glass-border': 'rgba(234, 179, 8, 0.2)',
    },
    shellBackground:
      'radial-gradient(700px 400px at 30% -8%, rgba(22, 163, 74, 0.2), transparent 52%), radial-gradient(560px 340px at 88% 18%, rgba(234, 179, 8, 0.14), transparent 46%), linear-gradient(165deg, #030805 0%, #052e16 48%, #1a1505 100%)',
    mapPreset: 'night',
  },
  {
    id: 'ua',
    t: 1,
    label: 'UA',
    vars: {
      '--lux-bg': '#0a192f',
      '--lux-bg-elevated': '#1e3a8a',
      '--lux-emerald': '#fbbf24',
      '--lux-emerald-dim': 'rgba(251, 191, 36, 0.18)',
      '--lux-emerald-glow': 'rgba(245, 158, 11, 0.38)',
      '--lux-gold': '#f59e0b',
      '--lux-gold-dim': 'rgba(245, 158, 11, 0.2)',
      '--lux-indigo': '#1e3a8a',
      '--lux-purple': '#172554',
      '--glass-border': 'rgba(251, 191, 36, 0.22)',
    },
    shellBackground:
      'radial-gradient(780px 460px at 20% -10%, rgba(59, 130, 246, 0.22), transparent 55%), radial-gradient(640px 380px at 90% 8%, rgba(251, 191, 36, 0.16), transparent 48%), linear-gradient(165deg, #0a192f 0%, #1e3a8a 42%, #172554 100%)',
    mapPreset: 'dusk',
  },
];

export const THEME_STOP_COUNT = THEME_SPECTRUM_STOPS.length;

export const THEME_SPECTRUM_EVENT = 'paranoic-theme-spectrum';

export type ThemeSpectrumDetail = {
  t: number;
  mapPreset: MapboxLightPreset;
  stopId: string;
};

function parseColor(input: string): [number, number, number, number] | null {
  const hex = input.trim();
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
    hex
  );
  if (rgba) {
    return [
      Number(rgba[1]),
      Number(rgba[2]),
      Number(rgba[3]),
      rgba[4] == null ? 1 : Number(rgba[4]),
    ];
  }
  return null;
}

function formatColor(r: number, g: number, b: number, a: number): string {
  if (a >= 0.999) {
    const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(3)})`;
}

function lerpColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return t < 0.5 ? a : b;
  return formatColor(
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
    ca[3] + (cb[3] - ca[3]) * t
  );
}

function lerpVars(
  a: Record<string, string>,
  b: Record<string, string>,
  t: number
): Record<string, string> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Record<string, string> = {};
  for (const key of keys) {
    const va = a[key] ?? b[key] ?? '';
    const vb = b[key] ?? a[key] ?? '';
    out[key] = lerpColor(va, vb, t);
  }
  return out;
}

function findStops(t: number): { left: ThemePaletteStop; right: ThemePaletteStop; local: number } {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < THEME_SPECTRUM_STOPS.length - 1; i++) {
    const left = THEME_SPECTRUM_STOPS[i]!;
    const right = THEME_SPECTRUM_STOPS[i + 1]!;
    if (clamped >= left.t && clamped <= right.t) {
      const span = right.t - left.t || 1;
      return { left, right, local: (clamped - left.t) / span };
    }
  }
  const last = THEME_SPECTRUM_STOPS[THEME_SPECTRUM_STOPS.length - 1]!;
  return { left: last, right: last, local: 0 };
}

export function interpolateTheme(t: number): {
  vars: Record<string, string>;
  shellBackground: string;
  mapPreset: MapboxLightPreset;
  stopId: string;
} {
  const { left, right, local } = findStops(t);
  const vars = lerpVars(left.vars, right.vars, local);
  const shellBackground = local < 0.5 ? left.shellBackground : right.shellBackground;
  const mapPreset = local < 0.5 ? left.mapPreset : right.mapPreset;
  const stopId = local < 0.5 ? left.id : right.id;
  return { vars, shellBackground, mapPreset, stopId };
}

/** Index 0..9 for the nearest country-flag stop. */
export function themeStopIndex(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return Math.round(clamped * (THEME_STOP_COUNT - 1));
}

/** Settings value 0..100 for a discrete stop index. */
export function themeSpectrumFromStopIndex(index: number): number {
  const i = Math.max(0, Math.min(THEME_STOP_COUNT - 1, Math.round(index)));
  return Math.round((i / (THEME_STOP_COUNT - 1)) * 100);
}

/** Snap a 0–100 slider value onto one of the 10 flag stops. */
export function snapThemeSpectrum(value0to100: number): number {
  return themeSpectrumFromStopIndex(themeStopIndex(value0to100 / 100));
}

export function zipLiftTrackGradient(): string {
  const stops = THEME_SPECTRUM_STOPS.map((s) => {
    const a = s.vars['--lux-emerald'] ?? '#00f5d4';
    const b = s.vars['--lux-gold'] ?? a;
    const pct = Math.round(s.t * 100);
    return `${a} ${Math.max(0, pct - 2)}%, ${b} ${pct}%`;
  }).join(', ');
  return `linear-gradient(90deg, ${stops})`;
}

let lastAppliedT = -1;

export function applyThemeSpectrum(t: number, opts?: { silent?: boolean }): ThemeSpectrumDetail {
  if (typeof document === 'undefined') {
    return { t, mapPreset: 'night', stopId: 'en' };
  }

  const norm = Math.max(0, Math.min(1, t));
  const { vars, shellBackground, mapPreset, stopId } = interpolateTheme(norm);
  const root = document.documentElement;

  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }

  root.style.setProperty('--app-shell-bg', shellBackground);
  root.style.setProperty('--bg0', vars['--lux-bg'] ?? '#05070b');
  root.style.setProperty('--accent', vars['--lux-emerald'] ?? '#00f5d4');
  root.style.setProperty('--accent-dim', vars['--lux-emerald-dim'] ?? 'rgba(0,245,212,0.18)');
  root.style.setProperty('--call', vars['--lux-emerald'] ?? '#00f5d4');
  root.style.setProperty('--media', vars['--lux-gold'] ?? '#e2b714');
  root.style.setProperty('--premium', vars['--lux-gold'] ?? '#e2b714');

  root.classList.toggle('theme-ua', stopId === 'ua');
  root.dataset.themeStop = stopId;

  const detail: ThemeSpectrumDetail = { t: norm, mapPreset, stopId };

  if (!opts?.silent && Math.abs(norm - lastAppliedT) > 0.001) {
    lastAppliedT = norm;
    window.dispatchEvent(new CustomEvent(THEME_SPECTRUM_EVENT, { detail }));
  }

  return detail;
}

export function themeSpectrumFromSettings(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return snapThemeSpectrum(Math.max(0, Math.min(100, Math.round(value)))) / 100;
}

export function shellBackgroundAt(t: number): string {
  return interpolateTheme(t).shellBackground;
}

export function nearestStopLabel(t: number): string {
  const stop = THEME_SPECTRUM_STOPS[themeStopIndex(t)] ?? THEME_SPECTRUM_STOPS[0]!;
  return stop.label;
}

export function nearestStop(t: number): ThemePaletteStop {
  return THEME_SPECTRUM_STOPS[themeStopIndex(t)] ?? THEME_SPECTRUM_STOPS[0]!;
}

/** Map legacy shell CSS / old stop fingerprints onto the new 0–100 scale. */
export function migrateThemeSpectrumFromFon(themeFon: string | undefined): number {
  if (!themeFon) return 0;
  // UA (blue / gold)
  if (/1e3a8a|0a192f|fbbf24/i.test(themeFon)) return themeSpectrumFromStopIndex(9);
  // Old US-ish / EN navy-red
  if (/0a1628|1e3a5f|ef4444/i.test(themeFon)) return themeSpectrumFromStopIndex(0);
  // Old neon teal → PT green family
  if (/0a2838|00ffd0/i.test(themeFon)) return themeSpectrumFromStopIndex(7);
  // Old aurora purple → FR
  if (/2e1065|c084fc/i.test(themeFon)) return themeSpectrumFromStopIndex(4);
  // Dark default → EN
  if (/05070b|14161c|0a0b0e/i.test(themeFon)) return themeSpectrumFromStopIndex(0);
  return 0;
}
