'use strict';

/**
 * envNamespace.js — Namespacing server-side para staging.
 *
 * El cliente envía `env: "staging" | "production"` en el body del request.
 * Las funciones resuelven nombres de colecciones y prefijos de storage
 * usando este helper para mantener aislamiento estricto.
 *
 * Valores válidos:
 *   - "staging"     → prefija "staging_" / "staging/"
 *   - "production"  → sin prefijo (default si no se indica)
 *   - cualquier otro → se normaliza a "production" (no se confía en input sucio)
 */

const VALID_ENVS = new Set(['staging', 'production']);

function normalizeEnv(raw) {
  if (typeof raw !== 'string') return 'production';
  const v = raw.toLowerCase().trim();
  return VALID_ENVS.has(v) ? v : 'production';
}

/**
 * Deriva el env desde el body o el header X-Geovisor-Env de la petición.
 * Default: production.
 * @param {import('express').Request} req
 */
function envFromRequest(req) {
  if (!req) return 'production';
  const body = req.body || {};
  if (body.env) return normalizeEnv(body.env);
  const headers = req.headers || {};
  const raw = headers['x-geovisor-env'] || headers['X-Geovisor-Env'];
  return normalizeEnv(raw);
}

/**
 * Prefijo Firestore para un env dado.
 */
function firestorePrefix(env) {
  return env === 'staging' ? 'staging_' : '';
}

/**
 * Prefijo Storage para un env dado.
 */
function storagePrefix(env) {
  return env === 'staging' ? 'staging/' : '';
}

/**
 * Aplica prefijo a un nombre de colección.
 */
function withCollection(env, name) {
  if (typeof name !== 'string' || !name) throw new TypeError('withCollection: name inválido');
  return firestorePrefix(env) + name;
}

/**
 * Aplica prefijo a una ruta de Storage.
 */
function withStoragePath(env, path) {
  if (typeof path !== 'string' || !path) throw new TypeError('withStoragePath: path inválido');
  const normalized = path.replace(/^\/+/, '');
  return storagePrefix(env) + normalized;
}

module.exports = {
  normalizeEnv,
  envFromRequest,
  firestorePrefix,
  storagePrefix,
  withCollection,
  withStoragePath,
};
