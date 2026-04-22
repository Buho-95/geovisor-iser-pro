/**
 * structure-tree.js — Árbol jerárquico navegable por SEDE → BLOQUE → DISCIPLINA → SUBCARPETAS.
 *
 * Consume el schema canónico (frontend/shared/estructura-base.json) vía structure-schema.js
 * + carpetas dinámicas desde staging_estructura_dinamica.
 *
 * Se monta en un contenedor dado:
 *    import { mountStructureTree } from './modules/structure-tree.js';
 *    await mountStructureTree(document.getElementById('panel-planoteca'), { sedeId: 'pamplona' });
 *
 * Solo activo en staging (la integración en bootstrap lo condiciona con isStaging).
 */
import { buildSedeTree, isDynamicFolder } from '../core/structure-schema.js';
import { listDynamicFolders } from '../core/dynamic-folders-store.js';
import { state } from '../core/state.js';
import { Logger } from '../core/logger.js';
import { openDynamicFolderModal } from './dynamic-folder-modal.js';
import { emit, EVENTS } from '../core/events.js';
import { normalizeToArray, normalizeItem } from '../core/iter-utils.js';
import {
  getSedeActiva,
  getBloqueSeleccionado,
  setBloque as setUiBloque,
  UI_EVENTS,
} from '../core/ui-state.js';

const TREE_ROOT_ID = 'staging-structure-tree';

export async function mountStructureTree(container, { sedeId } = {}) {
  if (!container) throw new Error('mountStructureTree: contenedor inválido.');
  sedeId = sedeId || getSedeActiva() || state?.currentSede || 'pamplona';

  container.innerHTML = renderShell(sedeId);
  const host = container.querySelector(`#${TREE_ROOT_ID}`);

  try {
    const treeP = buildSedeTree(sedeId);
    const dynP  = listDynamicFolders(sedeId).catch(err => {
      Logger.warn?.('[structure-tree] listDynamicFolders falló, se renderiza sin dinámicas:', err?.message || err);
      return [];
    });
    const [tree, dyn] = await Promise.all([treeP, dynP]);
    const dynByParent = groupDynamicsByParent(dyn);

    host.innerHTML = renderSede(tree, dynByParent);

    // Transición suave al montar/remontar.
    host.classList.add('stree-fade-in');
    requestAnimationFrame(() => host.classList.remove('stree-fade-in'));

    wireInteractions(host, { sedeId, onDynamicCreated: () => refreshTree(container, sedeId) });

    // Reactividad a ui-state (se enlaza una sola vez por container).
    wireUiStateListeners(container);

    // Si ya hay bloque seleccionado al montar, resaltar el chip correspondiente.
    const bloqueActual = getBloqueSeleccionado();
    if (bloqueActual) markActiveBlockChip(host, bloqueActual);

    // Refrescar título con el bloque actual (si lo hay).
    updateTreeTitle(container, sedeId, bloqueActual);
  } catch (err) {
    Logger.error('[structure-tree] Error montando árbol:', err);
    host.innerHTML = `<div class="stree-error">No se pudo cargar la estructura: ${escapeHtml(err?.message || String(err))}</div>`;
  }
}

/* ═══════════════════════ UI-STATE INTEGRATION ═══════════════════════ */

/**
 * Enlaza listeners globales una sola vez por container para reaccionar a:
 *   geovisor:sede-changed    → re-montar
 *   geovisor:bloque-selected → auto-expandir bloque en el árbol
 */
function wireUiStateListeners(container) {
  if (container.dataset.uiListeners === 'true') return;
  container.dataset.uiListeners = 'true';

  const onSede = (e) => {
    const { sede } = e.detail || {};
    if (!sede) return;
    // Remontar con la nueva sede.
    mountStructureTree(container, { sedeId: sede }).catch(err =>
      Logger.error('[structure-tree] sede-changed remount falló:', err));
  };
  const onBloque = (e) => {
    const { bloque, sede } = e.detail || {};
    const host = container.querySelector(`#${TREE_ROOT_ID}`);
    if (!host) return;
    updateTreeTitle(container, sede || getSedeActiva(), bloque);
    // Resaltar el chip en la sección BLOQUES (nivel sede permanece intacto).
    markActiveBlockChip(host, bloque);
  };

  document.addEventListener(UI_EVENTS.SEDE_CHANGED, onSede);
  document.addEventListener(UI_EVENTS.BLOQUE_SELECTED, onBloque);
}

