/**
 * Configuración de Firebase y rutas de datos.
 * Compatible con la estructura actual; extensible para nuevas colecciones.
 *
 * IMPORTANTE: COLLECTIONS, STORAGE_PATHS, dbPath y storageBasePath son env-aware.
 * En staging apuntan a "staging_*" / "staging/..." automáticamente.
 * Ver: frontend/js/core/env.js + frontend/js/core/paths.js
 */
import { COLLECTIONS, STORAGE_PATHS } from './constants.js';
import { ENV_MODE, isStaging } from './env.js';

export const firebaseConfig = {
  apiKey: "AIzaSyDCBvXKtPaK_BCzW97RoyiTMRAhCUC5Uyk",
  authDomain: "geovisor-iser.firebaseapp.com",
  projectId: "geovisor-iser",
  storageBucket: "geovisor-iser.firebasestorage.app",
  messagingSenderId: "303456177094",
  appId: "1:303456177094:web:ee20c87df7333a397600c7"
};

export const appId = typeof window.__app_id !== 'undefined' ? window.__app_id : 'iser-cde-pro';

// Rutas actuales (env-aware vía constants.js)
export const dbPath = COLLECTIONS.ARCHIVOS;
export const storageBasePath = STORAGE_PATHS.DOCUMENTOS;

if (typeof console !== 'undefined') {
  const tag = isStaging ? '🟠 STAGING' : (ENV_MODE === 'development' ? '🔴 DEV' : '🟢 PROD');
  console.log(
    `[config] ${tag} · ENV=${ENV_MODE}\n` +
    `         · archivos: ${COLLECTIONS.ARCHIVOS}\n` +
    `         · storage:  ${STORAGE_PATHS.DOCUMENTOS}`
  );
}

export { COLLECTIONS, STORAGE_PATHS };
