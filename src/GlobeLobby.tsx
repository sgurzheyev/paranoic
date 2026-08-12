import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft,
  Box,
  Gem,
  Ghost,
  Layers,
  MapPin,
  MessageCircle,
  Phone,
  PhoneOff,
  Radar,
  ShieldCheck,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { initials } from './identity';
import {
  applyMapboxAccessToken,
  applyMapboxStandardNight,
  MAPBOX_STANDARD_STYLE_WITH_CONFIG,
  whenMapStyleReady,
} from './lib/mapbox';
import ParanoicLogo from './ParanoicLogo';
import { ANTARCTICA, type PresenceUser } from './presence';
import {
  bindGemInteractions,
  ensureGemLayers,
  setGemFeatures,
  setGemsLayerVisibility,
  startGemPulse,
} from './mapGemLayers';
import { buildVisibleGemsContext, fetchAllMapGems, type MapGem } from './mapGems';
import MemoryGemPopup from './MemoryGemPopup';
import MemoryGemComposer from './MemoryGemComposer';
import SoftFeatureBoundary from './SoftFeatureBoundary';
import AiBodyguardChat from './AiBodyguardChat';
import {
  buildRealtimeSystemBlock,
  reverseGeocodeLabel,
} from './aiContext';
import { getP2PSession } from './p2pSession';
import { isTrusted } from './trust';
import { loadContacts } from './contacts';

const ArFootprints = lazy(() =>
  import('./ArFootprints').catch((err) => {
    console.warn('[P2P Audit] ArFootprints module failed to load', err);
    return {
      default: function ArUnavailable({ onClose }: { gems: MapGem[]; onClose: () => void }) {
        return (
          <div className="ar-footprints soft-feature-fallback" role="dialog" aria-label="AR недоступен">
            <p>AR не поддерживается на этом устройстве.</p>
            <p className="hint">Используйте карту и звонки в обычном режиме.</p>
            <button type="button" className="ar-footprints-close" onClick={onClose}>
              Закрыть
            </button>
          </div>
        );
      },
    };
  })
);

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
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
  banned?: boolean;
  ghostMode: boolean;
  onGhostModeChange: (next: boolean) => void;
  /** Индикатор ошибки дозвона (toast по клику). */
  callAlertActive?: boolean;
  onCallAlertReveal?: () => void;
};

const FOCUS_ZOOM = 6.2;
const WORLD_ZOOM = 2.1;
/** Интервал двойного тапа/клика по маркеру (ms). */
const MARKER_DOUBLE_TAP_MS = 300;

type MarkerTapHandlers = {
  onSingle: () => void;
  onDouble: () => void;
};

function buildMarkerElement(
  person: MapPerson,
  selected: boolean,
  handlers: MarkerTapHandlers
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
  btn.title = person.isMe
    ? 'Вы на карте'
    : 'Тап — чат · двойной тап — видеозвонок';
  btn.style.setProperty('--marker-color', person.color || '#60a5fa');
  btn.style.touchAction = 'manipulation';

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

  let lastTapAt = 0;
  let lastDoubleAt = 0;
  let singleTimer: ReturnType<typeof setTimeout> | null = null;
  /** После touch-двойного тапа глушим следующий click (ghost click). */
  let suppressClickUntil = 0;

  const clearSingleTimer = () => {
    if (singleTimer != null) {
      clearTimeout(singleTimer);
      singleTimer = null;
    }
  };

  const fireDouble = () => {
    const now = Date.now();
    if (now - lastDoubleAt < 450) return;
    lastDoubleAt = now;
    clearSingleTimer();
    lastTapAt = 0;
    handlers.onDouble();
  };

  const handleTap = (fromTouch: boolean) => {
    const now = Date.now();
    if (fromTouch) suppressClickUntil = now + 500;
    if (now - lastTapAt < MARKER_DOUBLE_TAP_MS) {
      fireDouble();
      return;
    }
    lastTapAt = now;
    clearSingleTimer();
    singleTimer = setTimeout(() => {
      singleTimer = null;
      if (lastTapAt === now) handlers.onSingle();
    }, MARKER_DOUBLE_TAP_MS);
  };

  btn.addEventListener(
    'touchend',
    (e) => {
      // Надёжный двойной тап на мобилках (до ghost click).
      e.preventDefault();
      e.stopPropagation();
      handleTap(true);
    },
    { passive: false }
  );

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() < suppressClickUntil) return;
    handleTap(false);
  });

  btn.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    suppressClickUntil = Date.now() + 500;
    fireDouble();
  });

  return btn;
}

