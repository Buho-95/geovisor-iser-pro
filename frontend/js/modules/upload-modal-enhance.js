/**
 * upload-modal-enhance.js — Envoltorio UI/UX del modal de subida.
 *
 * RESPONSABILIDAD:
 *   - Unificar el punto de carga a un único flujo contextual:
 *     el usuario pulsa "Subir aquí" dentro del explorador, y este módulo
 *     garantiza que el modal abierto refleje EXACTAMENTE la ruta elegida.
 *
 * QUE HACE:
 *   1. Al detectar la apertura del modal (classList "activo"), restaura el
 *      valor del `#up-folder` desde `dataset.path` del overlay (pisado por
 *      `setupFolderCascade`) y habilita la drop-zone.
 *   2. Renderiza un breadcrumb contextual ("Sede / Bloque / Disciplina / Subcarpeta").
 *   3. Aplica la clase `.modo-contextual` al `.modal-upload` para que el CSS
 *      oculte los selects legacy y muestre sólo la experiencia unificada.
 *   4. Escucha `geovisor:file-uploaded` → muestra el estado de éxito y
 *      auto-cierra el modal a los 1.5 s.
 *   5. Escucha `geovisor:file-upload-error` → muestra el estado de error con
 *      botón "Reintentar" (re-envía el form sin duplicar la lógica de upload).
 *
 * QUE NO HACE (REGLAS CRÍTICAS):
 *   - NO modifica la lógica de subida (upload.js).
 *   - NO construye paths de Storage (usa buildStoragePath vía upload.js).
 *   - NO duplica listeners existentes; sólo añade comportamiento visual.
 *   - NO toca `storage-routing.js`, `firebase.js`, ni el schema.
 */

import { Logger } from '../core/logger.js';

const MODAL_ID         = 'upload-modal';
const BREADCRUMB_LIST  = 'upload-breadcrumb-list';
const STATE_OVERLAY    = 'upload-state-overlay';
const STATE_ERROR_MSG  = 'upload-state-error-msg';
const RETRY_BTN        = 'btn-upload-retry';
const HIDDEN_FOLDER    = 'up-folder';
const DROP_ZONE        = 'drop-zone';
const UPLOAD_FORM      = 'upload-form';
const BLOCK_NAME_EL    = 'upload-block-name';

const LEGACY_CLOSE_MS  = 1500; // auto-close tras éxito

let _mounted     = false;
let _isHandling  = false;   // guard anti-reentrada para el MutationObserver
let _lastActive  = false;   // estado previo de `activo` para deduplicar eventos
let _rafPending  = null;    // id de requestAnimationFrame en vuelo

