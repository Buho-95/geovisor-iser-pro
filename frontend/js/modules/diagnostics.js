/**
 * diagnostics.js — Herramientas de diagnóstico accesibles desde la consola.
 *
 * Expone `window.__geovisorDiag` con utilidades para verificar en tiempo real
 * los puntos críticos del flujo de subida / listado:
 *
 *   1. __geovisorDiag.env()      → entorno (isStaging, STORAGE_PREFIX)
 *   2. __geovisorDiag.bucket()   → bucket configurado en Supabase Storage
 *   3. __geovisorDiag.build({…}) → path que produciría buildStoragePath(...)
 *   4. __geovisorDiag.list(path) → listAll() sobre una ruta completa
 *   5. __geovisorDiag.listSelection()
 *                                → listAll() sobre la ruta actual del explorador
 *   6. __geovisorDiag.watch(sec) → cuenta eventos file-uploaded/file-deleted
 *                                  durante N segundos
 *   7. __geovisorDiag.compare(uploadPath, readPath)
 *                                → comparación carácter a carácter
 *   8. __geovisorDiag.lastUpload / .lastRead  → histórico del último path
 *
 * SOLO diagnóstico. No muta estado del sistema, no dispara eventos, no
 * cambia rutas ni reglas. Se puede desactivar con:
 *   localStorage.setItem('geovisor:disable-diag','1');
 */


import { state } from '../core/state.js';
import { isStaging } from '../core/env.js';
import { STORAGE_PREFIX } from '../core/paths.js';
import { buildStoragePath } from '../core/storage-routing.js';
import { Logger } from '../core/logger.js';

const state_ = {
  lastUpload: null, // { path, sedeId, bloqueId, carpeta, at }
  lastRead:   null, // { path, at, count }
  events:     [],   // [{ type, detail, at }]
};

