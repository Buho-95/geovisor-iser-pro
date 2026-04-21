/**
 * structure-validator.js — Validaciones de nomenclatura y rutas.
 *
 * Valida SIEMPRE contra el schema canónico (estructura-base.json).
 * Bloquea acciones que violen:
 *   - Nomenclatura NN_Nombre (01_Arquitectonico, 02_Topografia, ...)
 *   - Rutas que no existen en el schema
 *   - Duplicados en el mismo nivel
 *   - Nombres fuera del esquema (01_Electricos pero con sufijos prohibidos)
 */
import { loadSchema, findNodeInSede, isValidPath } from './structure-schema.js';
import { normalizeToArray, normalizeItem } from './iter-utils.js';

const RE_NN = /^[0-9]{2}_[A-Za-z0-9_]+$/;

/**
 * Valida el nombre de una carpeta dinámica NN_Nombre.
 * @returns {{ok: boolean, error?: string}}
 */
export function validateFolderName(name) {
  if (typeof name !== 'string' || !name) {
    return { ok: false, error: 'El nombre no puede estar vacío.' };
  }
  if (!RE_NN.test(name)) {
    return {
      ok: false,
      error: 'Nombre inválido. Debe seguir el formato NN_Nombre (ej: 01_MiCarpeta). Solo letras, dígitos y guion bajo; sin espacios ni acentos.',
    };
  }
  if (name.length > 80) {
    return { ok: false, error: 'Nombre demasiado largo (máximo 80 caracteres).' };
  }
  return { ok: true };
}

/**
 * Valida que `path` sea una ruta válida dentro del schema de la sede.
 * Acepta rutas mixtas con carpetas dinámicas siempre que sus padres sean dinámicos.
 *
 * @param {string} sedeId
 * @param {string} path  ej: "04_Bloque_Administrativo/01_Arquitectonico/01_Modelos_2D_AutoCAD"
 * @param {{dynamicFolders?: Set<string>}} [opts]  rutas dinámicas registradas
 */
export async function validatePath(sedeId, path, opts = {}) {
  if (typeof path !== 'string' || !path) {
    return { ok: false, error: 'Ruta vacía.' };
  }
  const parts = path.split('/').filter(Boolean);
  for (const p of parts) {
    if (!RE_NN.test(p)) {
      return { ok: false, error: `Segmento fuera de nomenclatura NN_: "${p}"` };
    }
  }
  const valid = await isValidPath(sedeId, path);
  if (valid) return { ok: true };

  // Puede ser parcialmente válida: la base existe y los segmentos extra son dinámicos registrados.
  const dyn = opts.dynamicFolders instanceof Set ? opts.dynamicFolders : new Set();
  for (let i = parts.length - 1; i >= 1; i--) {
    const base = parts.slice(0, i).join('/');
    const node = await findNodeInSede(sedeId, base);
    if (node && node.acceptsDynamic) {
      // Comprobar que los segmentos restantes están registrados como dinámicos bajo `base`.
      const extra = parts.slice(i).join('/');
      const fullDyn = `${base}/${extra}`;
      if (dyn.has(fullDyn)) return { ok: true, dynamic: true };
      return {
        ok: false,
        error: `La ruta dinámica "${extra}" bajo "${base}" no está registrada.`,
      };
    }
  }
  return { ok: false, error: `Ruta inválida: "${path}" no existe en el schema de "${sedeId}".` };
}

/**
 * Valida la integridad del schema cargado (sin duplicados, claves NN_).
 * Útil al iniciar la app en staging para detectar corrupción/alteración.
 */
export async function validateSchemaIntegrity() {
  const s = await loadSchema();
  const issues = [];

  const disciplinas = normalizeToArray(s.disciplinasBaseBloque);
  for (const d of disciplinas) {
    if (!RE_NN.test(d)) issues.push(`Disciplina fuera de NN_: ${d}`);
  }
  const subList = normalizeToArray(s.subestructuraRepetible).map(normalizeItem);
  for (const sc of subList) {
    if (!sc.nombre || !RE_NN.test(sc.nombre)) issues.push(`Subcarpeta repetible fuera de NN_: ${sc.nombre}`);
  }
  const seen = new Set();
  for (const d of disciplinas) {
    if (seen.has(d)) issues.push(`Disciplina duplicada: ${d}`);
    seen.add(d);
  }

  for (const [sedeId, sede] of Object.entries(s.sedes || {})) {
    const keysSede = normalizeToArray(sede?.nivelSede)
      .map(x => typeof x === 'string' ? x : (x?.id || x?.nombre || ''))
      .filter(Boolean);
    for (const k of keysSede) {
      if (!RE_NN.test(k)) issues.push(`[${sedeId}] nivelSede fuera de NN_: ${k}`);
    }
    const keysBloques = Array.isArray(sede?.bloques)
      ? sede.bloques.map(b => typeof b === 'string' ? b : (b?.id || b?.nombre || ''))
      : Object.keys(sede?.bloques || {});
    for (const k of keysBloques) {
      if (!k) continue;
      if (!RE_NN.test(k)) issues.push(`[${sedeId}] bloque fuera de NN_: ${k}`);
    }
  }

  return { ok: issues.length === 0, issues };
}