export function enhanceUploadModal() {
  if (_mounted) return;

  // Kill-switch de diagnóstico: permite desactivar el enhancer sin tocar
  // código para verificar si un freeze proviene de esta capa. Activar con
  //   localStorage.setItem('geovisor:disable-upload-enhance','1');
  //   location.reload();
  try {
    if (window.__DISABLE_UPLOAD_ENHANCE === true
        || localStorage.getItem('geovisor:disable-upload-enhance') === '1') {
      Logger.warn?.('[upload-enhance] desactivado por kill-switch (diagnóstico)');
      return;
    }
  } catch { /* localStorage puede fallar en modo privado */ }

  const modal = document.getElementById(MODAL_ID);
  if (!modal) {
    Logger.debug?.('[upload-enhance] modal no encontrado, no se monta');
    return;
  }
  _mounted = true;

  // Por defecto arrancamos en modo contextual: el flujo único es "Subir aquí".
  // Esto se aplica UNA sola vez en mount (antes de arrancar el observer),
  // para evitar que la propia mutación dispare un ciclo.
  if (!modal.classList.contains('modo-contextual')) {
    modal.classList.add('modo-contextual');
  }
  _lastActive = modal.classList.contains('activo');

  // Observamos sólo cambios de `class`. Usamos `attributeOldValue: true`
  // para comparar estados y evitar re-entradas cuando la misma clase se
  // reaplica (p. ej. un remove + add redundante). El handler:
  //   · Se protege con flag `_isHandling`.
  //   · Defiere el trabajo en `requestAnimationFrame`, dejando que el DOM
  //     se estabilice antes de mutarlo, y permitiendo que cualquier mutación
  //     secundaria (breadcrumb innerHTML, drop-zone classList) no se
  //     entrelace con el observer.
  //   · Sólo reacciona cuando cambia el estado `activo`, nunca cuando se
  //     toca otra clase (p. ej. modo-contextual).
  const observer = new MutationObserver((mutations) => {
    if (_isHandling) return;
    let shouldProcess = false;
    for (const m of mutations) {
      if (m.attributeName !== 'class') continue;
      const wasActive = _lastActive;
      const isActive  = modal.classList.contains('activo');
      if (wasActive !== isActive) {
        shouldProcess = true;
        break;
      }
    }
    if (!shouldProcess) return;

    if (_rafPending !== null) cancelAnimationFrame(_rafPending);
    _rafPending = requestAnimationFrame(() => {
      _rafPending = null;
      if (_isHandling) return;
      _isHandling = true;
      // Reset hard del flag a 300 ms: si algún handler se cuelga, el modal
      // vuelve a estar operativo en lugar de quedarse ignorando eventos.
      const safety = setTimeout(() => { _isHandling = false; }, 300);
      try {
        const isActive = modal.classList.contains('activo');
        _lastActive = isActive;
        if (isActive) onOpen(modal);
        else          onClose(modal);
      } catch (err) {
        Logger.warn?.('[upload-enhance] observer handler error:', err?.message);
      } finally {
        clearTimeout(safety);
        _isHandling = false;
      }
    });
  });
  observer.observe(modal, {
    attributes: true,
    attributeFilter: ['class'],
    attributeOldValue: true,
  });

  // Listeners globales (una sola vez).
  window.addEventListener('geovisor:file-uploaded', onUploadSuccess);
  window.addEventListener('geovisor:file-upload-error', onUploadError);

  // Botón "Reintentar" en el estado de error → re-envío del form.
  const retryBtn = document.getElementById(RETRY_BTN);
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      hideStateOverlay();
      const form = document.getElementById(UPLOAD_FORM);
      if (form) form.requestSubmit();
    });
  }

  Logger.debug?.('[upload-enhance] montado');
}

/* ═══════════════════════════════════════════════════════
   APERTURA / CIERRE DEL MODAL
   ═══════════════════════════════════════════════════════ */

function onOpen(modal) {
  try {
    // 1. Restaurar el path si viene del explorador (setupFolderCascade lo pisa
    //    al inicializar los selects legacy con valores vacíos).
    const sourceFromExplorer = modal.dataset.source === 'explorer';
    const contextualPath     = modal.dataset.path || '';
    if (sourceFromExplorer && contextualPath) {
      const hidden = document.getElementById(HIDDEN_FOLDER);
      if (hidden) hidden.value = contextualPath;

      const dropZone = document.getElementById(DROP_ZONE);
      // `drop-zone` es otro elemento (no observado) → no causa loop, pero
      // comprobamos antes de mutar para evitar notificaciones redundantes.
      if (dropZone && dropZone.classList.contains('disabled')) {
        dropZone.classList.remove('disabled');
      }
    }

    // 2. Renderizar breadcrumb contextual (sólo innerHTML del <ol>, no
    //    muta atributos del `#upload-modal` → no retroalimenta al observer).
    renderBreadcrumb(modal);

    // 3. NO mutamos `class` del modal aquí: `modo-contextual` se garantiza
    //    una sola vez en `enhanceUploadModal()` al montar. Re-aplicarla
    //    dentro del observer es la receta perfecta para un loop, ya que
    //    algunos navegadores (y WebKit en particular) emiten un mutation
    //    record aunque la clase ya esté presente.
    hideStateOverlay();
  } catch (err) {
    Logger.warn?.('[upload-enhance] onOpen:', err?.message);
  }
}

function onClose(modal) {
  // Limpieza del dataset para que la próxima apertura (posiblemente desde
  // otro punto) no hereda contexto viejo.
  try {
    delete modal.dataset.source;
    delete modal.dataset.sedeId;
    delete modal.dataset.path;
    delete modal.dataset.pathOriginal;
  } catch { /* noop */ }
  hideStateOverlay();
}

/* ═══════════════════════════════════════════════════════
   BREADCRUMB CONTEXTUAL
   ═══════════════════════════════════════════════════════ */

