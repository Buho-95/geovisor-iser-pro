/**
 * storage-routing.js — Construye rutas Storage respetando el namespace de entorno.
 *
 * En staging:  staging/sedes/{sedeId}/{bloque}/{disciplina}/{sub}/archivo
 * En prod:     sedes/{sedeId}/{bloque}/{disciplina}/{sub}/archivo
 *
 * NOTA: la app actual de producción sigue usando `documentos_iser/{bloque}/...`.
 * Este helper se usa exclusivamente para la nueva arquitectura jerárquica
 * por sede implementada en STAGING. Cuando se quiera migrar producción,
 * bastará con cambiar el prefijo base desde aquí.
 */
import { isStaging } from './env.js';
import { STORAGE_PREFIX } from './paths.js';
import { validateFolderName } from './structure-validator.js';

const BASE_SEDES = 'sedes';

/**
 * Construye la ruta completa dentro del bucket para un archivo/carpeta.
 *
 * @param {Object} opts
 * @param {string} opts.sedeId         "pamplona" | "rinconada" | "caldera"
 * @param {string} [opts.bloque]       "04_Bloque_Administrativo"
 * @param {string} [opts.disciplina]   "01_Arquitectonico"
 * @param {string} [opts.subcarpeta]   "01_Modelos_2D_AutoCAD" (puede incluir subrutas: "01_Electricos/02_Laboratorios/...")
 * @param {string} [opts.archivo]      nombre de archivo final (opcional)
 * @returns {string} path completo dentro del bucket.
 */
export function buildStoragePath({ sedeId, bloque, disciplina, subcarpeta, archivo } = {}) {
  if (!sedeId) throw new Error('buildStoragePath: sedeId es obligatorio.');
  const segs = [STORAGE_PREFIX.replace(/\/$/, ''), BASE_SEDES, sedeId]
    .filter(s => s !== '');

  for (const s of [bloque, disciplina, subcarpeta]) {
    if (!s) continue;
    // subcarpeta puede contener slashes (rutas anidadas) — se aceptan tal cual
    const parts = String(s).split('/').filter(Boolean);
    segs.push(...parts);
  }

  if (archivo) segs.push(archivo);
  return segs.join('/');
}

/**
 * Valida que cada segmento (salvo el archivo final) cumpla la nomenclatura NN_ .
 * @returns {{ok: boolean, error?: string}}
 */
export function validateStoragePath({ bloque, disciplina, subcarpeta } = {}) {
  const toCheck = [];
  if (bloque) toCheck.push(bloque);
  if (disciplina) toCheck.push(disciplina);
  if (subcarpeta) {
    for (const p of String(subcarpeta).split('/').filter(Boolean)) toCheck.push(p);
  }
  for (const seg of toCheck) {
    const r = validateFolderName(seg);
    if (!r.ok) return { ok: false, error: `Segmento inválido "${seg}": ${r.error}` };
  }
  return { ok: true };
}

/** Flag de conveniencia para UI. */
export function isJerarquiaPorSedeActiva() {
  return isStaging;
}
