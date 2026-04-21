/**
 * env.js — Detector de entorno de ejecución.
 *
 * Decide en qué entorno corre la aplicación SIN tocar producción:
 *   - 'development'  → localhost / 127.0.0.1 / [::1]  (emuladores Firebase)
 *   - 'preview'      → *.web.app con canal preview (hosting:channel:deploy)
 *   - 'production'   → dominio productivo (geovisor-iser.web.app o custom)
 *
 * Uso:
 *   import { ENV, isDev, isPreview, isProd, shouldUseEmulators } from './env.js';
 *
 * En producción este módulo NO hace absolutamente nada que afecte el flujo normal.
 */

const host = typeof location !== 'undefined' ? location.hostname : '';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);

function detectEnv() {
  if (LOCAL_HOSTS.has(host)) return 'development';
  if (/--/.test(host) && /\.web\.app$/.test(host)) return 'preview';
  return 'production';
}

export const ENV = detectEnv();

export const isDev     = ENV === 'development';
export const isPreview = ENV === 'preview';
export const isProd    = ENV === 'production';

export const shouldUseEmulators = isDev;

export const ENV_CONFIG = {
  development: {
    label: 'DESARROLLO LOCAL',
    color: '#DC2626',
    useEmulators: true,
    allowDestructiveOps: true,
  },
  preview: {
    label: 'PREVIEW (STAGING)',
    color: '#F59E0B',
    useEmulators: false,
    allowDestructiveOps: true,
  },
  production: {
    label: 'PRODUCCIÓN',
    color: null,
    useEmulators: false,
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
}