function renderBreadcrumb(modal) {
  const list = document.getElementById(BREADCRUMB_LIST);
  if (!list) return;

  const segments = collectContextSegments(modal);
  if (segments.length === 0) {
    list.innerHTML = `
      <li class="upload-breadcrumb-item placeholder">
        Selecciona una carpeta desde el explorador
      </li>`;
    return;
  }

  list.innerHTML = segments
    .map((seg, idx) => {
      const last = idx === segments.length - 1 ? ' is-last' : '';
      const icon = seg.icon
        ? `<i class="ph ${seg.icon}" aria-hidden="true"></i>`
        : '';
      return `
        <li class="upload-breadcrumb-item${last}" title="${escapeAttr(seg.title || seg.label)}">
          ${icon}<span>${escapeHtml(seg.label)}</span>
        </li>`;
    })
    .join('<li class="upload-breadcrumb-sep" aria-hidden="true">/</li>');
}

function collectContextSegments(modal) {
  const segments = [];

  // Sede — desde dataset o del span legacy (upload-block-name pertenece al
  // bloque, no a la sede; leemos el nombre desde el h1 si existe en el DOM).
  const sedeId = modal.dataset.sedeId || '';
  if (sedeId) {
    segments.push({
      label: prettify(sedeId),
      title: `Sede: ${prettify(sedeId)}`,
      icon: 'ph-buildings',
    });
  }

  // Bloque — usamos el span `upload-block-name` poblado por ui.js/map.
  const blockNameEl = document.getElementById(BLOCK_NAME_EL);
  const blockName = (blockNameEl?.textContent || '').trim();
  if (blockName && blockName !== '[Nombre del Bloque]') {
    segments.push({
      label: blockName,
      title: `Bloque: ${blockName}`,
      icon: 'ph-map-pin',
    });
  }

  // Path restante (disciplina / subcarpeta / ...). Preferimos el contextual
  // guardado por `openUploadAtCurrentPath` (sin bloque). Si no, usamos el
  // hidden actual (cascade de selects).
  const path = (modal.dataset.path || document.getElementById(HIDDEN_FOLDER)?.value || '').trim();
  if (path) {
    const parts = path.split('/').filter(Boolean);
    for (const p of parts) {
      segments.push({ label: prettify(p), title: p, icon: 'ph-folder' });
    }
  }

  return segments;
}

function prettify(raw) {
  // Convierte "05_Bloque_IA_Residencias" → "Bloque IA Residencias"
  //          "01_Arquitectonico"         → "01 Arquitectónico" (best effort)
  //          "pamplona"                  → "Pamplona"
  const s = String(raw || '').replace(/_/g, ' ');
  return s
    .split(' ')
    .map(w => w ? w[0].toUpperCase() + w.slice(1) : w)
    .join(' ');
}

/* ═══════════════════════════════════════════════════════
   ESTADO DE ÉXITO / ERROR (overlay interno)
   ═══════════════════════════════════════════════════════ */

function onUploadSuccess() {
  const modal = document.getElementById(MODAL_ID);
  if (!modal || !modal.classList.contains('activo')) return;
  showStateOverlay('success');
  setTimeout(() => {
    modal.classList.remove('activo');
    hideStateOverlay();
  }, LEGACY_CLOSE_MS);
}

function onUploadError(e) {
  const modal = document.getElementById(MODAL_ID);
  if (!modal || !modal.classList.contains('activo')) return;
  const msg = e?.detail?.message || 'No se pudo completar la subida.';
  const msgEl = document.getElementById(STATE_ERROR_MSG);
  if (msgEl) msgEl.textContent = msg;
  showStateOverlay('error');
}

function showStateOverlay(kind) {
  const overlay = document.getElementById(STATE_OVERLAY);
  if (!overlay) return;
  overlay.hidden = false;
  overlay.dataset.state = kind;
  overlay.querySelectorAll('.upload-state-view').forEach(v => {
    v.hidden = (v.dataset.state !== kind);
  });
}

function hideStateOverlay() {
  const overlay = document.getElementById(STATE_OVERLAY);
  if (!overlay) return;
  overlay.hidden = true;
  overlay.removeAttribute('data-state');
}

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