/** Instala window.__geovisorDiag y listeners pasivos (no mutan nada). */
export function installDiagnostics() {
  try {
    if (localStorage.getItem('geovisor:disable-diag') === '1') {
      Logger.debug?.('[diag] desactivado por flag');
      return;
    }
  } catch { /* ignore */ }

  // Listener pasivo que captura el path real de subida a través del evento
  // que ya emite upload.js. No sustituye al logger: además guarda el último
  // path en `state_.lastUpload` para poder comparar desde consola.
  window.addEventListener('geovisor:file-uploaded', (e) => {
    const d = e?.detail || {};
    state_.lastUpload = { ...d, at: new Date().toISOString() };
    state_.events.push({ type: 'file-uploaded', detail: d, at: Date.now() });
    // eslint-disable-next-line no-console
    console.log('%c[diag] geovisor:file-uploaded', 'color:#22c55e;font-weight:bold', d);
  });
  window.addEventListener('geovisor:file-deleted', (e) => {
    const d = e?.detail || {};
    state_.events.push({ type: 'file-deleted', detail: d, at: Date.now() });
    // eslint-disable-next-line no-console
    console.log('%c[diag] geovisor:file-deleted', 'color:#f87171;font-weight:bold', d);
  });
  window.addEventListener('geovisor:file-upload-error', (e) => {
    state_.events.push({ type: 'file-upload-error', detail: e?.detail, at: Date.now() });
    // eslint-disable-next-line no-console
    console.warn('[diag] geovisor:file-upload-error', e?.detail);
  });

  const api = {
    /* ── 1. Entorno ─────────────────────────────────────────── */
    env() {
      const info = {
        isStaging,
        STORAGE_PREFIX,
        currentSede:    state?.currentSede    || null,
        currentBlockId: state?.currentBlockId || null,
        userRole:       state?.userRole       || null,
      };
      // eslint-disable-next-line no-console
      console.table(info);
      return info;
    },

    /* ── 2. Bucket Supabase Storage ─────────────────────────── */
    bucket() {
      // Supabase storage bucket es por defecto 'geovisor_storage'
      const bucket = 'geovisor_storage';
      // eslint-disable-next-line no-console
      console.log('%c[diag] Supabase Storage bucket:', 'font-weight:bold', bucket);
      return bucket;
    },

    /* ── 3. Path que produciría buildStoragePath ────────────── */
    build(parts) {
      const p = buildStoragePath(parts || {});
      // eslint-disable-next-line no-console
      console.log('%c[diag] buildStoragePath →', 'color:#67e8f9', p, '\nInput:', parts);
      return p;
    },

    /* ── 4. listAll() sobre un path arbitrario ──────────────── */
    async list(path) {
      if (!path) {
        // eslint-disable-next-line no-console
        console.warn('[diag] list(path): provee un path completo staging/...');
        return null;
      }
      try {
        const { listSupabaseStorage } = await import('../services/supabase.js');
        const r = await listSupabaseStorage(path);
        const files   = r.items.map(i => i.name);
        const folders = r.prefixes.map(p => p.name);
        state_.lastRead = { path, at: new Date().toISOString(), count: files.length };
        // eslint-disable-next-line no-console
        console.groupCollapsed(
          `%c[diag] listAll("${path}")  →  ${files.length} archivos · ${folders.length} subcarpetas`,
          'color:#22c55e;font-weight:bold'
        );
        // eslint-disable-next-line no-console
        console.log('files:', files);
        // eslint-disable-next-line no-console
        console.log('folders:', folders);
        // eslint-disable-next-line no-console
        console.groupEnd();
        return { files, folders };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[diag] listAll falló:', err);
        return { error: String(err?.message || err) };
      }
    },

    /* ── 5. listAll() sobre la ruta actual del explorador ───── */
    async listSelection() {
      // El explorador guarda su selección en un closure; la leemos a
      // partir del DOM (data-xpl-last-path) que sí es inspeccionable.
      // Fallback: el <code> del .xpl-meta tiene la fullStoragePath.
      const code = document.querySelector('#explorer-files-host .xpl-meta code');
      const path = code?.textContent?.trim();
      if (!path) {
        // eslint-disable-next-line no-console
        console.warn('[diag] no hay selección activa en el explorador');
        return null;
      }
      return api.list(path);
    },

    /* ── 6. Watcher de eventos por N segundos ───────────────── */
    watch(seconds = 10) {
      const t0 = Date.now();
      const counts = { 'file-uploaded': 0, 'file-deleted': 0, 'file-upload-error': 0 };
      const handler = (ev) => {
        if (counts[ev.type.split(':')[1]] !== undefined) {
          counts[ev.type.split(':')[1]]++;
        }
      };
      ['geovisor:file-uploaded','geovisor:file-deleted','geovisor:file-upload-error']
        .forEach(t => window.addEventListener(t, handler));
      // eslint-disable-next-line no-console
      console.log(`%c[diag] watch() activo ${seconds}s…`, 'color:#22c55e');
      return new Promise(resolve => {
        setTimeout(() => {
          ['geovisor:file-uploaded','geovisor:file-deleted','geovisor:file-upload-error']
            .forEach(t => window.removeEventListener(t, handler));
          const report = { duracionMs: Date.now() - t0, ...counts };
          // eslint-disable-next-line no-console
          console.table(report);
          resolve(report);
        }, seconds * 1000);
      });
    },

    /* ── 7. Comparación carácter a carácter ─────────────────── */
    compare(a, b) {
      const A = String(a || '');
      const B = String(b || '');
      const min = Math.min(A.length, B.length);
      let firstDiff = -1;
      for (let i = 0; i < min; i++) if (A[i] !== B[i]) { firstDiff = i; break; }
      if (firstDiff === -1 && A.length === B.length) {
        // eslint-disable-next-line no-console
        console.log('%c[diag] ✅ paths idénticos', 'color:#22c55e;font-weight:bold');
        return { equal: true };
      }
      if (firstDiff === -1) firstDiff = min;
      const context = 12;
      const ini = Math.max(0, firstDiff - context);
      // eslint-disable-next-line no-console
      console.warn('%c[diag] ⚠️  paths diferentes en índice ' + firstDiff,
        'color:#fbbf24;font-weight:bold');
      // eslint-disable-next-line no-console
      console.log('A:', A);
      // eslint-disable-next-line no-console
      console.log('B:', B);
      // eslint-disable-next-line no-console
      console.log('A…', JSON.stringify(A.slice(ini, firstDiff + context)));
      // eslint-disable-next-line no-console
      console.log('B…', JSON.stringify(B.slice(ini, firstDiff + context)));
      return { equal: false, firstDiff, a: A, b: B };
    },

    /* ── 8. Accesos directos ───────────────────────────────── */
    get lastUpload() { return state_.lastUpload; },
    get lastRead()   { return state_.lastRead; },
    get events()     { return state_.events.slice(-50); },

    /* ── 9. Help ───────────────────────────────────────────── */
    help() {
      // eslint-disable-next-line no-console
      console.log(`%c[diag] Geovisor — herramientas de diagnóstico
      env()                         → entorno + estado global
      bucket()                      → bucket Supabase Storage
      build({sedeId,bloque,disciplina,subcarpeta,archivo})
                                    → path resultante
      list("staging/sedes/…")       → listAll sobre una ruta
      listSelection()               → listAll de la ruta actual del explorador
      compare(a, b)                 → compara dos paths carácter a carácter
      watch(sec=10)                 → cuenta eventos file-uploaded en N seg
      lastUpload                    → último evento file-uploaded recibido
      lastRead                      → último list() ejecutado
      events                        → últimos 50 eventos file-*`,
        'color:#67e8f9');
    },
  };

  // Expón en window (nunca en modo prod si se quisiera limitar).
  window.__geovisorDiag = api;
  // eslint-disable-next-line no-console
  console.log(
    '%c[Geovisor] Diagnóstico activo → ' +
    'escribe %c__geovisorDiag.help()%c para ver las herramientas.',
    'color:#22c55e;font-weight:bold',
    'font-family:monospace;background:rgba(34,197,94,0.12);padding:2px 6px;border-radius:3px',
    'color:#22c55e',
  );
}

