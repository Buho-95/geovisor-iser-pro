/**
 * env.js — Detector de entorno de ejecución.
 *
 * Decide en qué entorno corre la aplicación SIN tocar producción:
 *   - 'development'  → localhost / 127.0.0.1 / [::1]  (emuladores Firebase)
 *   - 'staging'      → Firebase Hosting preview channel cuyo nombre contiene "staging"
 *                      (URL tipo geovisor-iser--staging-xxxxxx.web.app)
 *   - 'production'   → dominio productivo (geovisor-iser.web.app o custom)
 *
 * Principio de aislamiento (ver paths.js):
 *   - Desarrollo y producción comparten esquema de colecciones/rutas SIN prefijo.
 *   - Staging usa prefijo "staging_" (Firestore) y "staging/" (Storage).
 *   - Jamás se mezclan los dos namespaces.
 *
 * Override manual (solo para QA puntual desde la consola del navegador):
 *   - `?env=staging` en la URL  → fuerza staging (una sola carga)
 *   - `localStorage.setItem('__geovisor_env_override__','staging')` → persistente
 *   - Prohibido forzar `production` desde otra URL por seguridad.
 */

const host = typeof location !== 'undefined' ? location.hostname : '';
const search = typeof location !== 'undefined' ? location.search : '';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);

// Patrón oficial de Firebase Hosting Channels: <projectId>--<channelId>-<hash>.web.app
const STAGING_CHANNEL_PATTERN = /--staging[-.]/i;

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

  if (STAGING_CHANNEL_PATTERN.test(host)) return 'staging';

  // Cualquier otro canal preview de Firebase Hosting lo tratamos también como staging
  // porque NO es la URL productiva. Producción = hostname exacto o custom domain.
  if (/--[a-z0-9-]+\.web\.app$/i.test(host)) return 'staging';

  return 'production';
}

export const ENV = detectEnv();
export const ENV_MODE = ENV; // alias semántico solicitado en spec

export const isDev     = ENV === 'development';
export const isStaging = ENV === 'staging';
export const isProd    = ENV === 'production';

export const shouldUseEmulators = isDev;

export const ENV_CONFIG = {
  development: {
    label: 'DESARROLLO LOCAL',
    shortLabel: 'DEV',
    color: '#DC2626',
    useEmulators: true,
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

export const EMULATOR_PORTS = {
  auth:      9099,
  firestore: 8080,
  storage:   9199,
  functions: 5001,
};

if (typeof window !== 'undefined') {
  window.__GEOVISOR_ENV__ = ENV;
  window.__GEOVISOR_IS_STAGING__ = isStaging;
}
