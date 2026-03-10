/**
 * Estado global. Compatible con mutación directa; setters opcionales emiten eventos.
 */
import { emit, EVENTS } from './events.js';

export const state = {
  user: null,
  userProfile: null,
  userRole: null, // 'visitor' | 'admin'
  archivosNube: [],
  currentBlockId: null,
  currentFileViewing: null,
  capasActivas: new Set(),
  dashboardData: null
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
