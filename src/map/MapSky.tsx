/**
 * Weather + RUSH controls for the Family map dock.
 * Both start off. Polling and the weather fetch stop when the feature
 * is off, the map is hidden, or the app is in the background.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Map as MapboxMap, MapMouseEvent } from 'mapbox-gl';
import { CloudSun, Plane, Ship, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useLanguage } from '../i18n';
import {
  applyMapSpectrumTheme,
  buildMapSpectrumLook,
} from '../lib/mapbox';
import { loadSettings } from '../settings';
import { interpolateTheme, themeSpectrumFromSettings, THEME_SPECTRUM_EVENT, type ThemeSpectrumDetail } from '../themeSpectrum';
import {
  AIS_POLL_MS,
  bboxFromCamera,
  createTrailTracker,
  cycleRushCraftMode,
  demoTrailGeoJSON,
  demoTrafficEntities,
  emptyTrafficGeoJSON,
  emptyTrailGeoJSON,
  entitiesToGeoJSON,
  featureToTrafficEntity,
  FLIGHT_HIT_LAYERS,
  formatAltitudeLabel,
  formatHeading,
  formatSpeedKmh,
  formatSpeedKn,
  OPENSKY_POLL_MS,
  SHIP_HIT_LAYERS,
  type LiveTrafficEntity,
  type RushCraftMode,
  type TrafficGeoJSON,
  type TrafficTrailGeoJSON,
} from './liveTraffic';
import { fetchViewportFlights, fetchViewportShips } from './liveTrafficClient';
import { clearLiveTrafficLayers, syncLiveTrafficLayers } from './liveTrafficLayers';
import WeatherOverlay from './WeatherOverlay';
import {
  applyWeatherFog,
  DEMO_WEATHER,
  fetchCachedOpenMeteo,
  WEATHER_IDLE,
  type MapWeatherMode,
  type WeatherSnapshot,
} from './weather';

type MapSkyContextValue = {
  weatherOn: boolean;
  toggleWeather: () => void;
  weather: WeatherSnapshot;
  weatherLoading: boolean;
  rushMode: RushCraftMode;
  cycleRush: () => void;
  rushCount: number;
  rushLoading: boolean;
  rushError: string | null;
  overlayDemo: boolean;
  selected: LiveTrafficEntity | null;
  clearSelected: () => void;
};

const MapSkyContext = createContext<MapSkyContextValue | null>(null);

function useMapSky(): MapSkyContextValue {
  const value = useContext(MapSkyContext);
  if (!value) throw new Error('MapSky controls must sit inside MapSkyProvider');
  return value;
}

function readCraftHit(hit: unknown): LiveTrafficEntity | null {
  if (!hit || typeof hit !== 'object') return null;
  const rec = hit as {
    geometry?: { type?: string; coordinates?: [number, number] };
    properties?: Record<string, unknown> | null;
  };
  const coords = rec.geometry?.type === 'Point' ? rec.geometry.coordinates : undefined;
  return featureToTrafficEntity(rec.properties, coords);
}

function overlayDemoRequested(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('overlayDemo') === '1';
  } catch {
    return false;
  }
}

function useMapSessionActive(mapActive: boolean): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  );
  const [appActive, setAppActive] = useState(true);

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let removed = false;
    let handle: { remove: () => Promise<void> } | undefined;
    void import('@capacitor/app').then(({ App }) => {
      if (removed) return undefined;
      return App.addListener('appStateChange', ({ isActive }) => {
        if (!removed) setAppActive(isActive);
      }).then((listener) => {
        if (removed) void listener.remove();
        else handle = listener;
      });
    });
    return () => {
      removed = true;
      void handle?.remove();
    };
  }, []);

  return mapActive && visible && appActive;
}

type Camera = { lat: number; lng: number; zoom: number; bounds: ReturnType<MapboxMap['getBounds']> | null };

function readCamera(map: MapboxMap | null): Camera | null {
  if (!map) return null;
  try {
    const center = map.getCenter();
    const zoom = map.getZoom();
    let bounds: Camera['bounds'] = null;
    try {
      bounds = map.getBounds();
    } catch {
      bounds = null;
    }
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null;
    return { lat: center.lat, lng: center.lng, zoom, bounds };
  } catch {
    return null;
  }
}

export function MapSkyProvider({
  mapRef,
  mapReady,
  active,
  children,
}: {
  mapRef: RefObject<MapboxMap | null>;
  mapReady: boolean;
  active: boolean;
  children: ReactNode;
}) {
  const sessionLive = useMapSessionActive(active);
  const demo = useMemo(() => overlayDemoRequested(), []);
  const [weatherOn, setWeatherOn] = useState(false);
  const [weather, setWeather] = useState<WeatherSnapshot>(WEATHER_IDLE);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [rushMode, setRushMode] = useState<RushCraftMode>('off');
  const [flights, setFlights] = useState<TrafficGeoJSON>(emptyTrafficGeoJSON);
  const [ships, setShips] = useState<TrafficGeoJSON>(emptyTrafficGeoJSON);
  const [flightTrails, setFlightTrails] = useState<TrafficTrailGeoJSON>(emptyTrailGeoJSON);
  const [shipTrails, setShipTrails] = useState<TrafficTrailGeoJSON>(emptyTrailGeoJSON);
  const [rushCount, setRushCount] = useState(0);
  const [rushLoading, setRushLoading] = useState(false);
  const [rushError, setRushError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LiveTrafficEntity | null>(null);
  const fogOverrideRef = useRef(false);
  const flightTrailRef = useRef(createTrailTracker());
  const shipTrailRef = useRef(createTrailTracker());

  const weatherLive = weatherOn && sessionLive;
  const craft: RushCraftMode = sessionLive ? rushMode : 'off';

  useEffect(() => {
    if (!weatherLive) {
      setWeatherLoading(false);
      if (!weatherOn) setWeather(WEATHER_IDLE);
      return;
    }
    if (demo) {
      setWeather(DEMO_WEATHER);
      setWeatherLoading(false);
      return;
    }

    let cancelled = false;
    let timer = 0;
    const abortRef = { current: null as AbortController | null };
    const map = mapRef.current;

    const run = () => {
      const camera = readCamera(mapRef.current);
      if (!camera) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setWeatherLoading(true);
      void fetchCachedOpenMeteo(camera.lat, camera.lng, ac.signal)
        .then((snap) => {
          if (cancelled || ac.signal.aborted) return;
          setWeather(snap);
          setWeatherLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled || ac.signal.aborted) return;
          if (err instanceof Error && err.name === 'AbortError') return;
          setWeather({ ...WEATHER_IDLE, error: 'unavailable' });
          setWeatherLoading(false);
        });
    };

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, ms);
    };

    schedule(250);
    const onMove = () => schedule(1200);
    map?.on('moveend', onMove);
    const refresh = window.setInterval(() => schedule(0), 12 * 60 * 1000);
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      window.clearTimeout(timer);
      window.clearInterval(refresh);
      map?.off('moveend', onMove);
    };
  }, [weatherLive, weatherOn, demo, mapReady, mapRef]);

  useEffect(() => {
    if (craft === 'off') {
      flightTrailRef.current.clear();
      shipTrailRef.current.clear();
      setFlights(emptyTrafficGeoJSON());
      setShips(emptyTrafficGeoJSON());
      setFlightTrails(emptyTrailGeoJSON());
      setShipTrails(emptyTrailGeoJSON());
      setRushCount(0);
      setRushLoading(false);
      setRushError(null);
      setSelected(null);
      return;
    }

    let cancelled = false;
    let timer = 0;
    const abortRef = { current: null as AbortController | null };
    const map = mapRef.current;
    const kind = craft === 'planes' ? 'flight' : 'ship';
    if (kind === 'flight') shipTrailRef.current.clear();
    else flightTrailRef.current.clear();

    const publishDemo = () => {
      const camera = readCamera(mapRef.current);
      if (!camera) return;
      const entities = demoTrafficEntities(kind, camera.lat, camera.lng);
      const points = entitiesToGeoJSON(entities);
      const trails = demoTrailGeoJSON(entities);
      if (kind === 'flight') {
        setFlights(points);
        setFlightTrails(trails);
        setShips(emptyTrafficGeoJSON());
        setShipTrails(emptyTrailGeoJSON());
      } else {
        setShips(points);
        setShipTrails(trails);
        setFlights(emptyTrafficGeoJSON());
        setFlightTrails(emptyTrailGeoJSON());
      }
      setRushCount(entities.length);
      setRushError(null);
      setRushLoading(false);
    };

    const tick = async () => {
      if (cancelled) return;
      if (demo) {
        publishDemo();
        return;
      }
      const camera = readCamera(mapRef.current);
      if (!camera) {
        timer = window.setTimeout(() => void tick(), 1500);
        return;
      }
      const bbox = bboxFromCamera({
        lat: camera.lat,
        lng: camera.lng,
        zoom: camera.zoom,
        bounds: camera.bounds,
      });
      if (!bbox) {
        timer = window.setTimeout(() => void tick(), 1500);
        return;
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        if (kind === 'flight') {
          const { entities, meta } = await fetchViewportFlights(bbox, camera.zoom, ac.signal);
          if (cancelled || ac.signal.aborted) return;
          setFlights(entitiesToGeoJSON(entities));
          setFlightTrails(flightTrailRef.current.sync(entities, 'flight'));
          setShips(emptyTrafficGeoJSON());
          setShipTrails(emptyTrailGeoJSON());
          setRushCount(entities.length);
          setRushError(meta.error);
          setRushLoading(false);
          timer = window.setTimeout(() => void tick(), meta.error ? 20_000 : OPENSKY_POLL_MS);
        } else {
          const { entities, meta } = await fetchViewportShips(bbox, camera.zoom, ac.signal);
          if (cancelled || ac.signal.aborted) return;
          setShips(entitiesToGeoJSON(entities));
          setShipTrails(shipTrailRef.current.sync(entities, 'ship'));
          setFlights(emptyTrafficGeoJSON());
          setFlightTrails(emptyTrailGeoJSON());
          setRushCount(entities.length);
          setRushError(meta.error);
          setRushLoading(false);
          const needKey = meta.error != null && /need-key|no key|missing/i.test(meta.error);
          timer = window.setTimeout(() => void tick(), needKey ? 60_000 : meta.error ? 20_000 : AIS_POLL_MS);
        }
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setRushError(err instanceof Error ? err.message : 'unavailable');
        setRushLoading(false);
        timer = window.setTimeout(() => void tick(), 20_000);
      }
    };

    setRushLoading(true);
    void tick();
    const onMove = () => {
      if (demo) publishDemo();
    };
    map?.on('moveend', onMove);
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      window.clearTimeout(timer);
      map?.off('moveend', onMove);
    };
  }, [craft, demo, mapReady, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const paint = () => {
      syncLiveTrafficLayers(map, {
        showFlights: craft === 'planes',
        showShips: craft === 'ships',
        flights,
        ships,
        flightTrails,
        shipTrails,
      });
    };
    paint();
    const onStyle = () => paint();
    map.on('style.load', onStyle);

    const onClick = (event: MapMouseEvent) => {
      const layers = [...FLIGHT_HIT_LAYERS, ...SHIP_HIT_LAYERS].filter((id) => {
        try {
          return Boolean(map.getLayer(id));
        } catch {
          return false;
        }
      });
      if (layers.length === 0) {
        setSelected(null);
        return;
      }
      const hits = map.queryRenderedFeatures(event.point, { layers });
      setSelected(readCraftHit(hits[0]));
    };
    map.on('click', onClick);

    return () => {
      map.off('style.load', onStyle);
      map.off('click', onClick);
      if (craft === 'off') clearLiveTrafficLayers(map);
    };
  }, [mapReady, mapRef, craft, flights, ships, flightTrails, shipTrails]);

  const visualWeather: MapWeatherMode = weatherOn ? weather.mode : 'clear';

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const apply = () => {
      const t = themeSpectrumFromSettings(loadSettings().themeSpectrum);
      const theme = interpolateTheme(t);
      if (visualWeather === 'rain' || visualWeather === 'sandstorm') {
        const look = buildMapSpectrumLook(theme.palette, theme.mapPreset);
        try {
          map.setFog(applyWeatherFog(visualWeather, look.fog));
          fogOverrideRef.current = true;
        } catch {
          /* atmosphere owned by the style */
        }
        return;
      }
      if (fogOverrideRef.current) {
        applyMapSpectrumTheme(map, { mapPreset: theme.mapPreset, palette: theme.palette });
        fogOverrideRef.current = false;
      }
    };

    apply();
    const onTheme = (event: Event) => {
      const detail = (event as CustomEvent<ThemeSpectrumDetail>).detail;
      if (!detail) return;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(apply);
      });
    };
    window.addEventListener(THEME_SPECTRUM_EVENT, onTheme);
    return () => window.removeEventListener(THEME_SPECTRUM_EVENT, onTheme);
  }, [mapReady, mapRef, visualWeather]);

  const toggleWeather = useCallback(() => {
    setWeatherOn((on) => !on);
  }, []);

  const cycleRush = useCallback(() => {
    setRushMode((mode) => cycleRushCraftMode(mode));
    setSelected(null);
  }, []);

  const clearSelected = useCallback(() => setSelected(null), []);

  const value = useMemo<MapSkyContextValue>(
    () => ({
      weatherOn,
      toggleWeather,
      weather,
      weatherLoading,
      rushMode,
      cycleRush,
      rushCount,
      rushLoading,
      rushError,
      overlayDemo: demo,
      selected,
      clearSelected,
    }),
    [
      weatherOn,
      toggleWeather,
      weather,
      weatherLoading,
      rushMode,
      cycleRush,
      rushCount,
      rushLoading,
      rushError,
      demo,
      selected,
      clearSelected,
    ]
  );

  return <MapSkyContext.Provider value={value}>{children}</MapSkyContext.Provider>;
}

