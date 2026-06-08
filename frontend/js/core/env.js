/**
 * env.js — Detector de entorno de ejecución.
 *
 * Decide en qué entorno corre la aplicación:
 *   - 'development'  → localhost / 127.0.0.1 / [::1]
 *   - 'staging'      → Vercel preview deploy (URL contiene "-git-" o ".vercel.app" distinto al prod)
 *   - 'production'   → dominio productivo configurado en FRONTEND_ORIGIN / Vercel production
 *
 * Principio de aislamiento (ver paths.js):
 *   - Desarrollo y producción comparten esquema de colecciones/rutas SIN prefijo.
 *   - Staging usa prefijo "staging_" (Supabase tablas) y "staging/" (Storage).
 *   - Jamás se mezclan los dos namespaces.
 *
 * Override manual (solo para QA puntual desde la consola del navegador):
 *   - `?env=staging` en la URL  → fuerza staging (una sola carga)
 *   - `localStorage.setItem('__geovisor_env_override__','staging')` → persistente
 */

const host = typeof location !== 'undefined' ? location.hostname : '';
const search = typeof location !== 'undefined' ? location.search : '';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);

// Vercel preview deployments contienen "-git-" en el subdominio o son *.vercel.app no-prod
const STAGING_PATTERN = /--[a-z0-9-]+\.vercel\.app$/i;

function readOverride() {
  try {
    const params = new URLSearchParams(search || '');
    const qp = (params.get('env') || '').toLowerCase();
    if (qp === 'staging' || qp === 'development') return qp;
    if (typeof localStorage !== 'undefined') {
      const ls = (localStorage.getItem('__geovisor_env_override__') || '').toLowerCase();
      if (ls === 'staging' || ls === 'development') return ls;
    }
  } catch (_) { /* sandboxed contexts */ }
  return null;
}

function detectEnv() {
  const override = readOverride();
  if (override) return override;

  if (LOCAL_HOSTS.has(host)) return 'development';

  if (STAGING_PATTERN.test(host)) return 'staging';

  return 'production';
}

export const ENV = detectEnv();
export const ENV_MODE = ENV;

export const isDev     = ENV === 'development';
export const isStaging = ENV === 'staging';
export const isProd    = ENV === 'production';

export const shouldUseEmulators = false; // Sin emuladores Firebase — stack Supabase puro

export const ENV_CONFIG = {
  development: {
    label: 'DESARROLLO LOCAL',
    shortLabel: 'DEV',
    color: '#DC2626',
    useEmulators: false,
    useNamespacePrefix: false,
    allowDestructiveOps: true,
  },
  staging: {
    label: 'STAGING (PRUEBAS REALES)',
    shortLabel: 'STAGING',
    color: '#F97316',
    useEmulators: false,
    useNamespacePrefix: true,
    allowDestructiveOps: true,
  },
  production: {
    label: 'PRODUCCIÓN',
    shortLabel: 'PROD',
    color: null,
    useEmulators: false,
    useNamespacePrefix: false,
    allowDestructiveOps: false,
  },
};

export function getEnvConfig() {
  return ENV_CONFIG[ENV];
}

if (typeof window !== 'undefined') {
  window.__GEOVISOR_ENV__ = ENV;
  window.__GEOVISOR_IS_STAGING__ = isStaging;
}
