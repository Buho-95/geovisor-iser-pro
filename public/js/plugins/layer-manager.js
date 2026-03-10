/**
 * Gestor de capas SIG. Preparado para GeoJSON, WMS, WMTS.
 * Se registra cuando el mapa está listo (evento map:ready).
 */
import { on, emit, EVENTS } from '../core/events.js';
import { state } from '../core/state.js';

const layers = new Map();
let mapInstance = null;

/**
 * Tipos de capa soportados (extensible).
 */
export const LAYER_TYPES = {
  GEOJSON: 'geojson',
  WMS: 'wms',
  WMTS: 'wmts',
  KML: 'kml'
};

/**
 * Inicializa el layer manager cuando el mapa está listo.
 */
export function init() {
  on(EVENTS.MAP_READY, (map) => {
    mapInstance = map;
  });
}

/**
 * Añade una capa al mapa.
 * @param {string} id - Identificador único
 * @param {object} options - { type, url, style?, name?, visible? }
 * @returns {L.Layer|null} - Capa Leaflet o null si el mapa no está listo
 */
export function addLayer(id, options = {}) {
  if (!mapInstance || typeof L === 'undefined') return null;

  if (layers.has(id)) {
    removeLayer(id);
  }

  const { type, url, style = {}, name = id } = options;
  let layer = null;

  try {
    switch (type) {
      case LAYER_TYPES.GEOJSON:
        layer = L.geoJSON(null, { style: () => style }).addTo(mapInstance);
        fetch(url).then(r => r.json()).then(data => layer.addData(data));
        break;
      case LAYER_TYPES.WMS:
        layer = L.tileLayer.wms(url, {
          layers: options.layers || '',
          format: 'image/png',
          transparent: true,
          ...options.wmsOptions
        }).addTo(mapInstance);
        break;
      case LAYER_TYPES.WMTS:
        layer = L.tileLayer(url, options.tileOptions || {}).addTo(mapInstance);
        break;
      default:
        console.warn(`[LayerManager] Tipo no soportado: ${type}`);
        return null;
    }

    if (layer) {
      layer._layerId = id;
      layer._layerName = name;
      layers.set(id, { layer, options });
      state.capasActivas.add(id);
      emit(EVENTS.LAYER_TOGGLE, { id, visible: true });
    }
  } catch (e) {
    console.error('[LayerManager] Error añadiendo capa:', e);
  }

  return layer;
}

/**
 * Elimina una capa.
 */
export function removeLayer(id) {
  const entry = layers.get(id);
  if (entry) {
    mapInstance?.removeLayer(entry.layer);
    layers.delete(id);
    state.capasActivas.delete(id);
    emit(EVENTS.LAYER_TOGGLE, { id, visible: false });
  }
}

/**
 * Muestra u oculta una capa.
 */
export function toggleLayer(id, visible) {
  const entry = layers.get(id);
  if (!entry) return;
  if (visible) {
    entry.layer.addTo(mapInstance);
    state.capasActivas.add(id);
  } else {
    mapInstance.removeLayer(entry.layer);
    state.capasActivas.delete(id);
  }
  emit(EVENTS.LAYER_TOGGLE, { id, visible });
}

/**
 * Lista capas registradas.
 */
export function getLayers() {
  return Array.from(layers.entries()).map(([id, { options }]) => ({
    id,
    name: options.name || id,
    type: options.type,
    visible: state.capasActivas.has(id)
  }));
}