export function MapSkyCanvas() {
  const sky = useMapSky();
  return <WeatherOverlay weather={sky.weatherOn ? sky.weather.mode : 'clear'} />;
}

const PEEK_MS = 900;
const LIFT_MS = 280;

function usePeek(token: string) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const skip = useRef(true);

  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    if (!token) {
      setOpen(false);
      const unmount = window.setTimeout(() => setMounted(false), LIFT_MS);
      return () => window.clearTimeout(unmount);
    }
    setMounted(true);
    const frame = window.requestAnimationFrame(() => setOpen(true));
    const hide = window.setTimeout(() => setOpen(false), PEEK_MS);
    const unmount = window.setTimeout(() => setMounted(false), PEEK_MS + LIFT_MS);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(hide);
      window.clearTimeout(unmount);
    };
  }, [token]);

  return { mounted, open };
}

export function MapSkyButtons() {
  const { t } = useLanguage();
  const sky = useMapSky();
  const weatherToken = sky.weatherOn ? 'weather' : '';
  const rushToken = sky.rushMode === 'off' ? '' : sky.rushMode;
  const weatherPeek = usePeek(weatherToken);
  const rushPeek = usePeek(rushToken);

  const weatherLabel = sky.weatherOn ? t('map.weatherLive') : t('map.weather');
  const rushLabel =
    sky.rushMode === 'ships'
      ? `${t('map.rush')} · ${t('map.rushShips')}`
      : sky.rushMode === 'planes'
        ? `${t('map.rush')} · ${t('map.rushPlanes')}`
        : t('map.rush');

  const temp = sky.weather.current?.temperature;
  const wind = sky.weather.current?.windspeed;
  const modeLabel =
    sky.weather.mode === 'rain'
      ? t('map.weatherRain')
      : sky.weather.mode === 'sandstorm'
        ? t('map.weatherSand')
        : t('map.weatherClear');

  let weatherStatus = sky.weatherLoading ? '…' : modeLabel;
  if (sky.weather.cooling) weatherStatus = t('map.weatherCooling');
  else if (sky.weather.error === 'unavailable' || sky.weather.error?.startsWith('http-')) {
    weatherStatus = t('map.weatherUnavailable');
  }

  const rushStatus = sky.rushLoading
    ? '…'
    : sky.rushError && /need-key|no key|missing/i.test(sky.rushError)
      ? t('map.rushNeedKey')
      : sky.rushError
        ? sky.rushError.slice(0, 42)
        : String(sky.rushCount);

  return (
    <>
      <div className="map-side-dock__slot">
        <button
          type="button"
          className={`map-side-dock__fab map-side-dock__fab--wx${sky.weatherOn ? ' is-active' : ''}`}
          aria-pressed={sky.weatherOn}
          aria-label={t('map.weatherAria')}
          title={weatherLabel}
          onClick={(event) => {
            event.stopPropagation();
            sky.toggleWeather();
          }}
        >
          <CloudSun size={16} strokeWidth={1.5} aria-hidden />
        </button>
        {weatherPeek.mounted && (
          <div
            className={`map-overlay-peek${weatherPeek.open ? ' is-open' : ''}`}
            role="status"
          >
            <p className="map-overlay-peek__title">{t('map.weather')}</p>
            <p className="map-overlay-peek__value">
              {typeof temp === 'number' ? `${Math.round(temp)}°` : '—'} · {weatherStatus}
              {sky.weather.demo ? ` · ${t('map.weatherDemo')}` : ''}
            </p>
            <p className="map-overlay-peek__meta">
              {typeof wind === 'number'
                ? t('map.weatherHint', { speed: Math.round(wind) })
                : ''}
              {sky.weather.current?.weathercode != null
                ? ` · ${sky.weather.current.weathercode}`
                : ''}
            </p>
          </div>
        )}
      </div>

      <div className="map-side-dock__slot">
        <button
          type="button"
          className={`map-side-dock__fab map-side-dock__fab--rush${
            sky.rushMode === 'ships' ? ' is-ships' : ''
          }${sky.rushMode === 'planes' ? ' is-planes' : ''}`}
          aria-pressed={sky.rushMode !== 'off'}
          aria-label={t('map.rushAria')}
          title={rushLabel}
          onClick={(event) => {
            event.stopPropagation();
            sky.cycleRush();
          }}
        >
          {sky.rushMode === 'planes' ? (
            <Plane size={16} strokeWidth={1.5} aria-hidden />
          ) : (
            <Ship size={16} strokeWidth={1.5} aria-hidden />
          )}
        </button>
        {rushPeek.mounted && (
          <div className={`map-overlay-peek${rushPeek.open ? ' is-open' : ''}`} role="status">
            <p className="map-overlay-peek__title">{t('map.rush')}</p>
            <p className="map-overlay-peek__value">
              {sky.rushMode === 'planes' ? t('map.rushPlanes') : t('map.rushShips')}
              {' · '}
              {rushStatus}
              {sky.overlayDemo ? ` · ${t('map.rushDemo')}` : ''}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

export function MapSkyCard() {
  const { t } = useLanguage();
  const sky = useMapSky();
  const craft = sky.selected;
  if (!craft) return null;
  const speed = craft.kind === 'flight' ? formatSpeedKmh(craft.speedKn) : formatSpeedKn(craft.speedKn);
  const extra =
    craft.kind === 'flight'
      ? formatAltitudeLabel(craft.altitudeM, craft.onGround)
      : formatHeading(craft.heading);
  return (
    <div className="map-craft-card map-ui-hit" role="dialog" aria-label={craft.callsign}>
      <div className="map-craft-card__head">
        <p className="map-craft-card__kicker">
          {craft.kind === 'flight' ? t('map.rushPlanes') : t('map.rushShips')}
          {craft.demo ? ` · ${t('map.rushDemo')}` : ''}
        </p>
        <button type="button" aria-label={t('map.craftClose')} onClick={sky.clearSelected}>
          <X size={16} />
        </button>
      </div>
      <p className="map-craft-card__title">{craft.callsign}</p>
      <p className="map-craft-card__meta">
        {craft.kind === 'flight' ? t('map.craftAltitude') : t('map.craftCourse')}: {extra || '—'}
        {speed ? ` · ${t('map.craftSpeed')}: ${speed}` : ''}
        {craft.kind === 'flight' && formatHeading(craft.heading)
          ? ` · ${formatHeading(craft.heading)}`
          : ''}
      </p>
    </div>
  );
}
