/**
 * Configuración de Firebase y rutas de datos.
 * También contiene la configuración de Supabase (migración paralela).
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

// ═══════════════════════════════════════════════════════════════
// MIGRACIÓN — Supabase (DB_PROVIDER controla cuál proveedor usa la app)
// ═══════════════════════════════════════════════════════════════

/**
 * Cambia este valor para alternar entre proveedores:
 *   'firebase'  → usa Firebase (Auth, Firestore, Storage) — por defecto
 *   'supabase'  → usa Supabase (Auth, Postgres, Storage) y Cloud Run backend
 *
 * Durante la migración, Firebase permanece intacto sin importar este valor.
 */
export const DB_PROVIDER = 'firebase'; // Cambia a 'supabase' para activar Supabase

export const supabaseConfig = {
  url: 'https://scglhxbysycuqqzgzxhe.supabase.co',
  // Reemplaza este placeholder con la anon key real de tu proyecto Supabase
  // (Supabase Dashboard → Settings → API → Project API keys → anon/public)
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZ2xoeGJ5c3ljdXFxemdxenhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MjM3NjYsImV4cCI6MjA5NjM5OTc2Nn0.NqDjxhXnRXOWKeykQO8szLwe9vqgamb2Hwhu9_tRJ7o',
};

/** URL base del backend en Cloud Run (cambiar tras desplegar) */
export const CLOUD_RUN_BASE_URL = 'https://geovisor-iser-backend-303456177094.us-central1.run.app';

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
