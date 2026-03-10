/**
 * Servicio Firestore: sincronización en tiempo real y helpers para futuras colecciones.
 */
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db } from './firebase.js';
import { state, setArchivos } from '../core/state.js';
import { dbPath } from '../core/config.js';

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
