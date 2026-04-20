/**
 * Estado global. Compatible con mutación directa; setters opcionales emiten eventos.
 */
import { emit, EVENTS } from './events.js';

export const state = {
  user: null,
  userProfile: null,
  userRole: null, // 'visitor' | 'viewer' | 'admin'
  archivosNube: [],
  currentBlockId: null,
  currentFileViewing: null,
  capasActivas: new Set(),
  dashboardData: null,
  currentSede: 'pamplona', // 'pamplona' | 'rinconada' | 'caldera'
  estadosBloques: {} // Estado y scores de cada bloque
};

export function setUser(user) {
  state.user = user;
  emit(EVENTS.AUTH_STATE_CHANGED, user);
}

export function setArchivos(archivos) {
  state.archivosNube = archivos;
  emit(EVENTS.FIRESTORE_SYNC, archivos);
}

export function setCurrentBlock(id) {
  state.currentBlockId = id;
  emit(EVENTS.BLOCK_SELECTED, id);
}

export function setSede(sede) {
  state.currentSede = sede;
  emit(EVENTS.SEDE_CHANGED, sede);
}

export function setEstadosBloques(estados) {
  state.estadosBloques = estados;
  emit('ESTADOS_BLOQUES_CHANGED', estados);
}
