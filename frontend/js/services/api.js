/**
 * Peticiones autenticadas a Cloud Functions (URL directa, sin depender de Hosting rewrites).
 */
import { auth } from './firebase.js';
import { Logger } from '../core/logger.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';

/** Única fuente de URLs de Cloud Run para las Functions HTTPS. */
export const API_ENDPOINTS = {
  getBlockInventory: 'https://getblockinventory-arhxbhdbiq-uc.a.run.app',
  getNormativeAudit: 'https://getnormativeaudit-arhxbhdbiq-uc.a.run.app',
};

function resolveApiUrl(url) {
  if (typeof url !== 'string') return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url === '/api/getBlockInventory') return API_ENDPOINTS.getBlockInventory;
  if (url === '/api/getNormativeAudit') return API_ENDPOINTS.getNormativeAudit;
  return url;
}

async function waitForAuthReady(timeoutMs = 12000) {
  if (auth.currentUser) return auth.currentUser;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off?.();
      reject(new Error('Auth no disponible aún'));
    }, timeoutMs);
    const off = onAuthStateChanged(auth, (user) => {
      if (!user) return;
      clearTimeout(timer);
      off?.();
      resolve(user);
    });
  });
}

async function fetchWithIdToken(url, options, requireNonAnonymous) {
  const finalUrl = resolveApiUrl(url);
  const user = await waitForAuthReady();
  if (!user) {
    throw new Error('Se requiere sesión');
  }
  if (requireNonAnonymous && user.isAnonymous) {
    throw new Error('Se requiere sesión de administrador');
  }

  let token = await user.getIdToken();
  Logger.debug('API autenticada', { url: finalUrl });
  let headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };

  let res = await fetch(finalUrl, { ...options, headers });
  if (res.status === 401) {
    Logger.warn(`401 en ${finalUrl}, refrescando token y reintentando`);
    token = await user.getIdToken(true);
    headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    };
    res = await fetch(finalUrl, { ...options, headers });
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.error || j.detail || detail;
    } catch (_) { /* noop */ }
    Logger.warn(`API ${finalUrl} → ${res.status}`, detail);
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
