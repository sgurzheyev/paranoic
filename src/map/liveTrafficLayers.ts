/**
 * Mapbox Standard sources/layers for live planes and ships.
 * Layers sit in the `top` slot so they stay above the globe.
 */
import type { GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';
import {
  emptyTrafficGeoJSON,
  emptyTrailGeoJSON,
  FLIGHT_MARKER_COLOR,
  FLIGHT_TRAIL_COLOR,
  FLIGHT_TRAIL_CORE_COLOR,
  LIVE_FLIGHTS_CORE_LAYER_ID,
  LIVE_FLIGHTS_GLOW_LAYER_ID,
  LIVE_FLIGHTS_ICON_LAYER_ID,
  LIVE_FLIGHTS_LABEL_LAYER_ID,
  LIVE_FLIGHTS_SOURCE_ID,
  LIVE_FLIGHTS_TRAIL_GLOW_LAYER_ID,
  LIVE_FLIGHTS_TRAIL_LAYER_ID,
  LIVE_FLIGHTS_TRAILS_SOURCE_ID,
  LIVE_PLANE_IMAGE_ID,
  LIVE_SHIP_IMAGE_ID,
  LIVE_SHIPS_CORE_LAYER_ID,
  LIVE_SHIPS_GLOW_LAYER_ID,
  LIVE_SHIPS_ICON_LAYER_ID,
  LIVE_SHIPS_LABEL_LAYER_ID,
  LIVE_SHIPS_SOURCE_ID,
  LIVE_SHIPS_TRAIL_GLOW_LAYER_ID,
  LIVE_SHIPS_TRAIL_LAYER_ID,
  LIVE_SHIPS_TRAILS_SOURCE_ID,
  LIVE_TRAFFIC_SLOT,
  registerLiveTrafficImages,
  SHIP_MARKER_COLOR,
  SHIP_TRAIL_COLOR,
  SHIP_TRAIL_CORE_COLOR,
  type TrafficGeoJSON,
  type TrafficTrailGeoJSON,
} from './liveTraffic';

const FLIGHT_LAYER_IDS = [
  LIVE_FLIGHTS_TRAIL_GLOW_LAYER_ID,
  LIVE_FLIGHTS_TRAIL_LAYER_ID,
  LIVE_FLIGHTS_GLOW_LAYER_ID,
  LIVE_FLIGHTS_CORE_LAYER_ID,
  LIVE_FLIGHTS_ICON_LAYER_ID,
  LIVE_FLIGHTS_LABEL_LAYER_ID,
];

const SHIP_LAYER_IDS = [
  LIVE_SHIPS_TRAIL_GLOW_LAYER_ID,
  LIVE_SHIPS_TRAIL_LAYER_ID,
  LIVE_SHIPS_GLOW_LAYER_ID,
  LIVE_SHIPS_CORE_LAYER_ID,
  LIVE_SHIPS_ICON_LAYER_ID,
  LIVE_SHIPS_LABEL_LAYER_ID,
];

function removeLayers(map: MapboxMap, ids: string[]): void {
  for (const id of ids) {
    try {
      if (map.getLayer(id)) map.removeLayer(id);
    } catch {
      /* style swapping */
    }
  }
}

function removeSource(map: MapboxMap, id: string): void {
  try {
    if (map.getSource(id)) map.removeSource(id);
  } catch {
    /* style swapping */
  }
}

function setGeo(map: MapboxMap, id: string, data: TrafficGeoJSON | TrafficTrailGeoJSON): boolean {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (!source || typeof source.setData !== 'function') return false;
  source.setData(data);
  return true;
}

function addLayer(map: MapboxMap, spec: Record<string, unknown>): void {
  const id = String(spec.id || '');
  if (!id || map.getLayer(id)) return;
  try {
    map.addLayer(spec as unknown as Parameters<MapboxMap['addLayer']>[0]);
  } catch {
    if ('slot' in spec) {
      const { slot: _slot, ...rest } = spec;
      try {
        map.addLayer(rest as unknown as Parameters<MapboxMap['addLayer']>[0]);
      } catch {
        /* style not ready */
      }
    }
  }
}

const lineWidth = (a: number, b: number, c: number) => [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  a,
  8,
  b,
  12,
  c,
];

function addTrails(
  map: MapboxMap,
  sourceId: string,
  glowId: string,
  coreId: string,
  data: TrafficTrailGeoJSON,
  glow: string,
  core: string
): void {
  if (!setGeo(map, sourceId, data)) {
    map.addSource(sourceId, { type: 'geojson', data });
  }
  addLayer(map, {
    id: glowId,
    type: 'line',
    source: sourceId,
    slot: LIVE_TRAFFIC_SLOT,
    minzoom: 1.5,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': glow,
      'line-width': lineWidth(2.4, 5, 7),
      'line-opacity': 0.45,
      'line-blur': 1.4,
    },
  });
  addLayer(map, {
    id: coreId,
    type: 'line',
    source: sourceId,
    slot: LIVE_TRAFFIC_SLOT,
    minzoom: 1.5,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': core,
      'line-width': lineWidth(1.1, 1.8, 2.4),
      'line-opacity': 0.95,
    },
  });
}

