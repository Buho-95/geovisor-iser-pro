/**
 * Servicio Firestore: suscripción por bloque, auditoría e historial.
 */
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  limit,
  orderBy,
  addDoc,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js';
import { db, storage } from './firebase.js';
import { state, setArchivos, setEstadosBloques } from '../core/state.js';
import { dbPath, COLLECTIONS, STORAGE_PATHS } from '../core/config.js';
import { on, EVENTS } from '../core/events.js';
import { Logger } from '../core/logger.js';
import { computeInventoryFingerprint } from '../core/inventoryHash.js';

const ARCHIVOS_PAGE = 2000;
let unsubArchivos = null;

function applyCloudStatus(ok) {
  const status = document.getElementById('cloud-status');
  if (!status) return;
  if (ok) {
    status.innerHTML = '<i class="ph-fill ph-cloud-check"></i> BD Sincronizada';
    status.className =
      'flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-bold border border-emerald-200';
  } else {
    status.innerHTML = '<i class="ph-fill ph-cloud-slash"></i> Sin conexión a BD';
    status.className =
      'flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-bold border border-amber-200';
  }
}

/**
 * Escucha archivos del bloque actual (sin onSnapshot de colección completa).
 */
export function initArchivosSubscription(onUpdate) {
  const subscribe = (blockId) => {
    if (unsubArchivos) {
      unsubArchivos();
      unsubArchivos = null;
    }
    if (!blockId) {
      state.archivosNube = [];
      setArchivos([]);
      onUpdate?.();
      return;
    }
    const q = query(
      collection(db, dbPath),
      where('bloque', '==', blockId),
      limit(ARCHIVOS_PAGE)
    );
    unsubArchivos = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        state.archivosNube = docs;
        setArchivos(docs);
        applyCloudStatus(true);
        onUpdate?.();
      },
      (error) => {
        Logger.error('Firestore sync error (bloque):', error);
        applyCloudStatus(false);
        onUpdate?.();
      }
    );
  };

  on(EVENTS.BLOCK_SELECTED, (blockId) => subscribe(blockId));
  on(EVENTS.AUTH_STATE_CHANGED, () => subscribe(state.currentBlockId || null));

  subscribe(state.currentBlockId || null);
}

/**
 * @deprecated Usar initArchivosSubscription
 */
export function startArchivosSync(onUpdate) {
  Logger.warn('startArchivosSync está deprecado; use initArchivosSubscription');
  return initArchivosSubscription(onUpdate);
}

export function startEstadosBloquesSync(onUpdate) {
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
      snapshot.docs.forEach((d) => {
        docs[d.id] = d.data();
      });
      state.estadosBloques = docs;
      setEstadosBloques(docs);
      onUpdate?.();
    },
    (error) => {
      clearTimeout(timeoutId);
      Logger.error('Firestore estados_bloques sync error:', error);
      const statusEl = document.getElementById('estado-cumplimiento') || document.getElementById('audit-semaforo-label');
      if (statusEl) {
        statusEl.innerText = 'Error de conexión con la base de datos';
        statusEl.style.color = '#EF4444';
      }
      onUpdate?.();
    }
  );
}

export async function guardarEstadoBloque(blockId, datos) {
  try {
    const docRef = doc(db, COLLECTIONS.ESTADOS_BLOQUES, blockId);
    await setDoc(docRef, datos, { merge: true });
    return true;
  } catch (e) {
    Logger.error('Error guardando estado del bloque', e);
    throw e;
  }
}

export async function getAuditoriaCached(blockId) {
  try {
    const docRef = doc(db, COLLECTIONS.AUDITORIAS_BLOQUES, blockId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  } catch (e) {
    Logger.error('Error leyendo auditoría cacheada:', e);
    return null;
  }
}

export async function guardarAuditoria(blockId, auditResult, inventario) {
  try {
    const archivoHash = computeInventoryFingerprint(inventario);

    const docRef = doc(db, COLLECTIONS.AUDITORIAS_BLOQUES, blockId);
    await setDoc(docRef, {
      ...auditResult,
      archivoHash,
      totalArchivosAlAuditar: inventario.totalArchivos,
      fechaAuditoria: new Date().toISOString(),
      blockId,
    });
    return true;
  } catch (e) {
    Logger.error('Error guardando auditoría en caché:', e);
    throw e;
  }
}

export async function uploadReportToStorage(blockId, pdfBlob, fileName) {
  const path = `${STORAGE_PATHS.AUDITORIAS}/${blockId}/${fileName}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, pdfBlob, { contentType: 'application/pdf' });
  const url = await getDownloadURL(fileRef);
  return { url, storagePath: path };
}

export async function saveReportMetadata(blockId, blockName, downloadUrl, storagePath, userEmail) {
  const colRef = collection(db, COLLECTIONS.REPORTES_HISTORIAL);
  const docRef = await addDoc(colRef, {
    blockId,
    blockName,
    downloadUrl,
    storagePath,
    userEmail,
    fecha: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
  return docRef.id;
}

export async function getReportHistory() {
  try {
    const colRef = collection(db, COLLECTIONS.REPORTES_HISTORIAL);
    const q = query(colRef, orderBy('fecha', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    Logger.error('Error cargando historial de reportes:', e);
    return [];
  }
}

export async function deleteReport(reportId, storagePath) {
  if (storagePath) {
    try {
      const fileRef = storageRef(storage, storagePath);
      await deleteObject(fileRef);
    } catch (e) {
      Logger.warn('No se pudo borrar el archivo en Storage (puede ya no existir):', e);
    }
  }

  const docRef = doc(db, COLLECTIONS.REPORTES_HISTORIAL, reportId);
  await deleteDoc(docRef);
}
