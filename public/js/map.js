/**
 * Mapa Leaflet: campus ISER, perímetro y bloques.
 * Emite MAP_READY para plugins (capas SIG).
 */
import { getCampusData } from './campus-data.js';
import { emit, EVENTS } from './core/events.js';

let map = null;
let perimetroPolygon = null;
const mapPolygons = {};

const iserCenter = [7.3719, -72.6455];
const perimetroCoords = [[7.371003, -72.646601], [7.371118, -72.646402], [7.370813, -72.646159], [7.370791, -72.646131], [7.370874, -72.645977], [7.371062, -72.645297], [7.371254, -72.644596], [7.371564, -72.643950], [7.372066, -72.643161], [7.372669, -72.642252], [7.373628, -72.643181], [7.373147, -72.643978], [7.373362, -72.644271], [7.373871, -72.644822], [7.373482, -72.645198], [7.373208, -72.646014], [7.373087, -72.646295], [7.373085, -72.646324], [7.372502, -72.647164], [7.371686, -72.646522], [7.371246, -72.646612], [7.371164, -72.646733], [7.371003, -72.646601]];

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
 * @param {string} id - ID del bloque
 * @param {string|null} currentBlockId - ID del bloque actualmente seleccionado (para desresaltar otros)
 */
export function highlightBlock(id, currentBlockId) {
  const campusData = getCampusData();
  Object.entries(mapPolygons).forEach(([polyId, poly]) => {
    if (polyId === id) {
      poly.setStyle({ fillOpacity: 0.8, weight: 3, color: '#FFFFFF' });
      if (map) map.flyToBounds(poly.getBounds(), { padding: [40, 40], maxZoom: 20, duration: 0.5 });
    } else {
      poly.setStyle({ fillOpacity: 0.35, weight: 2, color: campusData[polyId].color });
    }
  });
}

/**
 * Restaura estilos de todos los polígonos al estado por defecto.
 */
export function resetBlockStyles() {
  const campusData = getCampusData();
  Object.entries(mapPolygons).forEach(([polyId, poly]) => {
    poly.setStyle({ fillOpacity: 0.35, weight: 2, color: campusData[polyId].color });
  });
}

/**
 * Inicializa el mapa Leaflet y registra el callback al hacer clic en un bloque.
 * @param {function(string): void} onBlockSelect - Se llama con el id del bloque al hacer clic
 */
export function initLeafletMap(onBlockSelect) {
  if (typeof L === 'undefined') {
    setTimeout(() => initLeafletMap(onBlockSelect), 50);
    return;
  }

  const campusData = getCampusData();
  map = L.map('map', { maxZoom: 22 }).setView(iserCenter, 18);
  L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    attribution: '&copy; Google Maps',
    maxZoom: 22,
    maxNativeZoom: 20
  }).addTo(map);

  perimetroPolygon = L.polygon(perimetroCoords, {
    color: '#FDE047',
    weight: 3,
    dashArray: '10, 8',
    fillColor: '#FDE047',
    fillOpacity: 0.05,
    interactive: false
  }).addTo(map);

  for (const [id, data] of Object.entries(campusData)) {
    if (data.coords && data.coords.length > 0) {
      const polygon = L.polygon(data.coords, {
        color: data.color,
        weight: 2,
        fillColor: data.color,
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

      polygon.on('click', () => onBlockSelect(id));
      polygon.on('mouseover', function () {
        this.setStyle({ fillOpacity: 0.7, weight: 3 });
        this.openTooltip();
      });
      polygon.on('mouseout', function () {
        if (getCurrentBlockId() !== id) this.setStyle({ fillOpacity: 0.35, weight: 2 });
        this.closeTooltip();
      });
      mapPolygons[id] = polygon;
    }
  }

  // tooltips (hover) quedan a cargo de Leaflet (open/closeTooltip) para evitar duplicaciones

  emit(EVENTS.MAP_READY, map);
}

// Referencia para mouseout (evitar import circular: map no debe importar state)
let getCurrentBlockId = () => null;
export function setGetCurrentBlockId(fn) {
  getCurrentBlockId = fn;
}
