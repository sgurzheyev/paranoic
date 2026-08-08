import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ArrowLeft, MapPin, MessageCircle, Phone, X, ZoomIn, ZoomOut } from 'lucide-react';
import { initials } from './identity';
import {
  applyMapboxAccessToken,
  applyMapboxStandardNight,
  MAPBOX_STANDARD_STYLE,
  whenMapStyleReady,
} from './lib/mapbox';
import { ANTARCTICA, type PresenceUser } from './presence';

export type MapPerson = PresenceUser & {
  isContact: boolean;
  isMe?: boolean;
};

type GlobeLobbyProps = {
  onBack: () => void;
  people: MapPerson[];
  geoSource: 'gps' | 'antarctica' | 'pending';
  onCallUser: (user: MapPerson) => void;
  onChatUser: (user: MapPerson) => void;
};

const FOCUS_ZOOM = 6.2;
const WORLD_ZOOM = 2.1;

function buildMarkerElement(
  person: MapPerson,
  selected: boolean,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = [
    'map-avatar-marker',
    person.isMe ? 'is-me' : '',
    person.isContact ? 'is-contact' : 'is-stranger',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  btn.setAttribute('aria-label', person.isMe ? 'Вы' : person.name);
  btn.style.setProperty('--marker-color', person.color || '#60a5fa');

  if (person.avatarUrl) {
    const img = document.createElement('img');
    img.src = person.avatarUrl;
    img.alt = '';
    img.draggable = false;
    img.className = 'map-avatar-marker-img';
    btn.appendChild(img);
  } else if (!person.isContact && !person.isMe) {
    const dot = document.createElement('span');
    dot.className = 'map-avatar-marker-gold';
    dot.textContent = '·';
    btn.appendChild(dot);
  } else {
    const label = document.createElement('span');
    label.className = 'map-avatar-marker-initials';
    label.textContent = initials(person.name);
    btn.appendChild(label);
  }

  const pulse = document.createElement('span');
  pulse.className = 'map-avatar-marker-dot';
  btn.appendChild(pulse);

  if (person.isMe) {
    const tag = document.createElement('span');
    tag.className = 'map-avatar-marker-you';
    tag.textContent = 'Вы';
    btn.appendChild(tag);
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });

  return btn;
}

