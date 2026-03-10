/**
 * Sistema de eventos pub/sub para desacoplar módulos.
 * Permite que map, dashboard, visor, etc. se comuniquen sin dependencias directas.
 */
const listeners = new Map();

export const EVENTS = {
  AUTH_STATE_CHANGED: 'auth:stateChanged',
  BLOCK_SELECTED: 'map:blockSelected',
  MAP_READY: 'map:ready',
  FIRESTORE_SYNC: 'firestore:sync',
  VIEWER_OPEN: 'viewer:open',
  LAYER_TOGGLE: 'map:layerToggle',
  DASHBOARD_LOAD: 'dashboard:load',
  BIM_VIEWER_OPEN: 'bim:open',
  SEDE_CHANGED: 'sede:changed'
};

export function on(event, callback) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(callback);
  return () => off(event, callback);
}

export function off(event, callback) {
  const cbs = listeners.get(event);
  if (!cbs) return;
  const i = cbs.indexOf(callback);
  if (i >= 0) cbs.splice(i, 1);
}

export function emit(event, data) {
  (listeners.get(event) || []).forEach(cb => {
    try { cb(data); } catch (e) { console.error(`[Events] Error en ${event}:`, e); }
  });
}
