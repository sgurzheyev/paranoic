import type { Map as MapboxMap, GeoJSONSource, MapLayerMouseEvent } from 'mapbox-gl';
import { gemsToGeoJson, type MapGem } from './mapGems';

export const GEMS_SOURCE = 'map-gems';
export const GEMS_GLOW_LAYER = 'map-gems-glow';
export const GEMS_POINT_LAYER = 'map-gems-point';
export const GEMS_CLUSTER_LAYER = 'map-gems-clusters';
export const GEMS_CLUSTER_COUNT_LAYER = 'map-gems-cluster-count';

const GOLD = 'rgba(255, 215, 0, 0.8)';
const GOLD_SOFT = 'rgba(255, 215, 0, 0.45)';
const GOLD_STROKE = 'rgba(255, 248, 200, 0.95)';

type GemPointGeom = { type: 'Point'; coordinates: [number, number] };

/** GeoJSON source + золотые circle/cluster слои. */
export function ensureGemLayers(map: MapboxMap): void {
  if (map.getSource(GEMS_SOURCE)) return;

  map.addSource(GEMS_SOURCE, {
    type: 'geojson',
    data: gemsToGeoJson([]),
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 52,
  });

  map.addLayer({
    id: GEMS_GLOW_LAYER,
    type: 'circle',
    source: GEMS_SOURCE,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': GOLD_SOFT,
      'circle-radius': 16,
      'circle-blur': 0.85,
      'circle-opacity': 0.55,
    },
  });

  map.addLayer({
    id: GEMS_POINT_LAYER,
    type: 'circle',
    source: GEMS_SOURCE,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': GOLD,
      'circle-radius': 7,
      'circle-blur': 0.35,
      'circle-stroke-width': 1.75,
      'circle-stroke-color': GOLD_STROKE,
      'circle-opacity': 0.95,
    },
  });

  map.addLayer({
    id: GEMS_CLUSTER_LAYER,
    type: 'circle',
    source: GEMS_SOURCE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step',
        ['get', 'point_count'],
        'rgba(255, 215, 0, 0.55)',
        8,
        'rgba(255, 196, 0, 0.65)',
        25,
        'rgba(255, 170, 0, 0.75)',
      ],
      'circle-radius': ['step', ['get', 'point_count'], 18, 8, 24, 25, 32],
      'circle-blur': 0.2,
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
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 13,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#1a1200',
    },
  });
}

export function setGemFeatures(map: MapboxMap, gems: MapGem[]): void {
  const source = map.getSource(GEMS_SOURCE) as GeoJSONSource | undefined;
  if (!source) return;
  source.setData(gemsToGeoJson(gems));
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
