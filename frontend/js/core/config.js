/**
 * Configuración de Supabase y rutas de datos.
 * Compatible con la estructura actual; extensible para nuevas colecciones.
 *
 * IMPORTANTE: COLLECTIONS, STORAGE_PATHS, dbPath y storageBasePath son env-aware.
 * En staging apuntan a "staging_*" / "staging/..." automáticamente.
 * Ver: frontend/js/core/env.js + frontend/js/core/paths.js
 */
import { COLLECTIONS, STORAGE_PATHS } from './constants.js';
import { ENV_MODE, isStaging } from './env.js';

// ═══════════════════════════════════════════════════════════════
// MIGRACIÓN — Supabase (DB_PROVIDER controla cuál proveedor usa la app)
// ═══════════════════════════════════════════════════════════════

export const DB_PROVIDER = 'supabase';

export const supabaseConfig = {
  url: 'https://scglhxbysycuqqzgqzxe.supabase.co',
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
