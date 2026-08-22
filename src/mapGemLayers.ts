import type { Map as MapboxMap, GeoJSONSource, MapLayerMouseEvent } from 'mapbox-gl';
import { gemsToGeoJson, type MapGem } from './mapGems';

export const GEMS_SOURCE = 'map-gems';
export const GEMS_GLOW_LAYER = 'map-gems-glow';
export const GEMS_POINT_LAYER = 'map-gems-point';
export const GEMS_CLUSTER_LAYER = 'map-gems-clusters';
export const GEMS_CLUSTER_COUNT_LAYER = 'map-gems-cluster-count';

/** Приглушённое шампанское золото (Luxury Cyber-Dark). */
const GOLD = '#e2b714';
const GOLD_GLOW = 'rgba(226, 183, 20, 0.4)';
const GOLD_STROKE = 'rgba(245, 214, 110, 0.9)';

type GemPointGeom = { type: 'Point'; coordinates: [number, number] };

/** GeoJSON source + золотые circle/cluster слои (Mapbox clustering). */
export function ensureGemLayers(map: MapboxMap): void {
  if (map.getSource(GEMS_SOURCE)) return;

  map.addSource(GEMS_SOURCE, {
    type: 'geojson',
    data: gemsToGeoJson([]),
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 52,
  });

  // Blur-тень / свечение под точкой.
  map.addLayer({
    id: GEMS_GLOW_LAYER,
    type: 'circle',
    source: GEMS_SOURCE,
    filter: ['!', ['has', 'point_count']],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': GOLD_GLOW,
      'circle-radius': 18,
      'circle-blur': 0.9,
      'circle-opacity': 0.65,
    },
  });

  map.addLayer({
    id: GEMS_POINT_LAYER,
    type: 'circle',
    source: GEMS_SOURCE,
    filter: ['!', ['has', 'point_count']],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': GOLD,
      'circle-radius': 7,
      'circle-blur': 0.12,
      'circle-stroke-width': 2,
      'circle-stroke-color': GOLD_STROKE,
      'circle-opacity': 1,
    },
  });

  map.addLayer({
    id: GEMS_CLUSTER_LAYER,
    type: 'circle',
    source: GEMS_SOURCE,
    filter: ['has', 'point_count'],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': [
        'step',
        ['get', 'point_count'],
        '#e2b714',
        8,
        '#c99f10',
        25,
        '#b08a0c',
      ],
      'circle-radius': ['step', ['get', 'point_count'], 18, 8, 24, 25, 32],
      'circle-blur': 0.1,
      'circle-stroke-width': 2,
      'circle-stroke-color': GOLD_STROKE,
    },
  });

  map.addLayer({
    id: GEMS_CLUSTER_COUNT_LAYER,
    type: 'symbol',
    source: GEMS_SOURCE,
    filter: ['has', 'point_count'],
    layout: {
      visibility: 'none',
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 13,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#1a1200',
    },
  });
}

/** Показать / скрыть все слои капсул (Empty Style по умолчанию = none). */
export function setGemsLayerVisibility(map: MapboxMap, visible: boolean): void {
  const value = visible ? 'visible' : 'none';
  for (const id of [
    GEMS_GLOW_LAYER,
    GEMS_POINT_LAYER,
    GEMS_CLUSTER_LAYER,
    GEMS_CLUSTER_COUNT_LAYER,
  ]) {
    if (!map.getLayer(id)) continue;
    try {
      map.setLayoutProperty(id, 'visibility', value);
    } catch {
      /* */
    }
  }
}

export function setGemFeatures(map: MapboxMap, gems: MapGem[]): void {
  const source = map.getSource(GEMS_SOURCE) as GeoJSONSource | undefined;
  if (!source) return;
  source.setData(gemsToGeoJson(gems));
}

/** Период «дыхания» точек капсул. */
const BREATHE_PERIOD_MS = 5200;
/** Обновляем paint не чаще ~20 fps: анимация медленная, лишние кадры дают дрожь. */
const BREATHE_FRAME_MS = 50;

/**
 * Медленное дыхание золотых точек: радиус почти не меняется,
 * работает в основном мягкое свечение.
 */
export function startGemPulse(map: MapboxMap): () => void {
  let raf = 0;
  let lastPaint = 0;
  const start = performance.now();

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (now - lastPaint < BREATHE_FRAME_MS) return;
    if (!map.getLayer(GEMS_POINT_LAYER) || !map.getLayer(GEMS_GLOW_LAYER)) return;
    lastPaint = now;

    const t = ((now - start) / BREATHE_PERIOD_MS) % 1;
    const wave = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
    try {
      map.setPaintProperty(GEMS_POINT_LAYER, 'circle-radius', 6.6 + wave * 0.6);
      map.setPaintProperty(GEMS_GLOW_LAYER, 'circle-radius', 16 + wave * 3);
      map.setPaintProperty(GEMS_GLOW_LAYER, 'circle-opacity', 0.3 + wave * 0.16);
    } catch {
      /* style busy */
    }
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function bindGemInteractions(
  map: MapboxMap,
  onOpenGem: (gem: MapGem) => void
): () => void {
  const onClusterClick = (e: MapLayerMouseEvent) => {
    const feature = e.features?.[0] as
      | { geometry?: GemPointGeom; properties?: Record<string, unknown> }
      | undefined;
    if (!feature?.geometry || feature.geometry.type !== 'Point') return;
    const clusterId = feature.properties?.cluster_id;
    if (clusterId == null) return;
    const source = map.getSource(GEMS_SOURCE) as GeoJSONSource;
    source.getClusterExpansionZoom(Number(clusterId), (err, zoom) => {
      if (err || zoom == null) return;
      map.easeTo({
        center: feature.geometry!.coordinates,
        zoom,
        duration: 600,
      });
    });
  };

  const onPointClick = (e: MapLayerMouseEvent) => {
    const feature = e.features?.[0] as
      | { geometry?: GemPointGeom; properties?: Record<string, unknown> }
      | undefined;
    const p = feature?.properties;
    if (!p?.id || !feature?.geometry || feature.geometry.type !== 'Point') return;
    e.originalEvent.stopPropagation();
    onOpenGem({
      id: String(p.id),
      author_id: String(p.author_id ?? ''),
      lat: feature.geometry.coordinates[1],
      lng: feature.geometry.coordinates[0],
      type: p.type as MapGem['type'],
      media_url: p.media_url ? String(p.media_url) : null,
      content: p.content ? String(p.content) : null,
      created_at: String(p.created_at ?? ''),
    });
  };

  const enter = () => {
    map.getCanvas().style.cursor = 'pointer';
  };
  const leave = () => {
    map.getCanvas().style.cursor = '';
  };

  map.on('click', GEMS_CLUSTER_LAYER, onClusterClick);
  map.on('click', GEMS_POINT_LAYER, onPointClick);
  map.on('mouseenter', GEMS_CLUSTER_LAYER, enter);
  map.on('mouseleave', GEMS_CLUSTER_LAYER, leave);
  map.on('mouseenter', GEMS_POINT_LAYER, enter);
  map.on('mouseleave', GEMS_POINT_LAYER, leave);

  return () => {
    map.off('click', GEMS_CLUSTER_LAYER, onClusterClick);
    map.off('click', GEMS_POINT_LAYER, onPointClick);
    map.off('mouseenter', GEMS_CLUSTER_LAYER, enter);
    map.off('mouseleave', GEMS_CLUSTER_LAYER, leave);
    map.off('mouseenter', GEMS_POINT_LAYER, enter);
    map.off('mouseleave', GEMS_POINT_LAYER, leave);
  };
}
