/**
 * file-explorer.js — Panel de archivos reales para el explorador BD.
 *
 * Escucha `geovisor:structure-path-selected` (emitido por structure-tree.js)
 * y lista los archivos en Storage para esa ruta jerárquica:
 *   <STORAGE_PREFIX>sedes/{sedeId}/{path...}
 *
 * SOLO frontend. NO modifica schema, seed, reglas ni rutas Storage.
 * Usa exclusivamente helpers ya existentes (`buildStoragePath`) y el SDK de Firebase.
 *
 * Acciones disponibles por archivo:
 *   - Ver       → openViewer(file)
 *   - Descargar → enlace `getDownloadURL`
 *   - Eliminar  → deleteObject (solo admin)
 *   - Subir aquí → pre-carga ruta y abre el modal de upload existente
 */
import { Logger } from '../core/logger.js';
import { state } from '../core/state.js';
import { buildStoragePath } from '../core/storage-routing.js';
import { STORAGE_PREFIX } from '../core/paths.js';
import { storage } from '../services/firebase.js';
import {
  ref as storageRef,
  listAll,
  getDownloadURL,
  getMetadata,
  deleteObject,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js';
import { openViewer, setVisorFileList } from '../visor.js';
import { getBloques } from '../core/structure-schema.js';

const HOST_ID = 'explorer-files-host';
const PLACEHOLDER_KEEP = '.keep';

let _wired = false;
let _currentSelection = null; // { sedeId, path, storagePath }

/* ═══════════════════════ PUBLIC API ═══════════════════════ */

export function mountFileExplorer(host) {
  if (!host) host = document.getElementById(HOST_ID);
  if (!host) return;
  host.classList.add('xpl-host');
  if (host.childElementCount === 0) {
    host.innerHTML = renderEmpty();
  }
  injectStyles();
  wireGlobalEventsOnce();
  wireHostInteractions(host);
}

/**
 * Carga programática de una ruta sin pasar por el evento (útil en pruebas).
 */
export async function showPath({ sedeId, path }) {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  await renderPath(host, { sedeId, path });
}

/**
 * API pública para navegar el explorador desde otros módulos.
 *
 * Equivalente al flujo completo que usa el click en el árbol:
 *   1. renderPath (pinta HTML en host, que YA tiene listeners delegados)
 *   2. _currentSelection actualizado
 *   3. Emite además `geovisor:structure-path-selected` para que
 *      otros módulos (dashboard, tree sincronizado, etc.) puedan reaccionar.
 *
 * Se usa como ruta "sólida" en navegación interna del explorador
 * (botón Volver, click en subcarpeta) para garantizar el flujo full:
 * render + estado + eventos.
 */
export async function setExplorerPath({ sedeId, path }) {
  const resolvedSede = sedeId || _currentSelection?.sedeId || state?.currentSede;
  if (!resolvedSede) {
    Logger.warn?.('[file-explorer] setExplorerPath: sede no resuelta');
    return;
  }
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  await renderPath(host, { sedeId: resolvedSede, path: String(path || '') });
  try {
    document.dispatchEvent(new CustomEvent('geovisor:structure-path-selected', {
      detail: { sedeId: resolvedSede, path: String(path || '') },
    }));
  } catch { /* noop */ }
}

/* ═══════════════════════ EVENT WIRING ═══════════════════════ */

function wireGlobalEventsOnce() {
  if (_wired) return;
  _wired = true;
  document.addEventListener('geovisor:structure-path-selected', async (e) => {
    const { sedeId, path } = e.detail || {};
    if (!sedeId || !path) return;
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    await renderPath(host, { sedeId, path });
  });
}

function wireHostInteractions(host) {
  if (host.dataset.xplWired === 'true') return;
  host.dataset.xplWired = 'true';

  // Accesibilidad: Enter/Space en un elemento con role="button" dispara click.
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target?.closest?.('[data-xpl-action]');
    if (!target) return;
    e.preventDefault();
    target.click();
  });

  host.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-xpl-action]');
    if (!btn) return;
    e.preventDefault();
    const action = btn.dataset.xplAction;

    if (action === 'refresh') {
      if (_currentSelection) await renderPath(host, _currentSelection);
      return;
    }
    if (action === 'back') {
      goBackFolder();
      return;
    }
    if (action === 'open-folder') {
      const folderName = btn.dataset.folderName;
      if (folderName) await openSubfolder(folderName);
      return;
    }
    if (action === 'upload-here') {
      openUploadAtCurrentPath();
      return;
    }
    if (action === 'view') {
      openFromCard(btn, 'view');
      return;
    }
    if (action === 'delete') {
      await deleteFromCard(host, btn);
      return;
    }
  });
}

