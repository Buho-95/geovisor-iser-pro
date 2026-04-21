/**
 * dynamic-folders-store.js — CRUD de carpetas dinámicas staging (zonas "rojo" del PDF).
 *
 * Colección: staging_estructura_dinamica
 *   docId = "{sedeId}__{parentPathSanitizado}__{nombre}"
 *   doc = {
 *     sedeId, parentPath, nombre, path, numero,
 *     creadoPor, creadoEn, metadata: { disciplina?, estado? }
 *   }
 *
 * Uso:
 *   const folders = await listDynamicFolders('pamplona');
 *   const key = `${folder.parentPath}/${folder.nombre}`; // path completo
 */
import { COLLECTIONS } from './constants.js';
import { db } from '../services/firebase.js';
import {
  collection, query, where, getDocs, setDoc, doc, serverTimestamp, deleteDoc
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { state } from './state.js';
import { validateFolderName } from './structure-validator.js';
import { isDynamicFolder, nextDynamicNumber } from './structure-schema.js';
import { isStaging } from './env.js';
import { normalizeToArray } from './iter-utils.js';

const COL = COLLECTIONS.ESTRUCTURA_DINAMICA; // resuelta por paths.js en staging

function sanitizeDocId(parentPath, nombre) {
  return `${parentPath.replace(/\//g, '__')}__${nombre}`;
}

/**
 * @returns {Promise<Array<{sedeId, parentPath, nombre, path, numero, creadoPor, creadoEn}>>}
 */
export async function listDynamicFolders(sedeId) {
  if (!isStaging) return [];
  try {
    const q = query(collection(db, COL), where('sedeId', '==', sedeId));
    const snap = await getDocs(q);
    return normalizeToArray(snap?.docs).map(d => ({ id: d.id, ...(d.data() || {}) }));
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
  if (!isStaging) throw new Error('Las carpetas dinámicas solo existen en STAGING.');
  if (!sedeId || !parentPath || !nombre) throw new Error('sedeId, parentPath y nombre son obligatorios.');

  const canCreate = await isDynamicFolder(sedeId, parentPath);
  if (!canCreate) throw new Error(`La carpeta "${parentPath}" no permite creación dinámica.`);

  const r = validateFolderName(nombre);
  if (!r.ok) throw new Error(r.error);

  if (normalizeToArray(existingSiblings).includes(nombre)) {
    throw new Error(`Ya existe una carpeta con el nombre "${nombre}" en este nivel.`);
  }

  const numero = (nombre.match(/^(\d{2})_/) || [null, null])[1];
  const payload = {
    sedeId,
    parentPath,
    nombre,
    path: `${parentPath}/${nombre}`,
    numero: numero ? parseInt(numero, 10) : null,
    creadoPor: state?.user?.email || 'desconocido',
    creadoEn: serverTimestamp(),
  };

  const id = sanitizeDocId(parentPath, nombre);
  await setDoc(doc(db, COL, id), payload, { merge: false });
  return { id, ...payload };
}

export async function deleteDynamicFolder({ sedeId, parentPath, nombre }) {
  if (!isStaging) throw new Error('Operación solo disponible en STAGING.');
  const id = sanitizeDocId(parentPath, nombre);
  await deleteDoc(doc(db, COL, id));
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
