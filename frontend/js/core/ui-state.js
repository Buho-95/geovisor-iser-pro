/**
 * ui-state.js — Estado UI reactivo para el modo dashboard (staging).
 *
 *   { sedeActiva, bloqueSeleccionado }
 *
 * Emite CustomEvents en `document`:
 *   geovisor:sede-changed    → { sede, prev }
 *   geovisor:bloque-selected → { bloque, sede, prev }
 *
 * Convive con `core/state.js` (legacy) sin reemplazarlo: los llamadores legacy
 * siguen funcionando y este módulo sincroniza `state.currentSede` / `state.currentBlockId`
 * cuando están disponibles, para evitar divergencias.
 */
import { Logger } from './logger.js';

const DEFAULTS = Object.freeze({
  sedeActiva: 'pamplona',
  bloqueSeleccionado: null,
});

const SEDES_VALIDAS = new Set(['pamplona', 'rinconada', 'caldera']);

/** Estado interno (mutable). Expuesto por getState() de sólo lectura. */
const _state = { ...DEFAULTS };

/* ═════════════════════ Eventos ═════════════════════ */

export const UI_EVENTS = Object.freeze({
  SEDE_CHANGED:     'geovisor:sede-changed',
  BLOQUE_SELECTED:  'geovisor:bloque-selected',
});

function emit(name, detail) {
  try {
    document.dispatchEvent(new CustomEvent(name, { detail, bubbles: false }));
  } catch (err) {
    Logger.warn?.('[ui-state] No se pudo emitir', name, err);
  }
}

/* ═════════════════════ API ═════════════════════ */

export function getState() {
  return { ...(_state) };
}

export function getSedeActiva()        { return _state.sedeActiva; }
export function getBloqueSeleccionado(){ return _state.bloqueSeleccionado; }

/**
 * Cambia la sede activa. Resetea bloqueSeleccionado.
 * @param {string} sedeId
 * @param {{silent?: boolean}} [opts]
 */
export function setSede(sedeId, opts = {}) {
  if (!sedeId || !SEDES_VALIDAS.has(sedeId)) {
    Logger.warn?.('[ui-state] setSede ignorado, sede inválida:', sedeId);
    return;
  }
  if (_state.sedeActiva === sedeId) return;
  const prev = _state.sedeActiva;
  _state.sedeActiva = sedeId;
  _state.bloqueSeleccionado = null;
  _syncLegacyState({ sede: sedeId, bloque: null });
  if (!opts.silent) emit(UI_EVENTS.SEDE_CHANGED, { sede: sedeId, prev });
}

/**
 * Selecciona (o deselecciona con null) un bloque.
 * @param {string|null} bloqueId
 * @param {{silent?: boolean}} [opts]
 */
export function setBloque(bloqueId, opts = {}) {
  const next = bloqueId ?? null;
  if (_state.bloqueSeleccionado === next) return;
  const prev = _state.bloqueSeleccionado;
  _state.bloqueSeleccionado = next;
  _syncLegacyState({ bloque: next });
  if (!opts.silent) emit(UI_EVENTS.BLOQUE_SELECTED, { bloque: next, sede: _state.sedeActiva, prev });
}

/**
 * Subscriptores de conveniencia. Devuelven una función unsubscribe.
 */
export function onSedeChanged(handler) {
  const listener = (e) => handler(e.detail);
  document.addEventListener(UI_EVENTS.SEDE_CHANGED, listener);
  return () => document.removeEventListener(UI_EVENTS.SEDE_CHANGED, listener);
}
export function onBloqueSelected(handler) {
  const listener = (e) => handler(e.detail);
  document.addEventListener(UI_EVENTS.BLOQUE_SELECTED, listener);
  return () => document.removeEventListener(UI_EVENTS.BLOQUE_SELECTED, listener);
}

/* ═════════════════════ Sync con state.js (legacy) ═════════════════════ */

// Lazy import para evitar dependencia circular.
let _legacyState = null;
async function _ensureLegacyState() {
  if (_legacyState !== null) return _legacyState;
  try {
    const mod = await import('./state.js');
    _legacyState = mod?.state || false;
  } catch (err) {
    _legacyState = false;
  }
  return _legacyState;
}

function _syncLegacyState({ sede, bloque }) {
  // Fire-and-forget; no bloqueamos la emisión del evento.
  _ensureLegacyState().then(legacy => {
    if (!legacy) return;
    if (sede !== undefined) legacy.currentSede = sede;
    if (bloque !== undefined) legacy.currentBlockId = bloque;
  }).catch(() => {});
}

/**
 * Inicializa el estado UI a partir del legacy (útil al bootstrap).
 */
export async function hydrateFromLegacy() {
  const legacy = await _ensureLegacyState();
  if (!legacy) return;
  if (legacy.currentSede && SEDES_VALIDAS.has(legacy.currentSede)) {
    _state.sedeActiva = legacy.currentSede;
  }
  if (legacy.currentBlockId) {
    _state.bloqueSeleccionado = legacy.currentBlockId;
  }
}
