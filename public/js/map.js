/**
 * Mapa Leaflet: campus ISER, perímetro y bloques.
 * 🗺️ Multi-sede con GeoJSON diferenciado + selector de mapas base.
 * Emite MAP_READY para plugins (capas SIG).
 */
import { getCampusData, getSedeConfig } from './campus-data.js';
import { emit, EVENTS, on } from './core/events.js';
import { state } from './core/state.js';

let map = null;
let perimetroPolygon = null;
const mapPolygons = {};

// Capa de polígonos de la sede actual (para limpieza al cambiar)
let currentSedeLayerGroup = null;

function formatArea(area) {
  const num = Number(area);
  if (!Number.isFinite(num)) return '--';
  return num.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function getMap() {
  return map;
}

export function getPerimetroPolygon() {
  return perimetroPolygon;
}

export function getMapPolygons() {
  return mapPolygons;
}

/**
 * Resalta un bloque en el mapa y centra la vista.
 */
export function highlightBlock(id, currentBlockId) {
  const sedeConfig = getSedeConfig(state.currentSede || 'pamplona');
  const blocks = sedeConfig.blocks || {};
  Object.entries(mapPolygons).forEach(([polyId, poly]) => {
    // Determine the baseline color from Firestore or fallback to campusData
    const blockStateColor = state.estadosBloques?.[polyId]?.color_sugerido;
    const baseColor = blockStateColor || blocks[polyId]?.color || '#FFFFFF';

    if (polyId === id) {
      poly.setStyle({ fillOpacity: 0.8, weight: 3, color: '#FFFFFF', fillColor: baseColor });
      if (map) map.flyToBounds(poly.getBounds(), { padding: [40, 40], maxZoom: 20, duration: 0.5 });
    } else {
      if (blocks[polyId]) {
        poly.setStyle({ fillOpacity: 0.35, weight: 2, color: baseColor, fillColor: baseColor });
      }
    }
  });
}

/**
 * Restaura estilos de todos los polígonos al estado por defecto.
 */
export function resetBlockStyles() {
  const sedeConfig = getSedeConfig(state.currentSede || 'pamplona');
  const blocks = sedeConfig.blocks || {};
  Object.entries(mapPolygons).forEach(([polyId, poly]) => {
    const blockData = blocks[polyId];
    if (blockData) {
      const blockStateColor = state.estadosBloques?.[polyId]?.color_sugerido;
      const baseColor = blockStateColor || blockData.color;
      poly.setStyle({ fillOpacity: 0.35, weight: 2, color: baseColor, fillColor: baseColor });
    }
  });
}

/**
 * Inicializa el mapa Leaflet y registra el callback al hacer clic en un bloque.
 */
export function initLeafletMap(onBlockSelect) {
  if (typeof L === 'undefined') {
    setTimeout(() => initLeafletMap(onBlockSelect), 50);
    return;
  }

  // ─── Almacenar callback de selección para uso en switchSede ───
  _onBlockSelectCallback = onBlockSelect;

  const sedeConfig = getSedeConfig('pamplona');
  map = L.map('map', { maxZoom: 22 }).setView(sedeConfig.center, sedeConfig.zoom);

  // ═══════════════════════════════════════════════════════
  // 🌐 SELECTOR DE MAPAS BASE (Layers Control)
  // ═══════════════════════════════════════════════════════
  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 22,
    maxNativeZoom: 19
  });

  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri World Imagery',
    maxZoom: 22,
    maxNativeZoom: 19
  });

  const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenTopoMap',
    maxZoom: 22,
    maxNativeZoom: 17
  });

  const googleSatellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    attribution: '&copy; Google Maps',
    maxZoom: 22,
    maxNativeZoom: 20
  });

  // Agregar la capa base por defecto (Google Satélite)
  googleSatellite.addTo(map);

  // Control de capas base
  const baseLayers = {
    '🗺️ Mapa (OSM)': osmLayer,
    '🛰️ Satélite (Google)': googleSatellite,
    '🛰️ Satélite (Esri)': satelliteLayer,
    '🏔️ Topográfico': topoLayer
  };

  L.control.layers(baseLayers, null, {
    position: 'bottomright',
    collapsed: true
  }).addTo(map);

  // ─── Dibujar sede inicial (Pamplona) ───
  _drawSede('pamplona', onBlockSelect);

  // Escuchar a cambios de estado de bloques desde Firestore
  on('ESTADOS_BLOQUES_CHANGED', () => {
    if (state.currentBlockId) {
      highlightBlock(state.currentBlockId, state.currentBlockId);
    } else {
      resetBlockStyles();
    }
  });

  emit(EVENTS.MAP_READY, map);
}