export default function GlobeLobby({
  onBack,
  people,
  geoSource,
  onCallUser,
  onChatUser,
}: GlobeLobbyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const selectedIdRef = useRef<string | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [tokenMissing, setTokenMissing] = useState(false);
  const [selected, setSelected] = useState<MapPerson | null>(null);
  const [zoom, setZoom] = useState(WORLD_ZOOM);

  const contacts = useMemo(
    () => people.filter((p) => p.isContact && !p.isMe),
    [people]
  );

  const me = useMemo(() => people.find((p) => p.isMe), [people]);

  selectedIdRef.current = selected?.userId ?? null;

  const flyToPerson = (person: MapPerson, openCard = true) => {
    const map = mapRef.current;
    if (!map) return;
    if (openCard && !person.isMe) setSelected(person);
    map.flyTo({
      center: [person.lng, person.lat],
      zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
      speed: 1.15,
      curve: 1.42,
      essential: true,
      padding: { top: 80, bottom: 180, left: 40, right: 40 },
    });
  };

  /** Инициализация Mapbox Standard night. */
  useEffect(() => {
    if (!applyMapboxAccessToken((token) => {
      mapboxgl.accessToken = token;
    })) {
      setTokenMissing(true);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      console.error('[paranoic mapbox] контейнер карты не найден (ref=null)');
      return;
    }

    // Явные размеры до создания WebGL — иначе canvas = 0×0 и чёрный экран.
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.minHeight = '100vh';

    const center: [number, number] = me
      ? [me.lng, me.lat]
      : [ANTARCTICA.lng, ANTARCTICA.lat];

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container,
        // URL надёжнее кастомного imports-JSON при первом рендере.
        style: MAPBOX_STANDARD_STYLE,
        center,
        zoom: WORLD_ZOOM,
        pitch: 42,
        bearing: -12,
        antialias: true,
        attributionControl: true,
      });
    } catch (err) {
      console.error('[paranoic mapbox] не удалось создать Map', err);
      setTokenMissing(true);
      return;
    }

    map.addControl(
      new mapboxgl.NavigationControl({
        visualizePitch: true,
        showCompass: true,
        showZoom: false,
      }),
      'bottom-right'
    );

    const forceResize = () => {
      try {
        map.resize();
      } catch (err) {
        console.warn('[paranoic mapbox] resize failed', err);
      }
    };

    const onZoom = () => setZoom(map.getZoom());
    map.on('zoom', onZoom);

    map.on('error', (e) => {
      console.error('[paranoic mapbox] map error', e.error ?? e);
    });

    map.on('load', () => {
      forceResize();
      // Повторный resize после layout (flex/absolute могут дать размер с задержкой).
      requestAnimationFrame(() => {
        forceResize();
        requestAnimationFrame(forceResize);
      });
      window.setTimeout(forceResize, 120);
      window.setTimeout(forceResize, 400);
    });

    const cancelReady = whenMapStyleReady(map, (readyMap) => {
      applyMapboxStandardNight(readyMap);
      forceResize();
      setMapReady(true);
    });

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => forceResize())
        : null;
    ro?.observe(container);

    const onWinResize = () => forceResize();
    window.addEventListener('resize', onWinResize);
    window.addEventListener('orientationchange', onWinResize);

    mapRef.current = map;

    return () => {
      cancelReady();
      ro?.disconnect();
      window.removeEventListener('resize', onWinResize);
      window.removeEventListener('orientationchange', onWinResize);
      map.off('zoom', onZoom);
      for (const marker of markersRef.current.values()) marker.remove();
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // me только для стартового центра при первом маунте
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Следим за GPS «меня» — плавно двигаем камеру при первом реальном фиксе. */
  const didCenterOnGps = useRef(false);
  useEffect(() => {
    if (!mapReady || !me || didCenterOnGps.current) return;
    if (geoSource !== 'gps') return;
    didCenterOnGps.current = true;
    mapRef.current?.flyTo({
      center: [me.lng, me.lat],
      zoom: 4.5,
      speed: 0.9,
      essential: true,
    });
  }, [mapReady, me, geoSource]);

  /** Синхронизация HTML-маркеров аватарок с presence. */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const nextIds = new Set(people.map((p) => p.userId));

    for (const [id, marker] of markersRef.current) {
      if (!nextIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const person of people) {
      const existing = markersRef.current.get(person.userId);
      const selectedNow = selectedIdRef.current === person.userId;

      if (existing) {
        existing.setLngLat([person.lng, person.lat]);
        const el = existing.getElement() as HTMLButtonElement;
        el.classList.toggle('is-selected', selectedNow);
        const img = el.querySelector('.map-avatar-marker-img') as HTMLImageElement | null;
        if (person.avatarUrl && img && img.src !== person.avatarUrl) {
          img.src = person.avatarUrl;
        }
        continue;
      }

      const el = buildMarkerElement(person, selectedNow, () => {
        if (person.isMe) {
          flyToPerson(person, false);
          return;
        }
        setSelected(person);
        flyToPerson(person, false);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([person.lng, person.lat])
        .addTo(map);

      markersRef.current.set(person.userId, marker);
    }
  }, [people, mapReady, selected]);

  const nudgeZoom = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      zoom: Math.min(18, Math.max(1.2, map.getZoom() + delta)),
      duration: 320,
      essential: true,
    });
  };

  const geoHint =
    geoSource === 'gps'
      ? 'Ваша точка — по GPS'
      : geoSource === 'antarctica'
        ? 'Ghost Mode / без GPS — условная Антарктида'
        : 'Запрашиваем геолокацию…';

  return (
    <div className="relative h-svh w-full overflow-hidden bg-[#03050a] font-[Nunito,system-ui,sans-serif] text-slate-200">
      <div
        ref={containerRef}
        className="family-mapbox absolute inset-0 h-full w-full"
        style={{ width: '100%', height: '100%', minHeight: '100vh' }}
      />

      {tokenMissing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#03050a]/90 p-6 text-center backdrop-blur-md">
          <div className="max-w-md rounded-3xl border border-white/20 bg-white/10 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]">
            <h2 className="m-0 text-xl font-extrabold text-white">Нужен Mapbox токен</h2>
            <p className="mt-3 text-sm text-slate-300">
              Добавьте <code className="text-teal-200">VITE_MAPBOX_TOKEN</code> в{' '}
              <code className="text-teal-200">.env</code> и перезапустите dev-сервер.
            </p>
            <button
              type="button"
              onClick={onBack}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-white"
            >
              <ArrowLeft size={16} /> Назад
            </button>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
        <header className="pointer-events-auto flex items-center justify-between px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[20px] transition hover:bg-white/15"
          >
            <ArrowLeft size={16} /> Назад
          </button>
          <div className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[20px]">
            Family Mode
          </div>
        </header>

        <div className="pointer-events-none mt-2 px-4 text-center sm:px-6">
          <p className="mx-auto max-w-md text-sm text-slate-300/90 sm:text-base">
            Mapbox Standard · ночь. Нажмите аватар — звонок или чат.
          </p>
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md">
            <MapPin size={12} /> {geoHint}
          </p>
        </div>

        <div className="pointer-events-auto mt-auto flex flex-col gap-3 px-4 pb-6 sm:px-6">
          {contacts.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-white/15 bg-white/[0.07] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-[18px]">
              <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Близкие
              </p>
              <div className="flex gap-3">
                {contacts.map((c) => (
                  <button
                    key={c.userId}
                    type="button"
                    className="flex w-16 shrink-0 flex-col items-center gap-1.5"
                    onClick={() => flyToPerson(c)}
                    aria-label={`Найти ${c.name} на карте`}
                  >
                    <span
                      className="relative h-12 w-12 overflow-hidden rounded-full border-2 border-white/50 shadow-md"
                      style={{ background: c.avatarUrl ? '#1a1d28' : c.color }}
                    >
                      {c.avatarUrl ? (
                        <img
                          src={c.avatarUrl}
                          alt=""
                          className="h-full w-full rounded-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-xs font-extrabold text-white">
                          {initials(c.name)}
                        </span>
                      )}
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#0a0c12] bg-emerald-400" />
                    </span>
                    <span className="max-w-full truncate text-[11px] font-bold text-slate-200">
                      {c.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <div className="flex flex-col gap-2">
              <button
                type="button"
                aria-label="Приблизить"
                onClick={() => nudgeZoom(1.2)}
                disabled={zoom >= 17.5}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[20px] transition hover:bg-white/15 disabled:opacity-35"
              >
                <ZoomIn size={18} />
              </button>
              <button
                type="button"
                aria-label="Отдалить"
                onClick={() => nudgeZoom(-1.2)}
                disabled={zoom <= 1.4}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[20px] transition hover:bg-white/15 disabled:opacity-35"
              >
                <ZoomOut size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {selected && (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/40 p-4 backdrop-blur-[8px] sm:items-center">
          <div className="w-full max-w-md animate-[slide-up_0.28s_ease] rounded-3xl border border-white/20 bg-white/[0.08] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-[24px]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-lg font-extrabold text-white"
                  style={{
                    background: selected.avatarUrl
                      ? '#1a1d28'
                      : selected.isContact
                        ? selected.color
                        : '#f59e0b',
                  }}
                >
                  {selected.avatarUrl ? (
                    <img
                      src={selected.avatarUrl}
                      alt=""
                      className="h-full w-full rounded-full object-cover"
                      draggable={false}
                    />
                  ) : selected.isContact ? (
                    initials(selected.name)
                  ) : (
                    '·'
                  )}
                  <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#12141c] bg-emerald-400" />
                </div>
                <div>
                  <p className="m-0 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                    {selected.isContact ? 'Контакт' : 'В сети'}
                  </p>
                  <h2 className="mt-1 m-0 text-2xl font-extrabold text-white">
                    {selected.isContact ? selected.name : 'Незнакомец'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {selected.lat.toFixed(1)}°, {selected.lng.toFixed(1)}°
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="rounded-full p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
                aria-label="Закрыть"
                onClick={() => setSelected(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => onChatUser(selected)}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-5 py-4 text-base font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition hover:bg-white/15"
              >
                <MessageCircle size={20} /> Написать
              </button>
              <button
                type="button"
                onClick={() => onCallUser(selected)}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-5 py-4 text-base font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_24px_rgba(255,255,255,0.06)] transition hover:bg-white/15"
              >
                <Phone size={20} /> Позвонить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