function updateTreeTitle(container, sedeId, bloqueId) {
  const titleEl = container.querySelector('.stree-title');
  if (!titleEl) return;
  const sedeTxt = sedeDisplay(sedeId);
  const bloqueTxt = bloqueId ? ` → <em>${escapeHtml(bloqueId)}</em>` : '';
  titleEl.innerHTML = `
    <i class="ph ph-tree-structure"></i>
    <span class="stree-title-main">Estructura canónica (PDF) — <strong>${escapeHtml(sedeTxt)}</strong>${bloqueTxt}</span>
  `;
}

/**
 * Marca visualmente el chip del bloque activo en la sección BLOQUES.
 * La estructura interna del bloque NO se expande en el árbol — vive en el
 * panel derecho (block-content-view.js).
 */
function markActiveBlockChip(host, bloqueId) {
  host.querySelectorAll('.stree-block-chip.is-active')
      .forEach(el => el.classList.remove('is-active'));
  if (!bloqueId) return;
  const chip = host.querySelector(`.stree-block-chip[data-bloque="${escapeAttr(bloqueId)}"]`);
  if (chip) {
    chip.classList.add('is-active');
    try { chip.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch { /* noop */ }
  }
}

async function refreshTree(container, sedeId) {
  await mountStructureTree(container, { sedeId });
}

function groupDynamicsByParent(list) {
  const map = new Map();
  const safe = normalizeToArray(list, { label: 'groupDynamicsByParent.list' });
  for (const d of safe) {
    if (!d || !d.parentPath) continue;
    if (!map.has(d.parentPath)) map.set(d.parentPath, []);
    map.get(d.parentPath).push(d);
  }
  for (const arr of map.values()) arr.sort((a, b) => (a.numero || 0) - (b.numero || 0));
  return map;
}

/* ═══════════════════════ RENDER ═══════════════════════ */

function renderShell(sedeId) {
  return `
    <div class="stree-wrap" data-sede="${escapeAttr(sedeId)}">
      <div class="stree-toolbar">
        <div class="stree-title">
          <i class="ph ph-tree-structure"></i>
          Estructura canónica (PDF) — <strong>${sedeDisplay(sedeId)}</strong>
        </div>
        <div class="stree-toolbar-right">
          <div class="stree-hint">
            <span class="stree-legend"><span class="dot-normal"></span>normal</span>
            <span class="stree-legend"><span class="dot-lab"></span>laboratorio</span>
            <span class="stree-legend"><span class="dot-dyn"></span>permite crear</span>
          </div>
          <div class="stree-controls">
            <button class="stree-ctrl" data-ctrl="expand-all"   title="Expandir todo">
              <i class="ph ph-arrows-out-simple"></i>
            </button>
            <button class="stree-ctrl" data-ctrl="collapse-all" title="Colapsar todo">
              <i class="ph ph-arrows-in-simple"></i>
            </button>
          </div>
        </div>
      </div>
      <div id="${TREE_ROOT_ID}" class="stree-root">
        <div class="stree-loading">Cargando estructura…</div>
      </div>
    </div>
  `;
}

function renderSede(tree, dynByParent) {
  const safeTree = tree && typeof tree === 'object' ? tree : {};
  const nivelSede = normalizeToArray(safeTree.nivelSede, { label: 'tree.nivelSede' });
  const bloques   = normalizeToArray(safeTree.bloques,   { label: 'tree.bloques' });

  const labCount = bloques.filter(b => b?.tipo === 'laboratorio').length;

  let html = '';
  // ── NIVEL SEDE (morado PDF) ─────────────────────────────────────
  html += `<details class="stree-section" open>`;
  html += `  <summary class="stree-section-title">`;
  html += `    <i class="ph ph-map-trifold"></i> NIVEL SEDE `;
  html += `    <span class="stree-count">${nivelSede.length}</span>`;
  html += `  </summary>`;
  html += `  <div class="stree-section-body">`;
  if (nivelSede.length === 0) html += `<div class="stree-empty">(sin entradas)</div>`;
  for (const n of nivelSede) html += renderNode(n, 0, dynByParent, { openDepth: 1 });
  html += `  </div>`;
  html += `</details>`;

  // ── BLOQUES (selector de chips — sin profundidad en el árbol) ───
  // La estructura interna del bloque (disciplinas / subcarpetas) ahora
  // vive exclusivamente en el panel derecho (block-content-view.js).
  // Aquí sólo mostramos chips clickeables; click → setUiBloque(id).
  html += `<details class="stree-section" open>`;
  html += `  <summary class="stree-section-title">`;
  html += `    <i class="ph ph-buildings"></i> BLOQUES `;
  html += `    <span class="stree-count">${bloques.length}</span>`;
  if (labCount > 0) html += `    <span class="stree-count stree-count-lab">${labCount} LAB</span>`;
  html += `  </summary>`;
  html += `  <div class="stree-section-body stree-blocks-body">`;
  if (bloques.length === 0) {
    html += `<div class="stree-empty">(sin bloques)</div>`;
  } else {
    html += `<div class="stree-block-grid">`;
    for (const b of bloques) html += renderBlockChip(b);
    html += `</div>`;
    html += `<p class="stree-block-hint"><i class="ph ph-hand-pointing"></i> Selecciona un bloque para ver su estructura en el panel derecho.</p>`;
  }
  html += `  </div>`;
  html += `</details>`;
  return html;
}

function renderBlockChip(b) {
  if (!b || typeof b !== 'object') return '';
  const esLab = b.tipo === 'laboratorio';
  const tipoClass = esLab ? 'is-lab' : 'is-normal';
  const id = b.path || b.name || '';
  return `
    <button type="button"
            class="stree-block-chip ${tipoClass}"
            data-bloque="${escapeAttr(id)}"
            data-kind="bloque"
            title="${escapeAttr(b.name || id)}">
      <i class="ph ph-buildings stree-chip-icon"></i>
      <span class="stree-chip-name">${escapeHtml(b.name || id)}</span>
      ${esLab ? '<span class="stree-chip-badge">LAB</span>' : ''}
    </button>
  `;
}

function renderNode(n, depth, dynByParent, opts = {}) {
  // Normaliza: si llega como string (formato heredado), lo convertimos a nodo sintético.
  if (typeof n === 'string') n = { name: n, path: n, kind: 'subcarpeta', dynamic: false };
  if (!n || typeof n !== 'object') return '';

  const displayName = n.name || n.nombre || '';
  const nodePath = n.path || displayName;

  // Fallback children | subcarpetas (alias heredado).
  const childrenRaw = n.children ?? n.subcarpetas;
  const children    = normalizeToArray(childrenRaw, { label: `node.${displayName}.children` });
  const hasChildren = children.length > 0;
  const acceptsDynamic = !!n.acceptsDynamic || n.dinamica === true || n.dynamic === true;
  const dynamicChildren= dynByParent.get(nodePath) || [];
  const hasContent     = hasChildren || acceptsDynamic || dynamicChildren.length > 0;

  const kind = n.kind || 'subcarpeta';
  if (!hasContent) {
    return `
      <div class="stree-node stree-leaf" data-path="${escapeAttr(nodePath)}" data-kind="${escapeAttr(kind)}">
        <i class="ph ph-folder stree-icon"></i>
        <span class="stree-name">${escapeHtml(displayName)}</span>
        <div class="stree-actions">
          <button class="stree-btn stree-btn-select" data-action="select"
                  data-path="${escapeAttr(nodePath)}" title="Seleccionar esta carpeta">
            <i class="ph ph-target"></i>
          </button>
        </div>
      </div>
    `;
  }

  const kindClass = acceptsDynamic ? 'is-dynamic' : '';
  const openAttr = (opts.openDepth ?? 0) > depth ? 'open' : '';
  return `
    <details ${openAttr} class="stree-node ${kindClass}" data-path="${escapeAttr(nodePath)}" data-kind="${escapeAttr(kind)}">
      <summary>
        <i class="ph ${acceptsDynamic ? 'ph-folder-plus' : 'ph-folder'} stree-icon"></i>
        <span class="stree-name">${escapeHtml(displayName)}</span>
        ${acceptsDynamic ? '<span class="stree-badge dyn">permite crear</span>' : ''}
        ${hasChildren ? `<span class="stree-count">${children.length}</span>` : ''}
        <div class="stree-actions">
          ${acceptsDynamic ? `
            <button class="stree-btn stree-btn-new" data-action="new-dynamic"
                    data-path="${escapeAttr(nodePath)}" title="Crear subcarpeta NN_Nombre">
              <i class="ph ph-plus"></i>
            </button>` : ''}
          <button class="stree-btn stree-btn-select" data-action="select"
                  data-path="${escapeAttr(nodePath)}" title="Seleccionar esta carpeta">
            <i class="ph ph-target"></i>
          </button>
        </div>
      </summary>
      <div class="stree-children">
        ${children.map(c => renderNode(c, depth + 1, dynByParent, opts)).join('')}
        ${normalizeToArray(dynamicChildren).map(d => renderDynamicChild(nodePath, d, dynByParent)).join('')}
      </div>
    </details>
  `;
}

function renderDynamicChild(parentPath, d, dynByParent) {
  const { nombre } = normalizeItem(d);
  if (!nombre) return '';
  const childPath = `${parentPath}/${nombre}`;
  const grandChildren = normalizeToArray(dynByParent.get(childPath));
  return `
    <details class="stree-node stree-leaf-dyn" data-path="${escapeAttr(childPath)}" data-kind="dinamica">
      <summary>
        <i class="ph ph-folder-user stree-icon"></i>
        <span class="stree-name">${escapeHtml(nombre)}</span>
        <span class="stree-badge custom">dinámica</span>
        <div class="stree-actions">
          <button class="stree-btn stree-btn-new" data-action="new-dynamic"
                  data-path="${escapeAttr(childPath)}" title="Crear subcarpeta aquí">
            <i class="ph ph-plus"></i>
          </button>
          <button class="stree-btn stree-btn-select" data-action="select"
                  data-path="${escapeAttr(childPath)}" title="Seleccionar esta carpeta">
            <i class="ph ph-target"></i>
          </button>
        </div>
      </summary>
      <div class="stree-children">
        ${grandChildren.map(g => renderDynamicChild(childPath, g, dynByParent)).join('')}
      </div>
    </details>
  `;
}

/* ═══════════════════════ INTERACTIONS ═══════════════════════ */

function wireInteractions(root, { sedeId, onDynamicCreated }) {
  // Toolbar controls (expandir / colapsar todo) → subir a nivel wrap.
  const wrap = root.closest('.stree-wrap') || root.parentElement;
  wrap?.addEventListener('click', (e) => {
    const ctrl = e.target.closest('[data-ctrl]');
    if (!ctrl) return;
    const which = ctrl.dataset.ctrl;
    if (which === 'expand-all') {
      root.querySelectorAll('details').forEach(d => d.open = true);
    } else if (which === 'collapse-all') {
      root.querySelectorAll('details.stree-node').forEach(d => d.open = false);
    }
  });

  // Accordion: al abrir un <details> cerrar sus hermanos del mismo nivel.
  // Aplica sólo a nodos del árbol (no a las secciones NIVEL SEDE / BLOQUES).
  root.addEventListener('toggle', (e) => {
    const det = e.target;
    if (!(det instanceof HTMLDetailsElement)) return;
    if (!det.open) return;
    if (!det.classList.contains('stree-node')) return; // ignora .stree-section
    const parent = det.parentElement;
    if (!parent) return;
    parent.querySelectorAll(':scope > details.stree-node[open]').forEach(sib => {
      if (sib !== det) sib.open = false;
    });
  }, true);

  root.addEventListener('click', async (e) => {
    // 0) Click sobre un chip de BLOQUE → sólo seleccionar bloque.
    //    No expandir nada en el árbol: la estructura se renderiza en el
    //    panel derecho vía block-content-view.js.
    const chip = e.target.closest('.stree-block-chip');
    if (chip) {
      e.preventDefault();
      e.stopPropagation();
      const bloqueId = chip.dataset.bloque;
      if (bloqueId) {
        try { setUiBloque(bloqueId); } catch (err) { Logger.warn?.('[structure-tree] setUiBloque falló:', err); }
        // Marcar como activo inmediatamente (sin esperar el evento de vuelta).
        markActiveBlockChip(root, bloqueId);
      }
      return;
    }

    // 1) Click sobre una hoja completa (sin children) → emitir select.
    //    Permite navegar como un explorador real: clic en la fila → abre archivos.
    const leaf = e.target.closest('.stree-leaf');
    if (leaf && !e.target.closest('[data-action]')) {
      const leafPath = leaf.dataset.path;
      if (leafPath) {
        emit?.(EVENTS?.STRUCTURE_PATH_SELECTED || 'structure:path-selected', { sedeId, path: leafPath });
        document.dispatchEvent(new CustomEvent('geovisor:structure-path-selected', {
          detail: { sedeId, path: leafPath }
        }));
        // Marcar visualmente la hoja activa.
        root.querySelectorAll('.stree-leaf.is-selected').forEach(el => el.classList.remove('is-selected'));
        leaf.classList.add('is-selected');
        return;
      }
    }

    // 2) Click sobre acciones explícitas (botón target / crear dinámica).
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const action = btn.dataset.action;
    const nodePath = btn.dataset.path;

    if (action === 'new-dynamic') {
      const canCreate = await isDynamicFolder(sedeId, nodePath).catch(() => true);
      // Permitimos también bajo carpetas dinámicas (cascada)
      try {
        const result = await openDynamicFolderModal({ sedeId, parentPath: nodePath });
        if (result?.created) {
          onDynamicCreated?.();
        }
      } catch (err) {
        Logger.error('[structure-tree] Error creando carpeta dinámica:', err);
        alert('No se pudo crear la carpeta: ' + err.message);
      }
    } else if (action === 'select') {
      emit?.(EVENTS?.STRUCTURE_PATH_SELECTED || 'structure:path-selected', { sedeId, path: nodePath });
      // Fallback: CustomEvent global
      document.dispatchEvent(new CustomEvent('geovisor:structure-path-selected', {
        detail: { sedeId, path: nodePath }
      }));
    }
  });
}

/* ═══════════════════════ HELPERS ═══════════════════════ */

function sedeDisplay(sedeId) {
  const m = {
    pamplona: 'Sede Pamplona',
    rinconada: 'Granja La Rinconada',
    caldera: 'Finca La Caldera',
  };
  return m[sedeId] || sedeId;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

/* ═══════════════════════ ESTILOS ═══════════════════════ */

export function injectStructureTreeStyles() {
  if (document.getElementById('stree-styles')) return;
  const css = `
    .stree-wrap { display:flex; flex-direction:column; height:100%; padding: 12px 14px; color: var(--text-primary, #e5e7eb); font-size: 0.8rem; box-sizing:border-box; }
    .stree-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding-bottom:10px; border-bottom:1px solid var(--border-subtle, #2a3240); margin-bottom:10px; flex: 0 0 auto; }
    .stree-title { font-weight:700; font-size:0.82rem; display:flex; align-items:center; gap:6px; color:var(--text-primary, #e5e7eb); }
    .stree-title i { color:#f59e0b; }
    .stree-toolbar-right { display:flex; align-items:center; gap:12px; }
    .stree-hint { display:flex; gap:10px; font-size:0.68rem; color:var(--text-muted,#94a3b8); }
    .stree-legend { display:inline-flex; align-items:center; gap:4px; }
    .stree-legend .dot-normal, .stree-legend .dot-lab, .stree-legend .dot-dyn { width:8px; height:8px; border-radius:50%; display:inline-block; }
    .stree-legend .dot-normal { background:#3b82f6; }
    .stree-legend .dot-lab { background:#22c55e; }
    .stree-legend .dot-dyn { background:#ef4444; }
    .stree-controls { display:flex; gap:4px; }
    .stree-ctrl { background: rgba(148,163,184,0.08); border:1px solid rgba(148,163,184,0.22); color:var(--text-muted,#94a3b8); border-radius:5px; width:26px; height:26px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; font-size:13px; }
    .stree-ctrl:hover { color:#fff; border-color:rgba(148,163,184,0.5); background: rgba(148,163,184,0.16); }

    .stree-root { display:flex; flex-direction:column; gap:10px; flex:1 1 auto; overflow-y:auto; overflow-x:hidden; padding-right:6px; min-height:0; }
    .stree-loading, .stree-error, .stree-empty { padding:20px; text-align:center; color:var(--text-muted,#94a3b8); }
    .stree-error { color:#ef4444; }
    .stree-empty { padding:8px 12px; font-size:0.7rem; font-style:italic; opacity:0.7; }

    details.stree-section { border:1px solid rgba(148,163,184,0.15); border-radius:8px; background: rgba(148,163,184,0.03); }
    details.stree-section > summary.stree-section-title { list-style:none; cursor:pointer; display:flex; align-items:center; gap:8px; padding:10px 12px; font-size:0.72rem; font-weight:800; text-transform:uppercase; letter-spacing:0.1em; color:var(--text-primary,#e5e7eb); }
    details.stree-section > summary.stree-section-title::-webkit-details-marker { display:none; }
    details.stree-section > summary.stree-section-title i { color:#f59e0b; font-size:15px; }
    details.stree-section[open] > summary.stree-section-title { border-bottom:1px solid rgba(148,163,184,0.15); }
    .stree-section-body { padding: 6px 10px 10px; }

    .stree-count { font-size:0.6rem; font-weight:700; padding:1px 6px; border-radius:999px; background: rgba(148,163,184,0.12); color:#cbd5e1; letter-spacing:0.02em; text-transform:none; }
    .stree-count-lab { background: rgba(34,197,94,0.18); color:#4ade80; }

    /* ── Chips de selección de BLOQUE (sin profundidad) ── */
    .stree-blocks-body { padding: 10px 10px 8px; }
    .stree-block-grid { display:flex; flex-direction:column; gap:6px; }
    .stree-block-chip {
      display:flex; align-items:center; gap:8px;
      width:100%; text-align:left; cursor:pointer;
      padding: 7px 10px;
      background: rgba(15,23,42,0.35);
      border: 1px solid rgba(148,163,184,0.16);
      border-radius: 8px;
      color: #cbd5e1; font: inherit; font-size: 0.78rem;
      transition: background .18s ease, border-color .18s ease, transform .18s ease, color .18s ease;
    }
    .stree-block-chip:hover {
      background: rgba(34,211,238,0.08);
      border-color: rgba(34,211,238,0.30);
      color:#e0f2fe;
      transform: translateX(2px);
    }
    .stree-block-chip.is-active {
      background: rgba(34,211,238,0.16);
      border-color: rgba(34,211,238,0.60);
      color:#fff;
      box-shadow: inset 2px 0 0 rgba(34,211,238,0.95), 0 0 0 1px rgba(34,211,238,0.20);
    }
    .stree-block-chip.is-lab .stree-chip-icon { color:#4ade80; }
    .stree-block-chip.is-normal .stree-chip-icon { color:#60a5fa; }
    .stree-chip-icon { font-size: 15px; flex: 0 0 auto; }
    .stree-chip-name {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      flex: 1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }
    .stree-chip-badge {
      font-size:0.58rem; padding:1px 6px; border-radius:999px;
      background: rgba(34,197,94,0.18); color:#4ade80;
      border:1px solid rgba(34,197,94,0.28);
      letter-spacing:0.06em; font-weight:700;
    }
    .stree-block-hint {
      margin: 10px 2px 0; padding: 6px 8px;
      color: #94a3b8; font-size: 0.68rem; line-height: 1.35;
      display:flex; align-items:flex-start; gap:6px;
      border-top: 1px dashed rgba(148,163,184,0.16);
    }
    .stree-block-hint i { color:#22d3ee; font-size:12px; margin-top:1px; }

    .stree-node { padding: 2px 0; }
    .stree-node > summary, .stree-leaf { list-style:none; display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 6px; border-radius:6px; user-select:none; }
    .stree-node > summary::-webkit-details-marker { display:none; }
    .stree-node > summary:hover, .stree-leaf:hover { background: rgba(148,163,184,0.08); }
    .stree-leaf.is-selected { background: rgba(34,211,238,0.14); border:1px solid rgba(34,211,238,0.32); }
    .stree-leaf.is-selected .stree-icon { color:#22d3ee; }
    .stree-icon { font-size:14px; opacity:0.9; }
    .stree-name { font-family: ui-monospace, Menlo, Consolas, monospace; font-size:0.78rem; color:var(--text-primary,#e5e7eb); flex: 1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .stree-children { margin-left: 18px; border-left: 1px dashed rgba(148,163,184,0.18); padding-left: 10px; }

    .stree-bloque.is-normal > summary .stree-icon { color:#3b82f6; }
    .stree-bloque.is-lab > summary .stree-icon { color:#22c55e; }
    .stree-node.is-dynamic > summary .stree-icon { color:#ef4444; }
    .stree-leaf-dyn > summary .stree-icon { color:#f97316; }

    .stree-badge { font-size:0.58rem; padding:1px 6px; border-radius:999px; text-transform:uppercase; letter-spacing:0.04em; font-weight:700; white-space:nowrap; }
    .stree-badge.tipo-norm { background: rgba(59,130,246,0.14); color:#60a5fa; border:1px solid rgba(59,130,246,0.22); }
    .stree-badge.tipo-lab  { background: rgba(34,197,94,0.18);  color:#4ade80; border:1px solid rgba(34,197,94,0.28); }
    .stree-badge.dyn       { background: rgba(239,68,68,0.14);  color:#f87171; border:1px solid rgba(239,68,68,0.22); }
    .stree-badge.custom    { background: rgba(249,115,22,0.14); color:#fb923c; border:1px solid rgba(249,115,22,0.22); }

    .stree-actions { display:flex; gap:4px; margin-left:auto; opacity:0; transition: opacity .1s ease; }
    .stree-node > summary:hover .stree-actions, .stree-leaf:hover .stree-actions { opacity:1; }
    .stree-btn { background:none; border:1px solid rgba(148,163,184,0.18); color:var(--text-muted,#94a3b8); border-radius:5px; width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; font-size:12px; }
    .stree-btn:hover { color:#fff; border-color:rgba(148,163,184,0.4); background: rgba(148,163,184,0.08); }
    .stree-btn-new:hover { color:#ef4444; border-color:#ef4444; }
    .stree-btn-select:hover { color:#06b6d4; border-color:#06b6d4; }

    /* Transiciones UI */
    .stree-fade-in { animation: streeFadeIn 180ms ease-out; }
    @keyframes streeFadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: none; }
    }
    details.stree-bloque.stree-highlight > summary {
      background: rgba(34, 211, 238, 0.18);
      box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.45);
      transition: background 220ms ease, box-shadow 220ms ease;
      border-radius: 6px;
    }
    .stree-title-main em {
      font-style: normal;
      font-family: ui-monospace, Menlo, Consolas, monospace;
      color: #22d3ee;
      font-size: 0.78rem;
    }

    /* Modal crear carpeta */
    .sdfm-backdrop { position:fixed; inset:0; background: rgba(0,0,0,0.55); z-index: 9998; display:flex; align-items:center; justify-content:center; }
    .sdfm-dialog { background:#0f172a; color:#e5e7eb; border:1px solid #2a3240; border-radius:10px; padding:22px; min-width:420px; max-width:92vw; box-shadow: 0 25px 80px rgba(0,0,0,0.6); }
    .sdfm-title { font-weight:800; font-size:0.95rem; margin-bottom:8px; display:flex; align-items:center; gap:8px; }
    .sdfm-parent { font-family: ui-monospace, Menlo, monospace; font-size:0.72rem; color:#94a3b8; background: rgba(148,163,184,0.06); padding:6px 8px; border-radius:6px; margin-bottom:12px; word-break:break-all; }
    .sdfm-row { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }
    .sdfm-row label { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; font-weight:700; }
    .sdfm-input { background:#0b1220; border:1px solid #2a3240; color:#e5e7eb; padding:8px 10px; border-radius:6px; font-family: ui-monospace, monospace; font-size:0.82rem; }
    .sdfm-input:focus { outline:none; border-color:#06b6d4; }
    .sdfm-hint { font-size:0.7rem; color:#94a3b8; margin-top:4px; }
    .sdfm-error { font-size:0.72rem; color:#f87171; margin-top:4px; min-height:1em; }
    .sdfm-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
    .sdfm-btn { padding:7px 12px; border-radius:6px; font-size:0.78rem; font-weight:700; cursor:pointer; border:1px solid transparent; }
    .sdfm-btn.cancel { background:transparent; color:#94a3b8; border-color:#334155; }
    .sdfm-btn.cancel:hover { color:#fff; background: rgba(148,163,184,0.08); }
    .sdfm-btn.ok { background:#ef4444; color:#fff; }
    .sdfm-btn.ok:hover { background:#dc2626; }
    .sdfm-btn[disabled] { opacity:0.5; cursor:not-allowed; }
  `;
  const style = document.createElement('style');
  style.id = 'stree-styles';
  style.textContent = css;
  document.head.appendChild(style);
}