/* ═══════════════════════ RENDER ═══════════════════════ */

async function renderPath(host, { sedeId, path }) {
  // path puede traer la ruta canónica completa partiendo de bloque o de carpeta nivel-sede.
  // Lo pasamos íntegro como `subcarpeta` (multi-segment soportado por buildStoragePath).
  const fullStoragePath = buildStoragePath({ sedeId, subcarpeta: path });
  _currentSelection = { sedeId, path, storagePath: fullStoragePath };

  host.innerHTML = renderShell({ sedeId, path, fullStoragePath, loading: true });

  try {
    // Query canonical + legacy paths in parallel for backwards compatibility
    const folderRef = storageRef(storage, fullStoragePath);
    const legacyPath = buildLegacyStoragePath(path);
    const [canonicalResult, legacyResult] = await Promise.all([
      listAll(folderRef),
      legacyPath
        ? listAll(storageRef(storage, legacyPath)).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Merge items from both paths, deduplicating by filename (canonical wins)
    let mergedItems = [...(canonicalResult.items || [])];
    let mergedPrefixes = [...(canonicalResult.prefixes || [])];
    if (legacyResult) {
      const existingNames = new Set(mergedItems.map(it => it.name));
      for (const it of (legacyResult.items || [])) {
        if (!existingNames.has(it.name)) mergedItems.push(it);
      }
      const existingPrefixNames = new Set(mergedPrefixes.map(p => p.name));
      for (const p of (legacyResult.prefixes || [])) {
        if (!existingPrefixNames.has(p.name)) mergedPrefixes.push(p);
      }
    }

    // Filtrar placeholders .keep que el seed crea para mantener carpetas vacías visibles.
    const items = mergedItems.filter(it => it.name !== PLACEHOLDER_KEEP);

    // Resolver metadata + URL en paralelo (con tolerancia a fallos individuales).
    const files = await Promise.all(items.map(async (it) => {
      try {
        const [meta, url] = await Promise.all([
          getMetadata(it).catch(() => null),
          getDownloadURL(it).catch(() => null),
        ]);
        return {
          name: it.name,
          fullPath: it.fullPath,
          size: meta?.size ?? null,
          contentType: meta?.contentType ?? null,
          updated: meta?.updated ?? meta?.timeCreated ?? null,
          url,
        };
      } catch (err) {
        Logger.warn?.('[file-explorer] no se pudo leer metadata:', err?.message || err);
        return { name: it.name, fullPath: it.fullPath, size: null, contentType: null, updated: null, url: null };
      }
    }));

    // Ordenar: por fecha desc, fallback por nombre.
    files.sort((a, b) => {
      if (a.updated && b.updated) return new Date(b.updated) - new Date(a.updated);
      return String(a.name).localeCompare(String(b.name));
    });

    const subfolders = mergedPrefixes.map(p => ({ name: p.name }));
    host.innerHTML = renderShell({ sedeId, path, fullStoragePath, files, subfolders });
    // Actualizar lista de navegación del visor para flechas prev/next.
    try {
      setVisorFileList(files.map(f => ({
        nombre: f.name,
        url: f.url,
        tipo: guessTipo(f.name),
        storagePath: f.fullPath,
      })));
    } catch { /* noop */ }
  } catch (err) {
    Logger.error('[file-explorer] Error listando ruta:', err);
    host.innerHTML = renderShell({ sedeId, path, fullStoragePath, error: err?.message || String(err) });
  }
}

function renderEmpty() {
  return `
    <div class="xpl-empty">
      <i class="ph ph-folder-open"></i>
      <p class="xpl-empty-title">Selecciona una carpeta del árbol</p>
      <p class="xpl-empty-sub">Aquí aparecerán los archivos de la ruta elegida (sede → bloque → disciplina → subcarpeta).</p>
    </div>
  `;
}

function renderShell({ sedeId, path, fullStoragePath, files, subfolders, loading, error }) {
  const breadcrumb = renderBreadcrumb(sedeId, path);
  const isAdmin = state?.userRole === 'admin';
  const list = loading
    ? `<div class="xpl-loading">Cargando archivos…</div>`
    : error
    ? `<div class="xpl-error"><i class="ph ph-warning-circle"></i> ${escapeHtml(error)}</div>`
    : renderList(files || [], subfolders || [], isAdmin);

  // "Volver" sólo tiene sentido cuando el path actual tiene al menos 2 segmentos
  // (p. ej. Bloque/Disciplina → al pulsar vuelve al Bloque). Si estamos en el
  // primer nivel (sólo 1 segmento), lo deshabilitamos para evitar emitir un
  // `structure-path-selected` vacío que el listener descartaría igualmente.
  const parts    = String(path || '').split('/').filter(Boolean);
  const canBack  = parts.length >= 2;
  const backBtn  = `
    <button class="xpl-btn xpl-btn-back"
            data-xpl-action="back"
            title="Volver a la carpeta anterior"
            ${canBack ? '' : 'disabled aria-disabled="true"'}>
      <i class="ph ph-arrow-u-up-left"></i> Volver
    </button>`;

  return `
    <div class="xpl-wrap">
      <div class="xpl-header">
        <div class="xpl-bread">${breadcrumb}</div>
        <div class="xpl-actions">
          ${backBtn}
          <button class="xpl-btn" data-xpl-action="refresh" title="Refrescar">
            <i class="ph ph-arrows-clockwise"></i>
          </button>
          ${isAdmin ? `
            <button class="xpl-btn xpl-btn-primary" data-xpl-action="upload-here" title="Subir archivo a esta carpeta">
              <i class="ph ph-cloud-arrow-up"></i> Subir aquí
            </button>` : ''}
        </div>
      </div>
      <div class="xpl-meta">
        <code title="Ruta Storage">${escapeHtml(fullStoragePath)}</code>
      </div>
      <div class="xpl-body">
        ${list}
      </div>
    </div>
  `;
}

function renderBreadcrumb(sedeId, path) {
  const parts = String(path).split('/').filter(Boolean);
  const sedeLabel = ({ pamplona: 'Pamplona', rinconada: 'Rinconada', caldera: 'Caldera' })[sedeId] || sedeId;
  const crumbs = [`<span class="xpl-crumb root"><i class="ph ph-buildings"></i> ${escapeHtml(sedeLabel)}</span>`];
  for (const p of parts) crumbs.push(`<span class="xpl-crumb"><i class="ph ph-caret-right"></i> ${escapeHtml(p)}</span>`);
  return crumbs.join('');
}

function renderList(files, subfolders, isAdmin) {
  if (files.length === 0 && subfolders.length === 0) {
    return `
      <div class="xpl-empty xpl-empty-inline">
        <i class="ph ph-folder-simple-dashed"></i>
        <p class="xpl-empty-title">Carpeta vacía</p>
        <p class="xpl-empty-sub">No hay archivos aún en esta ruta.</p>
      </div>
    `;
  }
  // Las subcarpetas son navegables: al hacer click se entra en ellas
  // siguiendo el flujo completo (render + estado + eventos). El handler
  // está delegado en el host (wireHostInteractions).
  const subRows = subfolders.map(s => `
    <div class="xpl-row xpl-row-folder"
         data-xpl-action="open-folder"
         data-folder-name="${escapeAttr(s.name)}"
         role="button"
         tabindex="0"
         title="Abrir ${escapeAttr(s.name)}">
      <i class="ph-fill ph-folder xpl-icon"></i>
      <span class="xpl-name">${escapeHtml(s.name)}</span>
      <span class="xpl-pill">subcarpeta</span>
      <i class="ph ph-caret-right xpl-chev" aria-hidden="true"></i>
    </div>
  `).join('');

  const fileRows = files.map(f => {
    const tipo = guessTipo(f.name);
    return `
      <div class="xpl-row xpl-row-file"
           data-name="${escapeAttr(f.name)}"
           data-url="${escapeAttr(f.url || '')}"
           data-storage-path="${escapeAttr(f.fullPath)}"
           data-tipo="${escapeAttr(tipo)}">
        <i class="ph ${iconForTipo(tipo)} xpl-icon"></i>
        <div class="xpl-name-block">
          <span class="xpl-name">${escapeHtml(f.name)}</span>
          <span class="xpl-sub">${formatSize(f.size)} · ${formatDate(f.updated)} · ${escapeHtml(tipo.toUpperCase())}</span>
        </div>
        <div class="xpl-row-actions">
          ${f.url ? `<button class="xpl-btn xpl-btn-mini" data-xpl-action="view" title="Ver">
                       <i class="ph ph-eye"></i>
                     </button>` : ''}
          ${f.url ? `<a class="xpl-btn xpl-btn-mini" href="${escapeAttr(f.url)}" target="_blank" rel="noopener" title="Descargar">
                       <i class="ph ph-download-simple"></i>
                     </a>` : ''}
          ${isAdmin ? `<button class="xpl-btn xpl-btn-mini xpl-btn-danger" data-xpl-action="delete" title="Eliminar">
                         <i class="ph ph-trash"></i>
                       </button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `<div class="xpl-list">${subRows}${fileRows}</div>`;
}

/* ═══════════════════════ ACTIONS ═══════════════════════ */

function openFromCard(btn, _action) {
  const card = btn.closest('.xpl-row-file');
  if (!card) return;
  const file = {
    nombre: card.dataset.name,
    url: card.dataset.url,
    tipo: card.dataset.tipo,
    storagePath: card.dataset.storagePath,
  };
  if (!file.url) {
    Logger.warn?.('[file-explorer] archivo sin URL, no se puede abrir:', file.nombre);
    return;
  }
  try { openViewer(file); }
  catch (err) { Logger.error('[file-explorer] Error abriendo visor:', err); }
}

async function deleteFromCard(host, btn) {
  const card = btn.closest('.xpl-row-file');
  if (!card) return;
  const name = card.dataset.name;
  const fullPath = card.dataset.storagePath;
  if (!confirm(`¿Eliminar "${name}"?\n\nEsta acción no se puede deshacer.`)) return;
  try {
    await deleteObject(storageRef(storage, fullPath));
    Logger.info(`[file-explorer] Eliminado: ${fullPath}`);
    // Emitir evento único (bootstrap lo escucha para invalidar caches del dashboard).
    try {
      window.dispatchEvent(new CustomEvent('geovisor:file-deleted', {
        detail: { storagePath: fullPath, name, sedeId: _currentSelection?.sedeId || null },
      }));
    } catch { /* noop */ }
    if (_currentSelection) await renderPath(host, _currentSelection);
  } catch (err) {
    Logger.error('[file-explorer] Error eliminando:', err);
    alert('No se pudo eliminar: ' + (err?.message || err));
  }
}

/**
 * Sube un nivel en la jerarquía del explorador actual.
 *
 * Usa `setExplorerPath` (no el CustomEvent) para garantizar el flujo
 * completo: render + estado + emisión del evento para oyentes externos.
 * Así la navegación "Volver" es idéntica en todo a un click desde el árbol
 * y no se pierde interactividad al re-renderizar.
 *
 * Reglas:
 *   - Si no hay selección activa → no-op.
 *   - Si el path tiene ≤ 1 segmento → no-op (el botón ya está `disabled`
 *     en esa situación; este guard es una segunda red de seguridad).
 */
function goBackFolder() {
  const sel = _currentSelection;
  if (!sel || !sel.path) return;
  const parts = String(sel.path).split('/').filter(Boolean);
  if (parts.length <= 1) return;

  parts.pop();
  const newPath = parts.join('/');

  // FIX 1 del brief: flujo completo (render + estado + evento) en lugar
  // de un evento suelto que dependería de listeners externos correctos.
  setExplorerPath({ sedeId: sel.sedeId, path: newPath })
    .catch(err => Logger.warn?.('[file-explorer] goBackFolder:', err?.message));
}

/**
 * Abre una subcarpeta listada en la vista actual.
 *
 * Se dispara al hacer click en un `.xpl-row-folder`. Construye el nuevo
 * path concatenando la selección actual + el nombre de la subcarpeta, y
 * delega en `setExplorerPath` (misma vía que el árbol o el botón Volver).
 */
async function openSubfolder(folderName) {
  const sel = _currentSelection;
  if (!sel || !folderName) return;
  const base = String(sel.path || '').replace(/\/+$/, '');
  const newPath = base ? `${base}/${folderName}` : folderName;
  try {
    await setExplorerPath({ sedeId: sel.sedeId, path: newPath });
  } catch (err) {
    Logger.warn?.('[file-explorer] openSubfolder:', err?.message);
  }
}

/**
 * Abre el modal de subida con el contexto actual del explorador.
 *
 * IMPORTANTE: el path del explorador puede incluir el bloque canónico como
 * primer segmento (p. ej. "05_Bloque_IA_Residencias/01_Arquitectonico/01_Modelos_2D_AutoCAD").
 * El módulo de upload, en staging, reconstruye la ruta con
 * `buildStoragePath({ sedeId, bloque, disciplina, subcarpeta })` usando
 * `state.currentBlockId` como bloque. Si no normalizamos, el primer segmento
 * (el bloque canónico) terminaría tratado como "disciplina", produciendo
 * rutas duplicadas y archivos que NO aparecen al listar.
 *
 * Estabilidad (ajustes críticos):
 *   - Flag `_uploadOpening` para evitar que un doble-click lance varias
 *     aperturas encadenadas (cada click sintético sobre #btn-open-upload
 *     dispara `setupFolderCascade` que toca el DOM).
 *   - `Promise.race` con timeout de 2 s sobre `getBloques(sedeId)`: si el
 *     schema tarda en resolver, abrimos el modal con el path tal cual,
 *     en vez de dejar al usuario esperando indefinidamente.
 *   - try/catch externo: cualquier fallo inesperado abre el modal igualmente
 *     y garantiza el reset del flag (finally).
 */
let _uploadOpening = false;

function openUploadAtCurrentPath() {
  if (_uploadOpening) return;                    // anti-reentrada
  if (!_currentSelection) return;
  _uploadOpening = true;

  // Fallback duro: si algo se cuelga (await infinito, schema no resuelve),
  // liberamos el flag a los 2 s para no dejar la UI bloqueada.
  const safetyTimer = setTimeout(() => {
    if (_uploadOpening) {
      _uploadOpening = false;
      Logger.warn?.('[file-explorer] openUploadAtCurrentPath: fallback timeout');
    }
  }, 2000);

  // Lanzamos el trabajo async aislado en IIFE para que el caller retorne
  // inmediatamente (el event handler del click no queda esperando).
  (async () => {
    try {
      const { sedeId, path } = _currentSelection;
      let uploadPath = String(path || '');

      try {
        const bloquesCanonicos = await Promise.race([
          getBloques(sedeId),
          new Promise((_, rej) => setTimeout(() => rej(new Error('schema-timeout')), 1500)),
        ]);
        const segments = uploadPath.split('/').filter(Boolean);
        if (Array.isArray(bloquesCanonicos)
            && segments.length
            && bloquesCanonicos.includes(segments[0])) {
          // Removemos el bloque del path; upload.js ya lo anida vía state.currentBlockId.
          uploadPath = segments.slice(1).join('/');
        }
      } catch (err) {
        // No bloqueamos: abrimos el modal con el path tal cual.
        Logger.debug?.('[file-explorer] no se pudo normalizar path (continuo igual):', err?.message);
      }

      const hidden = document.getElementById('up-folder');
      if (hidden) hidden.value = uploadPath;

      const modal = document.getElementById('upload-modal');
      if (modal) {
        modal.dataset.source = 'explorer';
        modal.dataset.sedeId = sedeId || '';
        modal.dataset.path = uploadPath;
        modal.dataset.pathOriginal = String(path || '');
      }

      const btn = document.getElementById('btn-open-upload');
      btn?.click();
    } catch (err) {
      Logger.error('[file-explorer] openUploadAtCurrentPath fallo:', err);
    } finally {
      clearTimeout(safetyTimer);
      _uploadOpening = false;
    }
  })();
}

/* ═══════════════════════ LEGACY PATH BUILDER ═══════════════════════ */

/**
 * Construye la ruta de Storage legada (documentos_iser/{path}) para
 * buscar archivos heredados que no están bajo la estructura canónica sedes/.
 * Retorna null si no hay path.
 */
function buildLegacyStoragePath(path) {
  if (!path) return null;
  const prefix = STORAGE_PREFIX || '';
  return `${prefix}documentos_iser/${path}`;
}

/* ═══════════════════════ HELPERS ═══════════════════════ */

function guessTipo(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  if (['pdf'].includes(ext)) return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'imagen';
  if (['glb', 'gltf', 'obj', 'fbx'].includes(ext)) return '3d';
  if (['skp'].includes(ext)) return 'sketchup';
  if (['rvt', 'ifc'].includes(ext)) return 'bim';
  if (['dwg', 'dxf'].includes(ext)) return 'cad';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'excel';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (['doc', 'docx'].includes(ext)) return 'documento';
  return 'otro';
}

function iconForTipo(t) {
  return ({
    pdf: 'ph-file-pdf',
    imagen: 'ph-image',
    '3d': 'ph-cube',
    sketchup: 'ph-cube',
    bim: 'ph-buildings',
    cad: 'ph-ruler',
    excel: 'ph-file-xls',
    video: 'ph-film-strip',
    documento: 'ph-file-doc',
  })[t] || 'ph-file';
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return '—'; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

/* ═══════════════════════ STYLES ═══════════════════════ */

function injectStyles() {
  if (document.getElementById('xpl-styles')) return;
  const css = `
    .xpl-host { display:block; padding: 0 14px 14px; }
    .xpl-wrap { display:flex; flex-direction:column; gap:10px; padding: 12px; background: rgba(15,23,42,0.55); border:1px solid rgba(148,163,184,0.18); border-radius:10px; }
    .xpl-header { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
    .xpl-bread { display:flex; flex-wrap:wrap; gap:4px; align-items:center; font-size:0.74rem; color:#cbd5e1; }
    .xpl-crumb { display:inline-flex; align-items:center; gap:4px; padding: 2px 6px; border-radius:6px; background: rgba(148,163,184,0.06); font-family: ui-monospace, Menlo, Consolas, monospace; }
    .xpl-crumb.root { background: rgba(34,211,238,0.10); color:#67e8f9; border:1px solid rgba(34,211,238,0.22); }
    .xpl-crumb i { color:#94a3b8; font-size:11px; }
    .xpl-actions { display:flex; gap:6px; }
    .xpl-btn { background: rgba(148,163,184,0.08); border:1px solid rgba(148,163,184,0.22); color:#cbd5e1; border-radius:6px; padding: 6px 10px; font-size:0.74rem; font-weight:600; display:inline-flex; align-items:center; gap:6px; cursor:pointer; text-decoration:none; }
    .xpl-btn:hover { color:#fff; border-color: rgba(34,211,238,0.55); background: rgba(34,211,238,0.10); }
    .xpl-btn-primary { background: linear-gradient(135deg,#06b6d4,#0284c7); border-color: transparent; color:#fff; }
    .xpl-btn-primary:hover { filter: brightness(1.08); border-color: transparent; }
    .xpl-btn-mini { padding: 4px 7px; font-size:0.72rem; }
    .xpl-btn-danger { color:#fca5a5; border-color: rgba(239,68,68,0.4); }
    .xpl-btn-danger:hover { background: rgba(239,68,68,0.14); color:#fff; border-color:#ef4444; }
    .xpl-btn-back i { font-size: 0.92rem; }
    .xpl-btn:disabled, .xpl-btn[disabled] { opacity: 0.45; cursor: not-allowed; pointer-events: none; }
    .xpl-btn:active:not(:disabled) { transform: scale(0.97); }

    .xpl-meta { font-size:0.66rem; color:#64748b; word-break: break-all; }
    .xpl-meta code { background: transparent; color:#64748b; }

    .xpl-body { display:block; }
    .xpl-list { display:flex; flex-direction:column; gap:4px; }
    .xpl-row { display:flex; align-items:center; gap:10px; padding: 8px 10px; border-radius:8px; background: rgba(148,163,184,0.04); border:1px solid transparent; transition: background .12s ease, border-color .12s ease, transform .08s ease; }
    .xpl-row:hover { background: rgba(148,163,184,0.08); border-color: rgba(148,163,184,0.18); }
    .xpl-row-folder { cursor: pointer; user-select: none; }
    .xpl-row-folder:hover { background: rgba(34,197,94,0.08); border-color: rgba(34,197,94,0.28); }
    .xpl-row-folder:focus-visible { outline: 2px solid rgba(34,197,94,0.55); outline-offset: 2px; }
    .xpl-row-folder:active { transform: scale(0.996); background: rgba(34,197,94,0.12); }
    .xpl-chev { margin-left:auto; font-size:14px; color:#64748b; opacity:0; transition: opacity .15s ease, transform .15s ease; }
    .xpl-row-folder:hover .xpl-chev { opacity:1; transform: translateX(2px); color:#22c55e; }
    .xpl-icon { font-size:18px; color:#94a3b8; flex: 0 0 auto; }
    .xpl-row-folder .xpl-icon { color:#fbbf24; }
    .xpl-row-file .xpl-icon { color:#67e8f9; }
    .xpl-name-block { display:flex; flex-direction:column; flex:1 1 auto; min-width:0; }
    .xpl-name { font-family: ui-monospace, Menlo, Consolas, monospace; font-size:0.78rem; color:#e5e7eb; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .xpl-sub { font-size:0.66rem; color:#64748b; }
    .xpl-pill { font-size:0.6rem; padding:1px 6px; border-radius:999px; background: rgba(148,163,184,0.12); color:#cbd5e1; }
    .xpl-row-actions { display:flex; gap:4px; opacity:0.4; transition: opacity .15s; }
    .xpl-row:hover .xpl-row-actions { opacity:1; }

    .xpl-loading, .xpl-error { padding:18px; text-align:center; color:#94a3b8; font-size:0.8rem; }
    .xpl-error { color:#fca5a5; }
    .xpl-empty { padding: 24px 16px; text-align:center; color:#94a3b8; }
    .xpl-empty-inline { padding: 14px; }
    .xpl-empty i { font-size: 2.2rem; display:block; margin-bottom:6px; color:#64748b; }
    .xpl-empty-title { font-weight:700; color:#cbd5e1; margin-bottom:2px; font-size:0.85rem; }
    .xpl-empty-sub { font-size:0.72rem; color:#64748b; }
  `;
  const style = document.createElement('style');
  style.id = 'xpl-styles';
  style.textContent = css;
  document.head.appendChild(style);
}
