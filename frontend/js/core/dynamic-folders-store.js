/**
 * dynamic-folders-store.js — CRUD de carpetas dinámicas staging (zonas "rojo" del PDF).
 *
 * Tabla Supabase: estructura_dinamica
 *   id = "{parentPathSanitizado}__{nombre}"
 *   columnas: id, sede_id, parent_path, nombre, path, numero,
 *             creado_por, creado_en
 *
 * Uso:
 *   const folders = await listDynamicFolders('pamplona');
 *   const key = `${folder.parentPath}/${folder.nombre}`; // path completo
 */
import { state } from './state.js';
import { validateFolderName } from './structure-validator.js';
import { isDynamicFolder, nextDynamicNumber } from './structure-schema.js';
import { normalizeToArray } from './iter-utils.js';
import { getSupabaseClient } from '../services/supabase.js';

const TABLE = 'estructura_dinamica';

function sanitizeDocId(parentPath, nombre) {
  return `${parentPath.replace(/\//g, '__')}__${nombre}`;
}

/**
 * @returns {Promise<Array<{sedeId, parentPath, nombre, path, numero, creadoPor, creadoEn}>>}
 */
export async function listDynamicFolders(sedeId) {
  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from(TABLE)
      .select('*')
      .eq('sede_id', sedeId);
    if (error) throw error;
    return (data || []).map(row => ({
      id: row.id,
      sedeId: row.sede_id,
      parentPath: row.parent_path || row.bloque_id || '',
      nombre: row.nombre || row.nombre_carpeta || '',
      path: row.path || `${row.bloque_id || ''}/${row.nombre_carpeta || ''}`,
      numero: row.numero ?? null,
      creadoPor: row.creado_por || '',
      creadoEn: row.creado_en || row.created_at || null,
    }));
  } catch (err) {
    console.warn('[dynamic-folders-store] listDynamicFolders falló, devolviendo []:', err?.message || err);
    return [];
  }
}

/**
 * Crea una carpeta dinámica bajo un nodo que acepta creación.
 * @param {Object} opts
 * @param {string} opts.sedeId
 * @param {string} opts.parentPath  ruta del nodo padre (ej: "04_Bloque_Administrativo/06_Documentos")
 * @param {string} opts.nombre      nombre completo NN_Nombre (ya validado o sin validar)
 * @param {string[]} [opts.existingSiblings]   nombres ya usados en este nivel (para auto-sugerir)
 */
export async function createDynamicFolder({ sedeId, parentPath, nombre, existingSiblings = [] }) {
  if (!sedeId || !parentPath || !nombre) throw new Error('sedeId, parentPath y nombre son obligatorios.');

  const canCreate = await isDynamicFolder(sedeId, parentPath);
  if (!canCreate) throw new Error(`La carpeta "${parentPath}" no permite creación dinámica.`);

  const r = validateFolderName(nombre);
  if (!r.ok) throw new Error(r.error);

  if (normalizeToArray(existingSiblings).includes(nombre)) {
    throw new Error(`Ya existe una carpeta con el nombre "${nombre}" en este nivel.`);
  }

  const numero = (nombre.match(/^(\d{2})_/) || [null, null])[1];
  const id = sanitizeDocId(parentPath, nombre);

  const payload = {
    id,
    sede_id: sedeId,
    // Columnas compatibles con ambas versiones del schema
    parent_path: parentPath,
    bloque_id: parentPath.split('/')[0] || parentPath,
    disciplina_id: parentPath.split('/').slice(1).join('/') || '',
    nombre,
    nombre_carpeta: nombre,
    path: `${parentPath}/${nombre}`,
    numero: numero ? parseInt(numero, 10) : null,
    creado_por: state?.user?.email || 'desconocido',
    creado_en: new Date().toISOString(),
  };

  const sb = getSupabaseClient();
  const { error } = await sb.from(TABLE).upsert(payload, { onConflict: 'id' });
  if (error) throw error;

  return {
    id,
    sedeId,
    parentPath,
    nombre,
    path: payload.path,
    numero: payload.numero,
    creadoPor: payload.creado_por,
    creadoEn: payload.creado_en,
  };
}

export async function deleteDynamicFolder({ sedeId, parentPath, nombre }) {
  const id = sanitizeDocId(parentPath, nombre);
  const sb = getSupabaseClient();
  const { error } = await sb.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

/**
 * Calcula el siguiente número disponible en ese parentPath.
 * @param {string} sedeId
 * @param {string} parentPath
 */
export async function suggestNextFolderNumber(sedeId, parentPath) {
  const folders = await listDynamicFolders(sedeId);
  const siblings = folders
    .filter(f => f.parentPath === parentPath)
    .map(f => f.nombre);
  return nextDynamicNumber(siblings);
}
