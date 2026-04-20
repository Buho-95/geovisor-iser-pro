/**
 * Peticiones autenticadas a Cloud Functions (Hosting rewrite /api/*).
 */
import { auth } from './firebase.js';
import { Logger } from '../core/logger.js';

async function fetchWithIdToken(url, options, requireNonAnonymous) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Se requiere sesión');
  }
  if (requireNonAnonymous && user.isAnonymous) {
    throw new Error('Se requiere sesión de administrador');
  }
  const token = await user.getIdToken();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.error || j.detail || detail;
    } catch (_) { /* noop */ }
    Logger.warn(`API ${url} → ${res.status}`, detail);
    throw new Error(detail || `Error HTTP ${res.status}`);
  }
  return res;
}

/** Solo usuarios con correo (no visitante anónimo). Cloud Functions de auditoría IA. */
export async function authenticatedFetch(url, options = {}) {
  return fetchWithIdToken(url, options, true);
}

/** Cualquier sesión Firebase (incl. visitante): inventario de bloque. */
export async function authenticatedFetchAny(url, options = {}) {
  return fetchWithIdToken(url, options, false);
}
