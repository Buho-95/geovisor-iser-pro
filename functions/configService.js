/**
 * Servicio de configuración normativa para Cloud Functions.
 * - Carga desde normative-config.json (incluido en el artefacto de deploy).
 * - Validación de esquema al cargar.
 * - Punto único para migrar en el futuro a Firestore u otro backend sin cambiar index.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_NORMAS = ['NSR-10', 'NTC-6047', 'RETIE'];
const REQUIRED_THRESHOLDS = ['semaforoVerde', 'semaforoAmarillo', 'mapaVerde', 'mapaAmarillo'];

let _cached = null;

function logStructured(event, payload) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...payload }));
}

function validateNormativeSchema(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('normative-config: raíz no es un objeto');
  }
  if (!obj.keywords || typeof obj.keywords !== 'object') {
    throw new Error('normative-config: falta "keywords"');
  }
  for (const k of REQUIRED_NORMAS) {
    if (!Array.isArray(obj.keywords[k]) || obj.keywords[k].length === 0) {
      throw new Error(`normative-config: keywords["${k}"] debe ser un array no vacío`);
    }
  }
  if (!obj.thresholds || typeof obj.thresholds !== 'object') {
    throw new Error('normative-config: falta "thresholds"');
  }
  for (const k of REQUIRED_THRESHOLDS) {
    if (typeof obj.thresholds[k] !== 'number') {
      throw new Error(`normative-config: thresholds["${k}"] debe ser número`);
    }
  }
  return obj;
}

function loadFromJsonFile() {
  const filePath = path.join(__dirname, 'normative-config.json');
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    logStructured('normative_config_read_failed', {
      path: filePath,
      message: e.message,
      code: e.code,
    });
    throw new Error(`No se pudo leer normative-config.json: ${e.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    logStructured('normative_config_json_invalid', { message: e.message });
    throw new Error(`normative-config.json no es JSON válido: ${e.message}`);
  }

  try {
    return validateNormativeSchema(parsed);
  } catch (e) {
    logStructured('normative_config_schema_invalid', { message: e.message });
    throw e;
  }
}

/**
 * Reservado: reemplazar cuerpo por lectura Firestore (p. ej. admin.firestore().doc('app_config/normativa')).
 * Los consumidores siguen usando getNormativeConfig().
 */
async function loadNormativeFromFirestore(_admin) {
  throw new Error('loadNormativeFromFirestore: no implementado (usar JSON hasta activar migración)');
}

/**
 * Obtiene la configuración normativa (memoria caché tras primer acceso).
 * @returns {object} keywords, thresholds, futurePdfAnalysis, etc.
 */
function getNormativeConfig() {
  const source = process.env.NORMATIVE_SOURCE || 'file';

  if (source !== 'file') {
    logStructured('normative_config_unsupported_source', { source });
    throw new Error(`NORMATIVE_SOURCE="${source}" no soportado aún; use file o implemente loadNormativeFromFirestore`);
  }

  if (_cached) {
    return _cached;
  }

  try {
    _cached = loadFromJsonFile();
    return _cached;
  } catch (e) {
    logStructured('normative_config_load_failed', { message: e.message });
    throw e;
  }
}

/** Solo tests o recarga forzada */
function clearNormativeCache() {
  _cached = null;
}

module.exports = {
  getNormativeConfig,
  clearNormativeCache,
  loadNormativeFromFirestore,
  validateNormativeSchema,
};
