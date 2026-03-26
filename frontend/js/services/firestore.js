/**
 * Servicio Firestore: sincronización en tiempo real y helpers para futuras colecciones.
 */
import { collection, onSnapshot, doc, setDoc, getDoc, getDocs, deleteDoc, query, orderBy, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { db, storage } from './firebase.js';
import { state, setArchivos, setEstadosBloques } from '../core/state.js';
import { dbPath, COLLECTIONS, STORAGE_PATHS } from '../core/config.js';

/**
 * Inicia sync en tiempo real de archivos_iser.
 * @param {function(): void} onUpdate - Callback al actualizar datos
 * @returns {function} - Unsubscribe
 */
export function startArchivosSync(onUpdate) {
  return onSnapshot(
    collection(db, dbPath),
    (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      state.archivosNube = docs;
      setArchivos(docs);
      const status = document.getElementById('cloud-status');
      if (status) {
        status.innerHTML = '<i class="ph-fill ph-cloud-check"></i> BD Sincronizada';
        status.className = 'flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-bold border border-emerald-200';
      }
      onUpdate?.();
    },
    (error) => {
      console.error('Firestore sync error:', error);
      const status = document.getElementById('cloud-status');
      if (status) {
        status.innerHTML = '<i class="ph-fill ph-cloud-slash"></i> Sin conexión a BD';
        status.className = 'flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-bold border border-amber-200';
      }
      onUpdate?.();
    }
  );
}

/**
 * Inicia sync en tiempo real de estados de bloques.
 * @param {function(): void} onUpdate - Callback al actualizar datos
 * @returns {function} - Unsubscribe
 */
export function startEstadosBloquesSync(onUpdate) {
  // Manejo de 'Estado de Cumplimiento' o 'Cargando...'
  const timeoutId = setTimeout(() => {
    const statusEl = document.getElementById('estado-cumplimiento') || document.getElementById('audit-semaforo-label');
    const scoreEl = document.getElementById('audit-score-value');
    if (statusEl && (statusEl.innerText.includes('Cargando') || statusEl.innerText === '--')) {
      statusEl.innerText = 'Sin datos de auditoría';
    }
    if (scoreEl && scoreEl.innerText === '--%') {
      scoreEl.innerText = '0%';
    }
  }, 5000);

  return onSnapshot(
    collection(db, COLLECTIONS.ESTADOS_BLOQUES),
    (snapshot) => {
      clearTimeout(timeoutId);
      const docs = {};
      snapshot.docs.forEach(d => {
        docs[d.id] = d.data();
      });
      state.estadosBloques = docs;
      setEstadosBloques(docs);
      onUpdate?.();
    },
    (error) => {
      clearTimeout(timeoutId);
      console.error('Firestore estados_bloques sync error:', error);
      const statusEl = document.getElementById('estado-cumplimiento') || document.getElementById('audit-semaforo-label');
      if (statusEl) {
        statusEl.innerText = 'Error de conexión con la base de datos';
        statusEl.style.color = '#EF4444'; // Rojo para error
      }
      onUpdate?.();
    }
  );
}

/**
 * Guarda los scores y color de un bloque en Firestore.
 * @param {string} blockId
 * @param {Object} datos
 */
export async function guardarEstadoBloque(blockId, datos) {
  try {
    const docRef = doc(db, COLLECTIONS.ESTADOS_BLOQUES, blockId);
    await setDoc(docRef, datos, { merge: true });
    return true;
  } catch (e) {
    console.error('Error guardando estado del bloque', e);
    throw e;
  }
}

/**
 * Recupera el informe de auditoría cacheado para un bloque.
 * @param {string} blockId
 * @returns {Promise<Object|null>} — Objeto con resultado de auditoría o null si no existe
 */
export async function getAuditoriaCached(blockId) {
  try {
    const docRef = doc(db, COLLECTIONS.AUDITORIAS_BLOQUES, blockId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  } catch (e) {
    console.error('Error leyendo auditoría cacheada:', e);
    return null;
  }
}

/**
 * Guarda el resultado completo de una auditoría en Firestore (caché persistente).
 * Incluye un hash/fingerprint del inventario para detectar cambios.
 * @param {string} blockId
 * @param {Object} auditResult — Resultado completo de la auditoría IA
 * @param {Object} inventario — Inventario de archivos escaneado
 */
export async function guardarAuditoria(blockId, auditResult, inventario) {
  try {
    // Crear un fingerprint basado en los archivos: totalArchivos + nombres concatenados
    const archivoHash = inventario.totalArchivos + ':' +
      inventario.archivos
        .map(a => a.nombre)
        .sort()
        .join('|');

    const docRef = doc(db, COLLECTIONS.AUDITORIAS_BLOQUES, blockId);
    await setDoc(docRef, {
      ...auditResult,
      archivoHash,
      totalArchivosAlAuditar: inventario.totalArchivos,
      fechaAuditoria: new Date().toISOString(),
      blockId
    });
    return true;
  } catch (e) {
    console.error('Error guardando auditoría en caché:', e);
    throw e;
  }
}

// ═══════════════════════════════════════════════════════
// 📄 GESTIÓN DE REPORTES (Historial de PDFs)
// ═══════════════════════════════════════════════════════

/**
 * Sube un PDF de reporte a Firebase Storage en /auditorias/[blockId]/
 * @param {string} blockId — ID del bloque
 * @param {Blob} pdfBlob — Blob del PDF generado
 * @param {string} fileName — Nombre del archivo
 * @returns {Promise<string>} — URL de descarga del archivo subido
 */
export async function uploadReportToStorage(blockId, pdfBlob, fileName) {
  const path = `${STORAGE_PATHS.AUDITORIAS}/${blockId}/${fileName}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, pdfBlob, { contentType: 'application/pdf' });
  const url = await getDownloadURL(fileRef);
  return { url, storagePath: path };
}

/**
 * Guarda metadata de un reporte generado en Firestore (reportes_historial).
 * @param {string} blockId
 * @param {string} blockName
 * @param {string} downloadUrl — URL del PDF en Storage
 * @param {string} storagePath — Ruta del archivo en Storage
 * @param {string} userEmail — Email del usuario que generó
 * @returns {Promise<string>} — ID del documento creado
 */
export async function saveReportMetadata(blockId, blockName, downloadUrl, storagePath, userEmail) {
  const colRef = collection(db, COLLECTIONS.REPORTES_HISTORIAL);
  const docRef = await addDoc(colRef, {
    blockId,
    blockName,
    downloadUrl,
    storagePath,
    userEmail,
    fecha: new Date().toISOString(),
    createdAt: new Date().toISOString()
  });
  return docRef.id;
}

/**
 * Recupera el historial de reportes ordenado por fecha descendente.
 * @returns {Promise<Array>} — Array de reportes con id y datos
 */
export async function getReportHistory() {
  try {
    const colRef = collection(db, COLLECTIONS.REPORTES_HISTORIAL);
    const q = query(colRef, orderBy('fecha', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Error cargando historial de reportes:', e);
    return [];
  }
}

/**
 * Elimina un reporte: borra el registro en Firestore y el archivo en Storage.
 * @param {string} reportId — ID del documento en Firestore
 * @param {string} storagePath — Ruta del archivo en Storage
 */
export async function deleteReport(reportId, storagePath) {
  // 1. Borrar archivo en Storage
  if (storagePath) {
    try {
      const fileRef = storageRef(storage, storagePath);
      await deleteObject(fileRef);
    } catch (e) {
      console.warn('No se pudo borrar el archivo en Storage (puede ya no existir):', e);
    }
  }

  // 2. Borrar registro en Firestore
  const docRef = doc(db, COLLECTIONS.REPORTES_HISTORIAL, reportId);
  await deleteDoc(docRef);
}

