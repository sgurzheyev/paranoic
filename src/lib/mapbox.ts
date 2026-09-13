/**
 * Mapbox Standard (v3) — ночной пресет под Sequoia Liquid Glass.
 * Паттерн как в CleanEgypt: ждать style ready, затем setConfigProperty.
 */

export const MAPBOX_STANDARD_STYLE = 'mapbox://styles/mapbox/standard' as const;

export type MapboxLightPreset = 'dusk' | 'dawn' | 'day' | 'night';

/** Interpolated Zip Lift hues used to tint Mapbox Standard (independent of language). */
export type MapSpectrumPalette = {
  bg: string;
  emerald: string;
  gold: string;
  indigo: string;
  purple: string;
};

export type MapSpectrumLook = {
  colorWater: string;
  colorLand: string;
  colorGreenspace: string;
  colorMotorways: string;
  colorRoads: string;
  colorBuildings: string;
  colorPlaceLabels: string;
  colorAdminBoundaries: string;
  fog: {
    range: [number, number];
    color: string;
    'high-color': string;
    'space-color': string;
    'horizon-blend': number;
    'star-intensity': number;
  };
};

export const MAPBOX_STANDARD_BASEMAP_CONFIG = {
  theme: 'default',
  lightPreset: 'night' as MapboxLightPreset,
  show3dObjects: true,
  showPointOfInterestLabels: false,
  showTransitLabels: false,
  showPlaceLabels: true,
  showRoadLabels: true,
} as const;

const MAP_COLOR_CONFIG_KEYS = [
  'colorWater',
  'colorLand',
  'colorGreenspace',
  'colorMotorways',
  'colorRoads',
  'colorBuildings',
  'colorPlaceLabels',
  'colorAdminBoundaries',
] as const;

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

function mixColor(a: string, b: string, t: number): string {
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

/** Derive Standard color overrides + globe fog from a Zip Lift palette. */
export function buildMapSpectrumLook(
  palette: MapSpectrumPalette,
  mapPreset: MapboxLightPreset
): MapSpectrumLook {
  const { bg, emerald, gold, indigo, purple } = palette;
  const night = mapPreset === 'night';
  const dusk = mapPreset === 'dusk';
  const water = mixColor(mixColor(indigo, emerald, 0.16), bg, night ? 0.18 : 0.1);
  const land = mixColor(mixColor(bg, indigo, 0.32), purple, 0.12);
  return {
    colorWater: water,
    colorLand: land,
    colorGreenspace: mixColor(emerald, land, 0.42),
    colorMotorways: gold,
    colorRoads: mixColor(gold, land, 0.48),
    colorBuildings: mixColor(indigo, bg, 0.38),
    colorPlaceLabels: emerald,
    colorAdminBoundaries: mixColor(emerald, gold, 0.35),
    fog: {
      range: night ? [-0.35, 7.5] : [-0.55, 9],
      color: mixColor(emerald, gold, 0.28),
      'high-color': mixColor(indigo, emerald, 0.22),
      'space-color': mixColor(bg, '#000000', 0.22),
      'horizon-blend': night ? 0.16 : 0.26,
      'star-intensity': night ? 0.4 : dusk ? 0.16 : 0.04,
    },
  };
}

export function mapboxBasemapConfigForTheme(
  mapPreset: MapboxLightPreset,
  palette: MapSpectrumPalette
): Record<string, unknown> {
  const look = buildMapSpectrumLook(palette, mapPreset);
  return {
    ...MAPBOX_STANDARD_BASEMAP_CONFIG,
    lightPreset: mapPreset,
    colorWater: look.colorWater,
    colorLand: look.colorLand,
    colorGreenspace: look.colorGreenspace,
    colorMotorways: look.colorMotorways,
    colorRoads: look.colorRoads,
    colorBuildings: look.colorBuildings,
    colorPlaceLabels: look.colorPlaceLabels,
    colorAdminBoundaries: look.colorAdminBoundaries,
  };
}

/** Style JSON with baked-in light + tint — no default-night flash on first frame. */
export function mapboxStandardStyleForTheme(
  mapPreset: MapboxLightPreset,
  palette: MapSpectrumPalette
) {
  const look = buildMapSpectrumLook(palette, mapPreset);
  return {
    version: 8 as const,
    fog: look.fog,
    imports: [
      {
        id: 'basemap',
        url: MAPBOX_STANDARD_STYLE,
        config: mapboxBasemapConfigForTheme(mapPreset, palette),
      },
    ],
    sources: {},
    layers: [],
  };
}

/** Style JSON с baked-in night — без дневной вспышки на первом кадре. */
export const MAPBOX_STANDARD_STYLE_WITH_CONFIG = {
  version: 8 as const,
  imports: [
    {
      id: 'basemap',
      url: MAPBOX_STANDARD_STYLE,
      config: { ...MAPBOX_STANDARD_BASEMAP_CONFIG },
    },
  ],
  sources: {},
  layers: [],
};

export function getMapboxToken(): string {
  return (import.meta.env.VITE_MAPBOX_TOKEN ?? '').trim();
}

export function hasMapboxToken(): boolean {
  return Boolean(getMapboxToken());
}

/**
 * Ставит mapboxgl.accessToken из VITE_MAPBOX_TOKEN.
 * При пустом токене — console.error и false.
 */
export function applyMapboxAccessToken(setToken: (token: string) => void): boolean {
  const token = getMapboxToken();
  if (!token) {
    console.error(
      '[paranoic mapbox] VITE_MAPBOX_TOKEN пуст или не задан. ' +
        'Добавьте токен в .env (VITE_MAPBOX_TOKEN=pk....) и перезапустите Vite — ' +
        'переменные окружения читаются только при старте dev-сервера.'
    );
    return false;
  }
  setToken(token);
  console.info('[paranoic mapbox] accessToken OK (length=%d)', token.length);
  return true;
}

type StyleReadyMap = {
  isStyleLoaded?: () => boolean;
  once?: (type: string, listener: (...args: unknown[]) => void) => unknown;
  setConfigProperty?: (importId: string, property: string, value: unknown) => void;
  setFog?: (fog: MapSpectrumLook['fog'] | null) => void;
};

export function whenMapStyleReady(
  map: StyleReadyMap | null | undefined,
  callback: (map: StyleReadyMap) => void
): () => void {
  if (!map) return () => undefined;

  let cancelled = false;
  let ran = false;

  const ready = () => {
    try {
      return typeof map.isStyleLoaded === 'function' && map.isStyleLoaded() === true;
    } catch {
      return false;
    }
  };

  const run = () => {
    if (cancelled || ran) return;
    if (!ready()) return;
    ran = true;
    try {
      callback(map);
    } catch (err) {
      console.warn('[mapbox] style-ready callback failed', err);
    }
  };

  const onStyleLoad = () => {
    requestAnimationFrame(() => {
      if (cancelled) return;
      if (ready()) {
        run();
        return;
      }
      map.once?.('idle', run);
    });
  };

  if (ready()) {
    queueMicrotask(run);
  } else {
    map.once?.('style.load', onStyleLoad);
    map.once?.('idle', run);
    map.once?.('load', onStyleLoad);
  }

  return () => {
    cancelled = true;
  };
}

function isMapStyleReady(map: StyleReadyMap | null | undefined): map is StyleReadyMap {
  if (!map) return false;
  try {
    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) return false;
  } catch {
    return false;
  }
  return true;
}

