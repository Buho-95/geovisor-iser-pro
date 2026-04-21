/**
 * paths.js — Helpers de namespacing según ENV_MODE.
 *
 * Regla:
 *   - staging → colecciones Firestore prefijadas con "staging_" y storage con "staging/".
 *   - development / production → sin prefijo (esquema histórico).
 *
 * Toda lectura/escritura a Firestore o Storage del frontend DEBE pasar por uno
 * de estos helpers (o por `COLLECTIONS` / `STORAGE_PATHS` re-exportados desde
 * core/config.js, que internamente los usan).
 *
 * Esto garantiza que:
 *   · staging NUNCA escribe en colecciones/paths de producción.
 *   · producción NUNCA lee de colecciones/paths de staging.
 */
import { ENV_MODE, isStaging, getEnvConfig } from './env.js';

export const FIRESTORE_PREFIX = isStaging ? 'staging_' : '';
export const STORAGE_PREFIX   = isStaging ? 'staging/' : '';

/**
 * Prefija un nombre de colección según el entorno.
 * @param {string} name - nombre base ("archivos_iser", "usuarios_iser", ...)
 * @returns {string}
 */
export function getCollection(name) {
  if (typeof name !== 'string' || !name) {
    throw new TypeError('getCollection: nombre de colección inválido');
  }
  if (name.startsWith('staging_')) {
    console.warn(`[paths] getCollection recibió ya prefijado: "${name}"`);
    return name;
  }
  return FIRESTORE_PREFIX + name;
}

/**
 * Prefija una ruta de Storage según el entorno.
 * @param {string} path - ruta base ("documentos_iser/bloque/...")
 * @returns {string}
 */
export function getStoragePath(path) {
  if (typeof path !== 'string' || !path) {
    throw new TypeError('getStoragePath: ruta inválida');
  }
  if (path.startsWith('staging/')) {
    console.warn(`[paths] getStoragePath recibió ya prefijada: "${path}"`);
    return path;
  }
  const normalized = path.replace(/^\/+/, '');
  return STORAGE_PREFIX + normalized;
}

/**
 * Valida que una ruta/colección recibida corresponde al entorno actual.
 * Útil como guard en operaciones destructivas.
 * @returns {boolean}
 */
export function belongsToCurrentEnv(pathOrCollection) {
  if (typeof pathOrCollection !== 'string') return false;
  const hasPrefix =
    pathOrCollection.startsWith('staging_') || pathOrCollection.startsWith('staging/');
  return isStaging ? hasPrefix : !hasPrefix;
}

/**
 * Objeto informativo exponible en la consola para auditoría rápida.
 */
export const NS_INFO = {
  env: ENV_MODE,
  firestorePrefix: FIRESTORE_PREFIX,
  storagePrefix: STORAGE_PREFIX,
  label: getEnvConfig().label,
};

if (typeof window !== 'undefined') {
  window.__GEOVISOR_NS__ = NS_INFO;
}