export default function GlobeLobby({
  onBack,
  people,
  geoSource,
  onCallUser,
  onChatUser,
  isAdmin = false,
  onOpenAdmin,
  banned = false,
  ghostMode,
  onGhostModeChange,
  callAlertActive = false,
  onCallAlertReveal,
}: GlobeLobbyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const selectedIdRef = useRef<string | null>(null);
  const peopleRef = useRef(people);
  const onChatUserRef = useRef(onChatUser);
  const onCallUserRef = useRef(onCallUser);
  const openGemRef = useRef<(gem: MapGem) => void>(() => undefined);

  peopleRef.current = people;
  onChatUserRef.current = onChatUser;
  onCallUserRef.current = onCallUser;

  const [mapReady, setMapReady] = useState(false);
  const [mapBootDone, setMapBootDone] = useState(false);
  const [splashGone, setSplashGone] = useState(false);
  const [tokenMissing, setTokenMissing] = useState(false);
  const [selected, setSelected] = useState<MapPerson | null>(null);
  const [focusedContactId, setFocusedContactId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(WORLD_ZOOM);
  const [gems, setGems] = useState<MapGem[]>([]);
  const [openedGem, setOpenedGem] = useState<MapGem | null>(null);
  /** Точка long-press / Drop a Gem. */
  const [dropPoint, setDropPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [isTargetingMode, setIsTargetingMode] = useState(false);
  const [showContacts, setShowContacts] = useState(true);
  const [showGems, setShowGems] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [arOpen, setArOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const ghostMarkerRef = useRef<mapboxgl.Marker | null>(null);

  openGemRef.current = (gem) => setOpenedGem(gem);

  const contacts = useMemo(
    () => people.filter((p) => p.isContact && !p.isMe),
    [people]
  );

  const me = useMemo(() => people.find((p) => p.isMe), [people]);

  /** Empty Style: только Family contacts (+ вы), без незнакомцев. */
  const visiblePeople = useMemo(() => {
    if (!showContacts) {
      return me ? [me] : [];
    }
    return people.filter((p) => p.isMe || p.isContact);
  }, [people, showContacts, me]);

  const authorLabel = (authorId: string) => {
    const person = peopleRef.current.find((p) => p.userId === authorId);
    if (person?.isMe) return 'Вы';
    return person?.name || authorId.slice(0, 10);
  };

  selectedIdRef.current = selected?.userId ?? null;

  /** Плавный flyTo к GPS (или Антарктиде при Ghost Mode). */
  const flyToPerson = (person: MapPerson, openCard = false) => {
    const map = mapRef.current;
    if (!map) return;
    if (openCard && !person.isMe) setSelected(person);
    setFocusedContactId(person.userId);

    const atAntarctica =
      Math.abs(person.lat - ANTARCTICA.lat) < 0.6 &&
      Math.abs(person.lng - ANTARCTICA.lng) < 0.6;

    map.flyTo({
      center: [person.lng, person.lat],
      zoom: atAntarctica
        ? Math.max(map.getZoom(), 4.2)
        : Math.max(map.getZoom(), FOCUS_ZOOM),
      duration: 2200,
      essential: true,
      curve: 1.6,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      padding: { top: 100, bottom: 200, left: 48, right: 48 },
    });
  };

  const resolvePerson = (userId: string): MapPerson | undefined =>
    peopleRef.current.find((p) => p.userId === userId);

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
        style: MAPBOX_STANDARD_STYLE_WITH_CONFIG,
        center,
        zoom: WORLD_ZOOM,
        pitch: 42,
        bearing: -12,
        antialias: true,
        fadeDuration: 0,
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
      ghostMarkerRef.current?.remove();
      ghostMarkerRef.current = null;
      for (const marker of markersRef.current.values()) marker.remove();
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      setMapBootDone(false);
      setSplashGone(false);
    };
    // me только для стартового центра при первом маунте
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Тёмный splash до полного рендера карты на координатах пользователя. */
  const bootFinalizedRef = useRef(false);
  useEffect(() => {
    if (!mapReady || tokenMissing) return;
    if (geoSource === 'pending') return;

    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;
    let moveEndHandler: (() => void) | null = null;
    let idleHandler: (() => void) | null = null;

    const finalize = () => {
      if (cancelled || bootFinalizedRef.current) return;
      bootFinalizedRef.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setMapBootDone(true);
        });
      });
    };

    const waitIdle = () => {
      if (cancelled) return;
      idleHandler = () => {
        map.off('idle', idleHandler!);
        finalize();
      };
      map.once('idle', idleHandler);
    };

    if (geoSource === 'gps' && me) {
      moveEndHandler = () => {
        map.off('moveend', moveEndHandler!);
        waitIdle();
      };
      map.flyTo({
        center: [me.lng, me.lat],
        zoom: 4.5,
        speed: 0.9,
        essential: true,
      });
      map.once('moveend', moveEndHandler);
    } else {
      waitIdle();
    }

    return () => {
      cancelled = true;
      if (moveEndHandler) map.off('moveend', moveEndHandler);
      if (idleHandler) map.off('idle', idleHandler);
    };
  }, [mapReady, geoSource, me, tokenMissing]);

  /** Синхронизация HTML-маркеров аватарок (только Family / контакты). */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const nextIds = new Set(visiblePeople.map((p) => p.userId));

    for (const [id, marker] of markersRef.current) {
      if (!nextIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const person of visiblePeople) {
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

      const el = buildMarkerElement(person, selectedNow, {
        onSingle: () => {
          const current = resolvePerson(person.userId) ?? person;
          if (current.isMe) {
            flyToPerson(current, false);
            return;
          }
          setSelected(null);
          onChatUserRef.current(current);
        },
        onDouble: () => {
          const current = resolvePerson(person.userId) ?? person;
          if (current.isMe) {
            flyToPerson(current, false);
            return;
          }
          setSelected(null);
          onCallUserRef.current(current);
        },
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([person.lng, person.lat])
        .addTo(map);

      markersRef.current.set(person.userId, marker);
    }
  }, [visiblePeople, mapReady, selected]);

  /** Слои Memory Gems + клики (кластер / распаковка) + пульсация. */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const attach = () => {
      try {
        ensureGemLayers(map);
        setGemFeatures(map, gems);
        setGemsLayerVisibility(map, showGems);
      } catch (e) {
        console.warn('[paranoic gems] layers', e);
      }
    };

    attach();
    const onStyle = () => attach();
    map.on('style.load', onStyle);
    const unbind = bindGemInteractions(map, (gem) => {
      if (!showGems) return;
      openGemRef.current(gem);
    });
    const stopPulse = showGems ? startGemPulse(map) : () => undefined;

    return () => {
      map.off('style.load', onStyle);
      unbind();
      stopPulse();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, showGems]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    try {
      ensureGemLayers(map);
      setGemFeatures(map, gems);
      setGemsLayerVisibility(map, showGems);
    } catch (e) {
      console.warn('[paranoic gems] setData', e);
    }
  }, [gems, mapReady, showGems]);

  /** Загрузка всех map_gems при инициализации карты. */
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;
    void (async () => {
      const rows = await fetchAllMapGems();
      if (!cancelled) setGems(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady]);

  /** Ghost-маркер в точке long-press. */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (!dropPoint) {
      ghostMarkerRef.current?.remove();
      ghostMarkerRef.current = null;
      return;
    }

    if (!ghostMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'memory-gem-ghost';
      el.innerHTML =
        '<span class="memory-gem-ghost-ring"></span><span class="memory-gem-ghost-core"></span>';
      ghostMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([dropPoint.lng, dropPoint.lat])
        .addTo(map);
    } else {
      ghostMarkerRef.current.setLngLat([dropPoint.lng, dropPoint.lat]);
    }
  }, [dropPoint, mapReady]);

  /** Long-press / contextmenu → Drop a Gem. */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || banned) return;

    const LONG_MS = 560;
    const MOVE_PX = 12;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;
    let startLngLat: { lng: number; lat: number } | null = null;

    const clearPress = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      startLngLat = null;
    };

    const openDrop = (lng: number, lat: number) => {
      if (banned) return;
      clearPress();
      setIsTargetingMode(false);
      setOpenedGem(null);
      setSelected(null);
      setDropPoint({ lat, lng });
    };

    const onContextMenu = (e: mapboxgl.MapMouseEvent) => {
      e.preventDefault();
      openDrop(e.lngLat.lng, e.lngLat.lat);
    };

    const onPointerDown = (e: mapboxgl.MapMouseEvent | mapboxgl.MapTouchEvent) => {
      const oe = e.originalEvent as MouseEvent | TouchEvent;
      if ('button' in oe && oe.button !== 0) return;
      // Не перехватываем клики по UI-кнопкам поверх карты.
      const target = oe.target as HTMLElement | null;
      if (target?.closest?.('button, a, .mapboxgl-ctrl, .map-avatar-marker')) return;

      const point =
        'point' in e
          ? e.point
          : { x: 0, y: 0 };
      startX = point.x;
      startY = point.y;
      startLngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      clearPress();
      timer = setTimeout(() => {
        if (!startLngLat) return;
        openDrop(startLngLat.lng, startLngLat.lat);
      }, LONG_MS);
    };

    const onPointerMove = (e: mapboxgl.MapMouseEvent | mapboxgl.MapTouchEvent) => {
      if (!startLngLat || timer == null) return;
      const dx = e.point.x - startX;
      const dy = e.point.y - startY;
      if (dx * dx + dy * dy > MOVE_PX * MOVE_PX) clearPress();
    };

    map.on('contextmenu', onContextMenu);
    map.on('mousedown', onPointerDown);
    map.on('touchstart', onPointerDown);
    map.on('mousemove', onPointerMove);
    map.on('touchmove', onPointerMove);
    map.on('mouseup', clearPress);
    map.on('touchend', clearPress);
    map.on('dragstart', clearPress);

    return () => {
      clearPress();
      map.off('contextmenu', onContextMenu);
      map.off('mousedown', onPointerDown);
      map.off('touchstart', onPointerDown);
      map.off('mousemove', onPointerMove);
      map.off('touchmove', onPointerMove);
      map.off('mouseup', clearPress);
      map.off('touchend', clearPress);
      map.off('dragstart', clearPress);
    };
  }, [mapReady, banned]);

  const closeComposer = () => {
    setDropPoint(null);
    ghostMarkerRef.current?.remove();
    ghostMarkerRef.current = null;
  };

  const exitTargetingMode = () => setIsTargetingMode(false);

  const confirmTargetDrop = () => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    setIsTargetingMode(false);
    setOpenedGem(null);
    setSelected(null);
    setDropPoint({ lat: center.lat, lng: center.lng });
  };

  const nudgeZoom = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      zoom: Math.min(18, Math.max(1.2, map.getZoom() + delta)),
      duration: 320,
      essential: true,
    });
  };

  const collectSituationContext = async () => {
    const map = mapRef.current;
    const bounds = map?.getBounds() ?? null;
    const gemsContext = buildVisibleGemsContext(gems, {
      showGems,
      inBounds: bounds
        ? (lat, lng) => bounds.contains([lng, lat])
        : undefined,
    });

    const snapshot = peopleRef.current;
    const self = snapshot.find((p) => p.isMe);
    const byId = new Map<
      string,
      { id: string; name: string; online: boolean; trusted?: boolean }
    >();
    for (const p of snapshot) {
      if (p.isMe || !p.isContact) continue;
      byId.set(p.userId, {
        id: p.userId,
        name: p.name,
        online: Boolean(p.online),
        trusted: isTrusted(p.userId),
      });
    }
    try {
      const book = await loadContacts();
      for (const c of book) {
        const prev = byId.get(c.id);
        byId.set(c.id, {
          id: c.id,
          name: c.name || prev?.name || 'Контакт',
          online: prev?.online ?? false,
          trusted: Boolean(c.trusted) || isTrusted(c.id) || prev?.trusted,
        });
      }
    } catch {
      /* книжка недоступна — остаёмся на presence */
    }
    const contactRows = [...byId.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'ru')
    );

    let placeLabel: string | null = null;
    if (
      self &&
      !ghostMode &&
      geoSource === 'gps' &&
      Number.isFinite(self.lat) &&
      Number.isFinite(self.lng)
    ) {
      placeLabel = await reverseGeocodeLabel(self.lat, self.lng);
    }

    const live = getP2PSession();

    return buildRealtimeSystemBlock({
      lat: self?.lat ?? null,
      lng: self?.lng ?? null,
      geoSource,
      ghostMode,
      placeLabel,
      contacts: contactRows,
      gemsContext,
      p2pStatus: live?.currentStatus ?? null,
      callState: live?.currentCallState ?? null,
    });
  };

  const geoHint =
    geoSource === 'gps'
      ? 'Ваша точка — по GPS'
      : geoSource === 'antarctica'
        ? 'Ghost Mode / без GPS — условная Антарктида'
        : 'Запрашиваем геолокацию…';

  return (
    <div className="family-map-root absolute inset-0 h-full w-full overflow-hidden bg-[#03050a] font-[Nunito,system-ui,sans-serif] text-slate-200">
      <div
        ref={containerRef}
        className={`family-mapbox absolute inset-0 h-full w-full${mapBootDone ? ' is-visible' : ''}`}
        style={{ width: '100%', height: '100%', minHeight: '100vh' }}
      />

      {!tokenMissing && !splashGone && (
        <div
          className={`map-boot-splash${mapBootDone ? ' is-hiding' : ''}`}
          aria-hidden={mapBootDone}
          onTransitionEnd={(e) => {
            if (e.propertyName === 'opacity' && mapBootDone) setSplashGone(true);
          }}
        >
          <ParanoicLogo size={72} compact className="map-boot-splash__logo" />
          <span className="map-boot-splash__spinner" aria-hidden />
        </div>
      )}

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
        <header className="pointer-events-auto relative flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[20px] transition hover:bg-white/15"
          >
            <ArrowLeft size={16} /> Назад
          </button>
          {callAlertActive && (
            <button
              type="button"
              className="map-call-alert-btn"
              aria-label="Показать уведомление о звонке"
              title="Проблема с дозвоном"
              onClick={() => onCallAlertReveal?.()}
            >
              <PhoneOff size={17} strokeWidth={2.2} />
            </button>
          )}
          <div className="relative flex items-center gap-2">
            {isAdmin && onOpenAdmin && (
              <button
                type="button"
                onClick={onOpenAdmin}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-extrabold text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[20px] transition hover:bg-white/15"
              >
                <ShieldCheck size={14} /> Admin Panel
              </button>
            )}
            <button
              type="button"
              className={`map-layers-btn${layersOpen ? ' open' : ''}`}
              aria-expanded={layersOpen}
              aria-label="Слои карты"
              onClick={() => setLayersOpen((v) => !v)}
            >
              <Layers size={16} />
              Слои
            </button>
            {layersOpen && (
              <div className="map-layers-menu" role="menu">
                <p className="map-layers-menu-title">Слои карты</p>
                <label className="map-layers-toggle">
                  <span>Контакты</span>
                  <input
                    type="checkbox"
                    checked={showContacts}
                    onChange={(e) => setShowContacts(e.target.checked)}
                  />
                  <span className="map-layers-switch" aria-hidden />
                </label>
                <label className="map-layers-toggle">
                  <span>Капсулы памяти</span>
                  <input
                    type="checkbox"
                    checked={showGems}
                    onChange={(e) => setShowGems(e.target.checked)}
                  />
                  <span className="map-layers-switch" aria-hidden />
                </label>
                <label className="map-layers-toggle">
                  <span className="inline-flex items-center gap-1.5">
                    <Ghost size={13} /> Режим Антарктиды
                  </span>
                  <input
                    type="checkbox"
                    checked={ghostMode}
                    onChange={(e) => onGhostModeChange(e.target.checked)}
                  />
                  <span className="map-layers-switch" aria-hidden />
                </label>
              </div>
            )}
            <div className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[20px]">
              Family Mode
            </div>
          </div>
        </header>

        {banned && (
          <div className="map-banned-banner pointer-events-auto">
            Аккаунт заблокирован — звонки и чат с карты недоступны.
          </div>
        )}

        <div className="pointer-events-none mt-2 px-4 text-center sm:px-6">
          <p className="mx-auto max-w-md text-sm text-slate-300/90 sm:text-base">
            {isTargetingMode
              ? 'Двигайте карту — прицел в центре покажет место капсулы'
              : `Чистая карта · контакты Family Mode${showGems ? ' · капсулы включены' : ''}`}
          </p>
          {!isTargetingMode && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md">
              <MapPin size={12} /> {geoHint}
              {showGems && gems.length > 0 && (
                <span className="ml-1 text-amber-200/90">· {gems.length} капсул</span>
              )}
            </p>
          )}
        </div>

        <div className="map-chrome-bottom pointer-events-auto mt-auto flex flex-col gap-3 px-4 sm:px-6">
          {isTargetingMode ? (
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                className="gem-target-confirm"
                onClick={confirmTargetDrop}
              >
                <Gem size={18} />
                Поставить метку здесь
              </button>
              <button
                type="button"
                className="gem-target-cancel"
                onClick={exitTargetingMode}
              >
                Отмена
              </button>
            </div>
          ) : (
            <>
          {contacts.length > 0 && showContacts && (
            <div className="overflow-x-auto rounded-2xl border border-white/15 bg-white/[0.07] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-[18px]">
              <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Близкие
              </p>
              <div className="flex gap-3">
                {contacts.map((c) => (
                  <button
                    key={c.userId}
                    type="button"
                    className={`flex w-16 shrink-0 flex-col items-center gap-1.5 rounded-xl p-1 transition ${
                      focusedContactId === c.userId
                        ? 'bg-white/15 ring-1 ring-white/30'
                        : 'hover:bg-white/10'
                    }`}
                    onClick={() => {
                      // Плавный перелёт камеры к GPS / Антарктиде (Ghost Mode).
                      flyToPerson(c, false);
                    }}
                    aria-label={`Показать ${c.name} на карте`}
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

          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="memory-gem-fab pointer-events-auto"
                disabled={banned}
                onClick={() => {
                  setLayersOpen(false);
                  setIsTargetingMode(true);
                }}
                title="Выбрать место для Pin Memory"
              >
                <Gem size={16} />
                Pin Memory
              </button>
              <button
                type="button"
                className="ai-radar-fab pointer-events-auto"
                onClick={() => {
                  setLayersOpen(false);
                  setAiOpen(true);
                }}
                aria-label="ИИ-телохранитель"
                title="ИИ-телохранитель"
              >
                <Radar size={18} />
                Секретарь
              </button>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button
                type="button"
                className="ar-fab"
                onClick={() => setArOpen(true)}
                aria-label="AR Footprints"
                title="Дополненная реальность"
              >
                <Box size={22} />
                <span>AR</span>
              </button>
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
            </>
          )}
        </div>
      </div>

      {isTargetingMode && (
        <div className="gem-crosshair" aria-hidden>
          <span className="gem-crosshair-ring" />
          <span className="gem-crosshair-core" />
          <span className="gem-crosshair-h" />
          <span className="gem-crosshair-v" />
        </div>
      )}

      {arOpen && (
        <SoftFeatureBoundary
          name="AR Footprints"
          fallback={
            <div className="ar-footprints soft-feature-fallback" role="status">
              <p>AR недоступен. Продолжайте в базовом режиме.</p>
              <button type="button" className="ar-footprints-close" onClick={() => setArOpen(false)}>
                Закрыть
              </button>
            </div>
          }
        >
          <Suspense
            fallback={
              <div className="ar-footprints soft-feature-fallback" role="status">
                Загрузка AR…
              </div>
            }
          >
            <ArFootprints gems={gems} onClose={() => setArOpen(false)} />
          </Suspense>
        </SoftFeatureBoundary>
      )}

      {aiOpen && (
        <AiBodyguardChat
          collectSituationContext={collectSituationContext}
          onClose={() => setAiOpen(false)}
        />
      )}

      {openedGem && (
        <MemoryGemPopup
          gem={openedGem}
          authorLabel={authorLabel(openedGem.author_id)}
          onClose={() => setOpenedGem(null)}
        />
      )}

      {dropPoint && (
        <MemoryGemComposer
          lat={dropPoint.lat}
          lng={dropPoint.lng}
          onClose={closeComposer}
          onCreated={(gem) => {
            setGems((prev) => [gem, ...prev]);
            closeComposer();
          }}
        />
      )}

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
