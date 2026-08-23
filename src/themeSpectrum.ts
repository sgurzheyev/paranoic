import type { MapboxLightPreset } from './lib/mapbox';

/** Palette stop on the Zip Lift spectrum (0–1). */
export type ThemePaletteStop = {
  id: string;
  t: number;
  label: string;
  vars: Record<string, string>;
  shellBackground: string;
  mapPreset: MapboxLightPreset;
};

export const THEME_SPECTRUM_STOPS: ThemePaletteStop[] = [
  {
    id: 'dark',
    t: 0,
    label: 'Dark',
    vars: {
      '--lux-bg': '#05070b',
      '--lux-bg-elevated': '#0a0d14',
      '--lux-emerald': '#00f5d4',
      '--lux-emerald-dim': 'rgba(0, 245, 212, 0.18)',
      '--lux-emerald-glow': 'rgba(0, 245, 212, 0.34)',
      '--lux-gold': '#e2b714',
      '--lux-gold-dim': 'rgba(226, 183, 20, 0.18)',
      '--lux-indigo': '#3b2f6e',
      '--lux-purple': '#5b21b6',
      '--glass-border': 'rgba(255, 255, 255, 0.1)',
    },
    shellBackground:
      'radial-gradient(900px 520px at 18% -8%, rgba(180, 190, 210, 0.14), transparent 55%), linear-gradient(180deg, #14161c 0%, #0a0b0e 100%)',
    mapPreset: 'night',
  },
  {
    id: 'neon',
    t: 0.28,
    label: 'Neon',
    vars: {
      '--lux-bg': '#040810',
      '--lux-bg-elevated': '#0a1420',
      '--lux-emerald': '#00ffd0',
      '--lux-emerald-dim': 'rgba(0, 255, 208, 0.22)',
      '--lux-emerald-glow': 'rgba(0, 255, 208, 0.45)',
      '--lux-gold': '#7cffcb',
      '--lux-gold-dim': 'rgba(124, 255, 203, 0.16)',
      '--lux-indigo': '#1a3a4a',
      '--lux-purple': '#0d9488',
      '--glass-border': 'rgba(0, 255, 208, 0.2)',
    },
    shellBackground: 'linear-gradient(165deg, #041018 0%, #0a2838 45%, #061018 100%)',
    mapPreset: 'night',
  },
  {
    id: 'ua',
    t: 0.52,
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
    shellBackground: 'linear-gradient(165deg, #0a192f 0%, #1e3a8a 42%, #172554 100%)',
    mapPreset: 'dusk',
  },
  {
    id: 'us',
    t: 0.76,
    label: 'US',
    vars: {
      '--lux-bg': '#0a1628',
      '--lux-bg-elevated': '#1e293b',
      '--lux-emerald': '#3b82f6',
      '--lux-emerald-dim': 'rgba(59, 130, 246, 0.2)',
      '--lux-emerald-glow': 'rgba(59, 130, 246, 0.35)',
      '--lux-gold': '#ef4444',
      '--lux-gold-dim': 'rgba(239, 68, 68, 0.18)',
      '--lux-indigo': '#1e3a5f',
      '--lux-purple': '#7f1d1d',
      '--glass-border': 'rgba(148, 163, 184, 0.22)',
    },
    shellBackground: 'linear-gradient(165deg, #0a1628 0%, #1e3a5f 40%, #1a0a0a 100%)',
    mapPreset: 'dusk',
  },
  {
    id: 'aurora',
    t: 1,
    label: 'Aurora',
    vars: {
      '--lux-bg': '#0c0618',
      '--lux-bg-elevated': '#1a0f2e',
      '--lux-emerald': '#c084fc',
      '--lux-emerald-dim': 'rgba(192, 132, 252, 0.2)',
      '--lux-emerald-glow': 'rgba(168, 85, 247, 0.4)',
      '--lux-gold': '#f472b6',
      '--lux-gold-dim': 'rgba(244, 114, 182, 0.18)',
      '--lux-indigo': '#4c1d95',
      '--lux-purple': '#701a75',
      '--glass-border': 'rgba(192, 132, 252, 0.22)',
    },
    shellBackground: 'linear-gradient(165deg, #0c0618 0%, #2e1065 45%, #1a0a14 100%)',
    mapPreset: 'night',
  },
];

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

export function zipLiftTrackGradient(): string {
  const stops = THEME_SPECTRUM_STOPS.map(
    (s) => `${s.vars['--lux-emerald'] ?? '#00f5d4'} ${Math.round(s.t * 100)}%`
  ).join(', ');
  return `linear-gradient(90deg, ${stops})`;
}

let lastAppliedT = -1;

export function applyThemeSpectrum(t: number, opts?: { silent?: boolean }): ThemeSpectrumDetail {
  if (typeof document === 'undefined') {
    return { t, mapPreset: 'night', stopId: 'dark' };
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
  return Math.max(0, Math.min(100, Math.round(value))) / 100;
}

export function shellBackgroundAt(t: number): string {
  return interpolateTheme(t).shellBackground;
}

export function nearestStopLabel(t: number): string {
  let best = THEME_SPECTRUM_STOPS[0]!;
  let dist = Math.abs(t - best.t);
  for (const stop of THEME_SPECTRUM_STOPS) {
    const d = Math.abs(t - stop.t);
    if (d < dist) {
      dist = d;
      best = stop;
    }
  }
  return best.label;
}

export function migrateThemeSpectrumFromFon(themeFon: string | undefined): number {
  if (!themeFon) return 0;
  if (/1e3a8a|0a192f|fbbf24/i.test(themeFon)) return 52;
  if (/0a1628|1e3a5f|ef4444/i.test(themeFon)) return 76;
  if (/0a2838|00ffd0/i.test(themeFon)) return 28;
  if (/2e1065|c084fc/i.test(themeFon)) return 100;
  return 0;
}
