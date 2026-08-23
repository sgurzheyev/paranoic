/**
 * Mapbox Standard (v3) — ночной пресет под Sequoia Liquid Glass.
 * Паттерн как в CleanEgypt: ждать style ready, затем setConfigProperty.
 */

export const MAPBOX_STANDARD_STYLE = 'mapbox://styles/mapbox/standard' as const;

export type MapboxLightPreset = 'dusk' | 'dawn' | 'day' | 'night';

export const MAPBOX_STANDARD_BASEMAP_CONFIG = {
  theme: 'default',
  lightPreset: 'night' as MapboxLightPreset,
  show3dObjects: true,
  showPointOfInterestLabels: false,
  showTransitLabels: false,
  showPlaceLabels: true,
  showRoadLabels: true,
} as const;

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

export function applyMapThemePreset(
  map: StyleReadyMap | null | undefined,
  preset: MapboxLightPreset
): boolean {
  if (!map?.setConfigProperty) return false;
  try {
    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) return false;
  } catch {
    return false;
  }
  try {
    map.setConfigProperty('basemap', 'lightPreset', preset);
    return true;
  } catch {
    return false;
  }
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
export const MAPBOX_UA_BASEMAP_CONFIG = {
  ...MAPBOX_STANDARD_BASEMAP_CONFIG,
  lightPreset: 'dusk' as MapboxLightPreset,
  theme: 'default',
} as const;

export function applyUaMapTheme(map: StyleReadyMap | null | undefined): boolean {
  if (!map?.setConfigProperty) return false;
  try {
    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) return false;
  } catch {
    return false;
  }

  for (const [key, value] of Object.entries(MAPBOX_UA_BASEMAP_CONFIG)) {
    try {
      map.setConfigProperty('basemap', key, value);
    } catch {
      /* */
    }
  }
  return true;
}
