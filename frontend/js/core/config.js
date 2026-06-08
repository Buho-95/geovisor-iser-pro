/**
 * config.js — Configuración central de Supabase y rutas de datos.
 *
 * Stack: Supabase (Auth + PostgreSQL + Storage) + Cloud Run (API IA) + Vercel (hosting).
 *
 * IMPORTANTE: COLLECTIONS y STORAGE_PATHS son env-aware.
 * En staging apuntan a "staging_*" / "staging/..." automáticamente.
 * Ver: frontend/js/core/env.js + frontend/js/core/paths.js
 */
import { COLLECTIONS, STORAGE_PATHS } from './constants.js';
import { ENV_MODE, isStaging } from './env.js';

// ── Supabase ────────────────────────────────────────────────────────────────
// URL y anon key públicas (safe para el frontend — no confundir con service_role_key).
export const supabaseConfig = {
  url: 'https://scglhxbysycuqqzgqzxe.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZ2xoeGJ5c3ljdXFxemdxenhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MjM3NjYsImV4cCI6MjA5NjM5OTc2Nn0.NqDjxhXnRXOWKeykQO8szLwe9vqgamb2Hwhu9_tRJ7o',
};

// ── Backend Cloud Run ────────────────────────────────────────────────────────
export const CLOUD_RUN_BASE_URL = 'https://geovisor-iser-backend-303456177094.us-central1.run.app';

export const appId = typeof window.__app_id !== 'undefined' ? window.__app_id : 'iser-cde-pro';

// Rutas env-aware (ven constants.js + paths.js)
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
