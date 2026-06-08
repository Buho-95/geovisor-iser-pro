/**
 * Peticiones autenticadas al backend Cloud Run.
 * Auth: Supabase JWT (Bearer token).
 */
import { Logger } from '../core/logger.js';
import { ENV_MODE, isStaging } from '../core/env.js';
import { CLOUD_RUN_BASE_URL } from '../core/config.js';

export const BACKEND_ENV = isStaging ? 'staging' : 'production';

const CLOUD_RUN_ENDPOINTS = {
  getBlockInventory: `${CLOUD_RUN_BASE_URL}/api/getBlockInventory`,
  getNormativeAudit: `${CLOUD_RUN_BASE_URL}/api/getNormativeAudit`,
};

export const API_ENDPOINTS = CLOUD_RUN_ENDPOINTS;

function resolveApiUrl(url) {
  if (typeof url !== 'string') return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url === '/api/getBlockInventory') return API_ENDPOINTS.getBlockInventory;
  if (url === '/api/getNormativeAudit') return API_ENDPOINTS.getNormativeAudit;
  return url;
}

async function waitForAuthReady() {
  const { getCurrentSupabaseUser } = await import('./supabase.js');
  const user = await getCurrentSupabaseUser();
  if (user) return user;
  await new Promise(resolve => setTimeout(resolve, 800));
  return await getCurrentSupabaseUser();
}

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
  if (!user) throw new Error('Se requiere sesión');

  const { getSupabaseToken } = await import('./supabase.js');
  let token = await getSupabaseToken();
  const isAnon = user.is_anonymous || !user.email;
  if (requireNonAnonymous && isAnon) throw new Error('Se requiere sesión de administrador');

  const enrichedOptions = withEnvBody(options);
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
    token = await getSupabaseToken(true);
    headers = { ...headers, Authorization: `Bearer ${token}` };
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

export async function authenticatedFetch(url, options = {}) {
  return fetchWithIdToken(url, options, true);
}

export async function authenticatedFetchAny(url, options = {}) {
  return fetchWithIdToken(url, options, false);
}
