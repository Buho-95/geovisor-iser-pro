/**
 * Peticiones autenticadas a Cloud Functions (URL directa, sin depender de Hosting rewrites).
 */
import { auth } from './firebase.js';
import { Logger } from '../core/logger.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';

const FUNCTIONS_BASE_URL = 'https://us-central1-geovisor-iser.cloudfunctions.net';

function resolveApiUrl(url) {
  if (typeof url !== 'string') return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url === '/api/getBlockInventory') return `${FUNCTIONS_BASE_URL}/getBlockInventory`;
  if (url === '/api/getNormativeAudit') return `${FUNCTIONS_BASE_URL}/getNormativeAudit`;
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
  console.log('TOKEN READY', token?.slice?.(0, 20) || 'token');
  let headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };

  console.log('API URL:', finalUrl);
  console.log('API CALL WITH AUTH', finalUrl);
  let res = await fetch(finalUrl, { ...options, headers });
  if (res.status === 401) {
    Logger.warn(`401 en ${finalUrl}, refrescando token y reintentando`);
    token = await user.getIdToken(true);
    console.log('TOKEN READY', token?.slice?.(0, 20) || 'token-refreshed');
    headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    };
    console.log('API CALL WITH AUTH', `${finalUrl} (retry)`);
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