// Helper pequeño para el uploader: registra el path inmediatamente antes
// de llamar a uploadBytesResumable. Lo importa upload.js con una sola
// línea (adición pura, no cambia lógica).
export function logUploadPath(rutaStorage, meta = {}) {
  try {
    // eslint-disable-next-line no-console
    console.log(
      '%c[UPLOAD PATH]%c ' + rutaStorage,
      'background:#16a34a;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold',
      'color:#22c55e;font-family:monospace',
      meta,
    );
    state_.lastUpload = { path: rutaStorage, ...meta, phase: 'start', at: new Date().toISOString() };
  } catch { /* noop */ }
}

export function logUploadDone(rutaStorage, meta = {}) {
  try {
    // eslint-disable-next-line no-console
    console.log(
      '%c[UPLOAD DONE]%c ' + rutaStorage,
      'background:#22c55e;color:#052e13;padding:2px 6px;border-radius:3px;font-weight:bold',
      'color:#22c55e;font-family:monospace',
      meta,
    );
    state_.lastUpload = { path: rutaStorage, ...meta, phase: 'done', at: new Date().toISOString() };
  } catch { /* noop */ }
}

// Permite además verificar metadata individual de un archivo (peso, tipo, etc).
// Exportada por si se quiere usar fuera del API window.
export async function inspectFile(fullPath) {
  try {
    const { getSupabaseClient } = await import('../services/supabase.js');
    const sb = getSupabaseClient();
    const { data, error } = await sb.from('archivos_iser').select('*').eq('storage_path', fullPath).single();
    if (error) throw error;
    return data;
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}