function addCraft(
  map: MapboxMap,
  sourceId: string,
  data: TrafficGeoJSON,
  ids: {
    glow: string;
    core: string;
    icon: string;
    label: string;
  },
  colors: { glow: string; core: string; text: string; halo: string },
  imageId: string
): void {
  if (!setGeo(map, sourceId, data)) {
    map.addSource(sourceId, { type: 'geojson', data });
  }
  addLayer(map, {
    id: ids.glow,
    type: 'circle',
    source: sourceId,
    slot: LIVE_TRAFFIC_SLOT,
    minzoom: 1.5,
    paint: {
      'circle-radius': lineWidth(7, 12, 16),
      'circle-color': colors.glow,
      'circle-blur': 0.55,
      'circle-opacity': 0.42,
    },
  });
  addLayer(map, {
    id: ids.core,
    type: 'circle',
    source: sourceId,
    slot: LIVE_TRAFFIC_SLOT,
    minzoom: 1.5,
    paint: {
      'circle-radius': lineWidth(3.5, 5.5, 7),
      'circle-color': colors.core,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.95,
    },
  });
  addLayer(map, {
    id: ids.icon,
    type: 'symbol',
    source: sourceId,
    slot: LIVE_TRAFFIC_SLOT,
    minzoom: 1.5,
    layout: {
      'icon-image': imageId,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.55, 6, 0.8, 12, 1.05],
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  addLayer(map, {
    id: ids.label,
    type: 'symbol',
    source: sourceId,
    slot: LIVE_TRAFFIC_SLOT,
    minzoom: 6,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
      'text-offset': [0, 1.35],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': colors.text,
      'text-halo-color': colors.halo,
      'text-halo-width': 1.1,
    },
  });
}

export function clearLiveTrafficLayers(map: MapboxMap | null | undefined): void {
  if (!map) return;
  removeLayers(map, FLIGHT_LAYER_IDS);
  removeLayers(map, SHIP_LAYER_IDS);
  removeSource(map, LIVE_FLIGHTS_SOURCE_ID);
  removeSource(map, LIVE_FLIGHTS_TRAILS_SOURCE_ID);
  removeSource(map, LIVE_SHIPS_SOURCE_ID);
  removeSource(map, LIVE_SHIPS_TRAILS_SOURCE_ID);
}

export function syncLiveTrafficLayers(
  map: MapboxMap | null | undefined,
  opts: {
    showFlights: boolean;
    showShips: boolean;
    flights: TrafficGeoJSON;
    ships: TrafficGeoJSON;
    flightTrails: TrafficTrailGeoJSON;
    shipTrails: TrafficTrailGeoJSON;
  }
): void {
  if (!map) return;
  try {
    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) return;
  } catch {
    return;
  }
  registerLiveTrafficImages(map);

  if (!opts.showFlights) {
    removeLayers(map, FLIGHT_LAYER_IDS);
    removeSource(map, LIVE_FLIGHTS_SOURCE_ID);
    removeSource(map, LIVE_FLIGHTS_TRAILS_SOURCE_ID);
  } else {
    try {
      addTrails(
        map,
        LIVE_FLIGHTS_TRAILS_SOURCE_ID,
        LIVE_FLIGHTS_TRAIL_GLOW_LAYER_ID,
        LIVE_FLIGHTS_TRAIL_LAYER_ID,
        opts.flightTrails,
        FLIGHT_TRAIL_COLOR,
        FLIGHT_TRAIL_CORE_COLOR
      );
      addCraft(
        map,
        LIVE_FLIGHTS_SOURCE_ID,
        opts.flights,
        {
          glow: LIVE_FLIGHTS_GLOW_LAYER_ID,
          core: LIVE_FLIGHTS_CORE_LAYER_ID,
          icon: LIVE_FLIGHTS_ICON_LAYER_ID,
          label: LIVE_FLIGHTS_LABEL_LAYER_ID,
        },
        { glow: FLIGHT_TRAIL_COLOR, core: FLIGHT_MARKER_COLOR, text: '#dcfce7', halo: '#052e16' },
        LIVE_PLANE_IMAGE_ID
      );
    } catch {
      /* style busy */
    }
  }

  if (!opts.showShips) {
    removeLayers(map, SHIP_LAYER_IDS);
    removeSource(map, LIVE_SHIPS_SOURCE_ID);
    removeSource(map, LIVE_SHIPS_TRAILS_SOURCE_ID);
  } else {
    try {
      addTrails(
        map,
        LIVE_SHIPS_TRAILS_SOURCE_ID,
        LIVE_SHIPS_TRAIL_GLOW_LAYER_ID,
        LIVE_SHIPS_TRAIL_LAYER_ID,
        opts.shipTrails,
        SHIP_TRAIL_COLOR,
        SHIP_TRAIL_CORE_COLOR
      );
      addCraft(
        map,
        LIVE_SHIPS_SOURCE_ID,
        opts.ships,
        {
          glow: LIVE_SHIPS_GLOW_LAYER_ID,
          core: LIVE_SHIPS_CORE_LAYER_ID,
          icon: LIVE_SHIPS_ICON_LAYER_ID,
          label: LIVE_SHIPS_LABEL_LAYER_ID,
        },
        { glow: SHIP_TRAIL_COLOR, core: SHIP_MARKER_COLOR, text: '#ffedd5', halo: '#431407' },
        LIVE_SHIP_IMAGE_ID
      );
    } catch {
      /* style busy */
    }
  }
}

export function emptyTrafficBundle(): {
  flights: TrafficGeoJSON;
  ships: TrafficGeoJSON;
  flightTrails: TrafficTrailGeoJSON;
  shipTrails: TrafficTrailGeoJSON;
} {
  return {
    flights: emptyTrafficGeoJSON(),
    ships: emptyTrafficGeoJSON(),
    flightTrails: emptyTrailGeoJSON(),
    shipTrails: emptyTrailGeoJSON(),
  };
}
