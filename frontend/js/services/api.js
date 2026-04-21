/**
 * Peticiones autenticadas a Cloud Functions (URL directa, sin depender de Hosting rewrites).
 */
import { auth } from './firebase.js';
import { Logger } from '../core/logger.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { shouldUseEmulators, EMULATOR_PORTS, ENV_MODE, isStaging } from '../core/env.js';
import { firebaseConfig } from '../core/config.js';

/**
 * Env enviado al backend: dev se trata como "production" namespace
 * (backend no conoce "development"; los emuladores ya aíslan datos).
 * Solo "staging" activa el prefijo server-side.
 */
export const BACKEND_ENV = isStaging ? 'staging' : 'production';

const FUNCTIONS_REGION = 'us-central1';

const PROD_ENDPOINTS = {
  getBlockInventory: 'https://getblockinventory-arhxbhdbiq-uc.a.run.app',
  getNormativeAudit: 'https://getnormativeaudit-arhxbhdbiq-uc.a.run.app',
};

const EMULATOR_ENDPOINTS = {
  getBlockInventory: `http://127.0.0.1:${EMULATOR_PORTS.functions}/${firebaseConfig.projectId}/${FUNCTIONS_REGION}/getBlockInventory`,
  getNormativeAudit: `http://127.0.0.1:${EMULATOR_PORTS.functions}/${firebaseConfig.projectId}/${FUNCTIONS_REGION}/getNormativeAudit`,
};

/** Única fuente de URLs para Cloud Functions (conmuta automáticamente a emulador en dev). */
export const API_ENDPOINTS = shouldUseEmulators ? EMULATOR_ENDPOINTS : PROD_ENDPOINTS;

if (shouldUseEmulators) {
  Logger.info('🧪 API_ENDPOINTS apuntando a emulador de Functions:', API_ENDPOINTS);
}

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

/**
 * Inyecta `env` en el body JSON si el caller no lo pasó ya.
 */
function withEnvBody(options) {
  if (!options || !options.body) return options;
  try {
    const parsed = JSON.parse(options.body);
    if (!parsed || typeof parsed !== 'object') return options;
    if (parsed.env) return options;
    return { ...options, body: JSON.stringify({ ...parsed, env: BACKEND_ENV }) };
  } catch (_) {
    return options;
  }
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

  const enrichedOptions = withEnvBody(options);

  let token = await user.getIdToken();
  Logger.debug('API autenticada', { url: finalUrl, env: BACKEND_ENV });
  let headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Geovisor-Env': BACKEND_ENV,
    ...enrichedOptions.headers,
  };

  let res = await fetch(finalUrl, { ...enrichedOptions, headers });
  if (res.status === 401) {
    Logger.warn(`401 en ${finalUrl}, refrescando token y reintentando`);
    token = await user.getIdToken(true);
    headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Geovisor-Env': BACKEND_ENV,
      ...enrichedOptions.headers,
    };
    res = await fetch(finalUrl, { ...enrichedOptions, headers });
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