// ═══════════════════════════════════════════════════════
// 🗺️ SWITCH SEDE — Limpia y redibuja polígonos + flyTo
// ═══════════════════════════════════════════════════════
let _onBlockSelectCallback = null;

/**
 * Cambia la sede visualizada en el mapa.
 * Limpia polígonos anteriores, dibuja los nuevos, y ejecuta flyTo.
 * @param {string} sedeId - 'pamplona' | 'rinconada' | 'caldera'
 */
export function switchSede(sedeId) {
  if (!map) return;

  const sedeConfig = getSedeConfig(sedeId);

  // 1. Limpiar polígonos anteriores
  _clearCurrentSede();

  // 2. Dibujar nueva sede
  _drawSede(sedeId, _onBlockSelectCallback);

  // 3. 🚁 Vuelo de cámara
  map.flyTo(sedeConfig.center, sedeConfig.zoom, { duration: 1.5 });
}

/**
 * Limpia todos los polígonos y capas de la sede actual.
 */
function _clearCurrentSede() {
  // Limpiar perímetro
  if (perimetroPolygon) {
    map.removeLayer(perimetroPolygon);
    perimetroPolygon = null;
  }

  // Limpiar bloques
  Object.keys(mapPolygons).forEach(id => {
    map.removeLayer(mapPolygons[id]);
    delete mapPolygons[id];
  });

  // Limpiar layer group adicional
  if (currentSedeLayerGroup) {
    map.removeLayer(currentSedeLayerGroup);
    currentSedeLayerGroup = null;
  }
}

/**
 * Dibuja los polígonos de una sede en el mapa.
 */
function _drawSede(sedeId, onBlockSelect) {
  const sedeConfig = getSedeConfig(sedeId);

  // ─── Dibujar Perímetro ───
  if (sedeConfig.perimetro && sedeConfig.perimetro.length > 0) {
    const pStyle = sedeConfig.perimetroStyle || {
      color: '#FDE047', weight: 3, dashArray: '10, 8',
      fillColor: '#FDE047', fillOpacity: 0.05
    };

    perimetroPolygon = L.polygon(sedeConfig.perimetro, {
      ...pStyle,
      interactive: sedeConfig.type === 'perimeter' // Interactivo solo si es tipo perímetro (para tooltip)
    }).addTo(map);

    // Si es tipo "perimeter" (ej: Rinconada) — solo tooltip, sin clic al visor
    if (sedeConfig.type === 'perimeter' && sedeConfig.tooltipText) {
      perimetroPolygon.bindTooltip(
        `<div class="text-xs font-semibold" style="color:#ff9800;">${sedeConfig.tooltipText}</div>`,
        { direction: 'center', permanent: false, sticky: true, opacity: 0.95, className: 'custom-tooltip' }
      );
    }
  }

  // ─── Dibujar Bloques ───
  const blocks = sedeConfig.blocks || {};
  for (const [id, data] of Object.entries(blocks)) {
    if (!data.coords || data.coords.length === 0) continue;

    const blockStateColor = state.estadosBloques?.[id]?.color_sugerido;
    const baseColor = blockStateColor || data.color;

    const polygon = L.polygon(data.coords, {
      color: baseColor,
      weight: 2,
      fillColor: baseColor,
      fillOpacity: 0.35
    }).addTo(map);

    const area = formatArea(data?.info?.area);
    polygon.bindTooltip(
      `<div class="text-xs font-semibold">${data.name}</div><div class="text-[11px] opacity-90">Área: ${area} m²</div>`,
      {
        direction: 'top',
        sticky: true,
        opacity: 0.95,
        className: 'custom-tooltip'
      }
    );

    polygon.on('click', (e) => {
      console.log("Clic detectado en bloque:", id, "coordenadas:", e?.latlng);
      onBlockSelect?.(id);
    });
    polygon.on('mouseover', function () {
      this.setStyle({ fillOpacity: 0.7, weight: 3 });
      this.openTooltip();
    });
    polygon.on('mouseout', function () {
      if (getCurrentBlockId() !== id) {
         const currentColor = state.estadosBloques?.[id]?.color_sugerido || data.color;
         this.setStyle({ fillOpacity: 0.35, weight: 2, color: currentColor, fillColor: currentColor });
      }
      this.closeTooltip();
    });
    mapPolygons[id] = polygon;
  }
}

// Referencia para mouseout (evitar import circular: map no debe importar state)
let getCurrentBlockId = () => null;
export function setGetCurrentBlockId(fn) {
  getCurrentBlockId = fn;
}