export function applyMapThemePreset(
  map: StyleReadyMap | null | undefined,
  preset: MapboxLightPreset
): boolean {
  if (!isMapStyleReady(map) || !map.setConfigProperty) return false;
  try {
    map.setConfigProperty('basemap', 'lightPreset', preset);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply Zip Lift color family to Mapbox Standard: lightPreset, land/water/road
 * overrides, and globe fog/atmosphere. Safe to call on every spectrum event.
 */
export function applyMapSpectrumTheme(
  map: StyleReadyMap | null | undefined,
  opts: { mapPreset: MapboxLightPreset; palette: MapSpectrumPalette }
): boolean {
  if (!isMapStyleReady(map)) return false;
  const look = buildMapSpectrumLook(opts.palette, opts.mapPreset);
  let applied = applyMapThemePreset(map, opts.mapPreset);
  if (map.setConfigProperty) {
    for (const key of MAP_COLOR_CONFIG_KEYS) {
      try {
        map.setConfigProperty('basemap', key, look[key]);
        applied = true;
      } catch {
        /* unsupported key / busy style */
      }
    }
  }
  if (typeof map.setFog === 'function') {
    try {
      map.setFog(look.fog);
      applied = true;
    } catch {
      /* Standard may own atmosphere on some builds */
    }
  }
  return applied;
}

export function applyMapboxStandardNight(map: StyleReadyMap | null | undefined): boolean {
  if (!map?.setConfigProperty) return false;
  try {
    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) return false;
  } catch {
    return false;
  }

  for (const [key, value] of Object.entries(MAPBOX_STANDARD_BASEMAP_CONFIG)) {
    try {
      map.setConfigProperty('basemap', key, value);
    } catch {
      /* unsupported key / busy style */
    }
  }
  return true;
}

/** Ukrainian flag-inspired map palette (deep blue + golden dusk). */
export const MAPBOX_UA_PALETTE: MapSpectrumPalette = {
  bg: '#0a192f',
  emerald: '#fbbf24',
  gold: '#f59e0b',
  indigo: '#1e3a8a',
  purple: '#172554',
};

export const MAPBOX_UA_BASEMAP_CONFIG = {
  ...MAPBOX_STANDARD_BASEMAP_CONFIG,
  ...mapboxBasemapConfigForTheme('dusk', MAPBOX_UA_PALETTE),
  lightPreset: 'dusk' as MapboxLightPreset,
  theme: 'default',
};

export function applyUaMapTheme(map: StyleReadyMap | null | undefined): boolean {
  return applyMapSpectrumTheme(map, { mapPreset: 'dusk', palette: MAPBOX_UA_PALETTE });
}
