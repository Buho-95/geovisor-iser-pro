/**
 * block-content-view.js — Render de la estructura del bloque seleccionado
 * sobre el host del panel derecho (#explorer-files-host).
 *
 * Separa lógica contextual (sede + bloques en panel izquierdo) de contenido
 * (disciplinas/subcarpetas del bloque en panel derecho), estilo VS Code /
 * Notion / Power BI.
 *
 * Comportamiento:
 *   - Estado inicial / sin bloque  → mensaje "Selecciona un bloque para ver su estructura".
 *   - Al emitirse UI_EVENTS.BLOQUE_SELECTED con un bloque válido → pinta en el
 *     host la estructura del bloque (disciplinas 01..11 con subestructura).
 *   - Al emitirse UI_EVENTS.SEDE_CHANGED → vuelve al estado vacío (hasta que
 *     el usuario elija un bloque de la nueva sede).
 *   - Click sobre carpeta CON children → expande/colapsa (acordeón por nivel).
 *   - Click sobre carpeta HOJA (sin children) → emite
 *     `geovisor:structure-path-selected` → file-explorer.js toma el host y
 *     carga los archivos reales desde Storage (flujo actual, sin cambios).
 *
 * NO modifica backend, schema v3, storage-routing, ni la lógica de
 * file-explorer.js / structure-schema.js. Sólo reorganiza render UI.
 */
import { buildSedeTree, isDynamicFolder, loadSchema } from '../core/structure-schema.js';
import { listDynamicFolders } from '../core/dynamic-folders-store.js';
import { normalizeToArray, normalizeItem } from '../core/iter-utils.js';
import { Logger } from '../core/logger.js';
import {
  UI_EVENTS,
  getSedeActiva,
  getBloqueSeleccionado,
} from '../core/ui-state.js';
import { openDynamicFolderModal } from './dynamic-folder-modal.js';

const HOST_ID = 'explorer-files-host';

let _wired = false;

/* ═══════════════════════ PUBLIC API ═══════════════════════ */

/**
 * Monta el block-content-view sobre el host indicado (o lo resuelve por id).
 * Idempotente: wirea listeners globales una sola vez y pinta el estado
 * correspondiente al ui-state actual.
 */
export function mountBlockContentView(host) {
  if (!host) host = document.getElementById(HOST_ID);
  if (!host) return;
  injectStyles();
  wireGlobalEventsOnce();

  const sede = getSedeActiva();
  const bloque = getBloqueSeleccionado();
  if (bloque) {
    renderBlock(host, { sedeId: sede, bloqueId: bloque }).catch(err =>
      Logger.error('[block-content-view] render inicial falló:', err));
  } else {
    renderEmpty(host);
  }
}

/* ═══════════════════════ EVENT WIRING ═══════════════════════ */

function wireGlobalEventsOnce() {
  if (_wired) return;
  _wired = true;

  document.addEventListener(UI_EVENTS.BLOQUE_SELECTED, (e) => {
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    const { bloque, sede } = e.detail || {};
    if (!bloque) {
      renderEmpty(host);
      return;
    }
    renderBlock(host, { sedeId: sede || getSedeActiva(), bloqueId: bloque })
      .catch(err => Logger.error('[block-content-view] render falló:', err));
  });

  document.addEventListener(UI_EVENTS.SEDE_CHANGED, () => {
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    // Al cambiar sede se resetea el bloque (ui-state ya lo hace).
    // Volvemos al estado vacío hasta que el usuario elija un bloque.
    renderEmpty(host);
  });
}

/* ═══════════════════════ RENDER ═══════════════════════ */

function renderEmpty(host) {
  host.classList.add('bcv-host');
  host.innerHTML = `
    <div class="bcv-empty">
      <div class="bcv-empty-icon"><i class="ph ph-squares-four"></i></div>
      <p class="bcv-empty-title">Selecciona un bloque para ver su estructura</p>
      <p class="bcv-empty-sub">Usa la lista de bloques a la izquierda o haz clic sobre un bloque en el mapa.</p>
    </div>
  `;
}

async function renderBlock(host, { sedeId, bloqueId }) {
  host.classList.add('bcv-host');
  host.innerHTML = `
    <div class="bcv-wrap">
      <header class="bcv-header">
        <div class="bcv-title">
          <i class="ph ph-buildings"></i>
          <div>
            <div class="bcv-title-main" data-role="title">${escapeHtml(prettyBlockName(bloqueId))}</div>
            <div class="bcv-title-sub">${escapeHtml(sedeDisplay(sedeId))} · Estructura del bloque</div>
          </div>
        </div>
      </header>
      <div class="bcv-body bcv-loading">Cargando estructura…</div>
    </div>
  `;

  try {
    const [tree, dyn, schema] = await Promise.all([
      buildSedeTree(sedeId),
      listDynamicFolders(sedeId).catch(err => {
        Logger.warn?.('[block-content-view] listDynamicFolders falló, sigue sin dinámicas:', err?.message || err);
        return [];
      }),
      loadSchema().catch(err => {
        Logger.warn?.('[block-content-view] loadSchema falló, sigo sin overrides:', err?.message || err);
        return null;
      }),
    ]);
    const bloques = normalizeToArray(tree?.bloques, { label: 'tree.bloques' });
    const bloque = resolveBloque(bloques, schema, sedeId, bloqueId);

    if (!bloque) {
      // Fallback limpio: NO mostramos error rojo. Volvemos al estado
      // "elige un bloque", aclarando suavemente que el bloque actual
      // (p. ej. un polígono del mapa sin ficha en el schema) no tiene
      // estructura canónica asociada.
      host.querySelector('.bcv-body')?.classList.remove('bcv-loading');
      renderUnmapped(host, { sedeId, bloqueId });
      return;
    }

    // Actualiza el título con el nombre real del bloque (p. ej. "05_Bloque_IA_Residencias").
    const titleEl = host.querySelector('[data-role="title"]');
    if (titleEl) titleEl.textContent = prettyBlockName(bloque.name || bloque.path || bloqueId);

    const dynByParent = groupDynamicsByParent(dyn);
    const children = normalizeToArray(bloque.children, { label: `bloque.${bloque.name}.children` });

    const body = host.querySelector('.bcv-body');
    body.classList.remove('bcv-loading');
    body.innerHTML = `
      <div class="bcv-list">
        ${children.map(n => renderNode(n, bloque.path || bloque.name, 0, dynByParent)).join('') || '<div class="bcv-empty-inline">Este bloque no tiene disciplinas.</div>'}
      </div>
    `;

    wireBodyInteractions(host, { sedeId, onDynamicCreated: () => renderBlock(host, { sedeId, bloqueId }) });
  } catch (err) {
    Logger.error('[block-content-view] Error cargando bloque:', err);
    // Mantener UX limpia: degradar a fallback suave, no rojo intenso.
    renderUnmapped(host, { sedeId, bloqueId });
  }
}

/**
 * Resuelve el bloque canónico a partir del id que viene de cualquier origen
 * (chip del árbol, mapa, deep-link). El mapa emite `mapBlockId` corto
 * (ej. "ia") mientras que el schema usa el nombre completo (ej.
 * "05_Bloque_IA_Residencias"). El schema v3 contiene ese puente en
 * `overrides.sedeBloqueOverrides[sede][nombreReal].mapBlockId`.
 *
 * Orden de resolución (de más estricto a más permisivo):
 *   1. Match exacto por `path` o `name`.
 *   2. Traducción via overrides `mapBlockId → nombreReal`.
 *   3. Inclusión case-insensitive (p. ej. "ia" ∈ "08_Bloque_IA").
 *   4. null → el caller muestra fallback limpio.
 */
function resolveBloque(bloques, schema, sedeId, rawId) {
  if (!rawId) return null;
  const list = normalizeToArray(bloques);
  if (list.length === 0) return null;

  // 1. Match exacto.
  const exact = list.find(b => b && (b.path === rawId || b.name === rawId));
  if (exact) return exact;

  const needle = String(rawId).toLowerCase();

  // 2. Overrides: mapBlockId → nombreReal.
  try {
    const overrides = schema?.overrides?.sedeBloqueOverrides?.[sedeId] || {};
    for (const [nombreReal, meta] of Object.entries(overrides)) {
      const mapId = meta?.mapBlockId;
      if (mapId && String(mapId).toLowerCase() === needle) {
        const hit = list.find(b => b && (b.path === nombreReal || b.name === nombreReal));
        if (hit) return hit;
      }
    }
  } catch { /* noop */ }

  // 3. Fallback tolerante: inclusión case-insensitive en ambos sentidos.
  const loose = list.find(b => {
    const path = String(b?.path || '').toLowerCase();
    const name = String(b?.name || '').toLowerCase();
    return path.includes(needle) || name.includes(needle)
        || needle.includes(path) || needle.includes(name);
  });
  return loose || null;
}

/**
 * Estado "bloque sin estructura canónica" — UX limpia, sin error rojo.
 * Útil cuando el id viene del mapa y no hay ficha asociada en el schema.
 */
function renderUnmapped(host, { sedeId, bloqueId }) {
  const wrap = host.querySelector('.bcv-wrap');
  if (!wrap) {
    renderEmpty(host);
    return;
  }
  const body = host.querySelector('.bcv-body');
  if (!body) return;
  body.classList.remove('bcv-loading');
  body.innerHTML = `
    <div class="bcv-empty bcv-empty-soft">
      <div class="bcv-empty-icon"><i class="ph ph-info"></i></div>
      <p class="bcv-empty-title">Bloque sin estructura canónica</p>
      <p class="bcv-empty-sub">
        El bloque <code>${escapeHtml(bloqueId)}</code> aún no tiene estructura de carpetas
        definida en el schema para <strong>${escapeHtml(sedeDisplay(sedeId))}</strong>.
        Elige otro bloque de la lista para ver su estructura.
      </p>
    </div>
  `;
}

/**
 * Render recursivo: la estructura del bloque se pinta como lista acordeón.
 * - Nodo con children → <details> expandible (acordeón por nivel, único abierto).
 * - Nodo hoja (sin children) → <div class="bcv-leaf"> clickeable que emite
 *   `geovisor:structure-path-selected` para que file-explorer cargue archivos.
 */
function renderNode(n, parentPath, depth, dynByParent) {
  if (typeof n === 'string') n = { name: n, path: `${parentPath}/${n}`, kind: 'subcarpeta', dynamic: false };
  if (!n || typeof n !== 'object') return '';

  const displayName = n.name || n.nombre || '';
  const nodePath = n.path || (parentPath ? `${parentPath}/${displayName}` : displayName);
  const childrenRaw = n.children ?? n.subcarpetas;
  const children = normalizeToArray(childrenRaw, { label: `node.${displayName}.children` });
  const acceptsDynamic = !!n.acceptsDynamic || n.dinamica === true || n.dynamic === true;
  const dynamicChildren = dynByParent.get(nodePath) || [];
  const hasContent = children.length > 0 || acceptsDynamic || dynamicChildren.length > 0;

  if (!hasContent) {
    return `
      <div class="bcv-row bcv-leaf" data-path="${escapeAttr(nodePath)}" data-kind="${escapeAttr(n.kind || 'subcarpeta')}">
        <i class="ph ph-folder bcv-icon"></i>
        <span class="bcv-name">${escapeHtml(displayName)}</span>
        <span class="bcv-meta-pill"><i class="ph ph-caret-right"></i> abrir</span>
      </div>
    `;
  }

  const dynClass = acceptsDynamic ? 'is-dynamic' : '';
  const countBadge = children.length > 0
    ? `<span class="bcv-count">${children.length}</span>`
    : '';
  return `
    <details class="bcv-node ${dynClass}" data-path="${escapeAttr(nodePath)}">
      <summary class="bcv-row">
        <i class="ph ph-caret-right bcv-caret"></i>
        <i class="ph ${acceptsDynamic ? 'ph-folder-plus' : 'ph-folder'} bcv-icon"></i>
        <span class="bcv-name">${escapeHtml(displayName)}</span>
        ${acceptsDynamic ? '<span class="bcv-badge dyn">permite crear</span>' : ''}
        ${countBadge}
        <div class="bcv-actions">
          ${acceptsDynamic ? `
            <button type="button" class="bcv-btn" data-action="new-dynamic"
                    data-path="${escapeAttr(nodePath)}" title="Crear subcarpeta NN_Nombre">
              <i class="ph ph-plus"></i>
            </button>` : ''}
          <button type="button" class="bcv-btn" data-action="select"
                  data-path="${escapeAttr(nodePath)}" title="Ver archivos de esta carpeta">
            <i class="ph ph-target"></i>
          </button>
        </div>
      </summary>
      <div class="bcv-children">
        ${children.map(c => renderNode(c, nodePath, depth + 1, dynByParent)).join('')}
        ${normalizeToArray(dynamicChildren).map(d => renderDynamicChild(nodePath, d, dynByParent)).join('')}
      </div>
    </details>
  `;
}

function renderDynamicChild(parentPath, d, dynByParent) {
  const { nombre } = normalizeItem(d);
  if (!nombre) return '';
  const childPath = `${parentPath}/${nombre}`;
  const grand = normalizeToArray(dynByParent.get(childPath));
  if (grand.length === 0) {
    return `
      <div class="bcv-row bcv-leaf is-dynamic" data-path="${escapeAttr(childPath)}" data-kind="dinamica">
        <i class="ph ph-folder-user bcv-icon"></i>
        <span class="bcv-name">${escapeHtml(nombre)}</span>
        <span class="bcv-badge custom">dinámica</span>
      </div>
    `;
  }
  return `
    <details class="bcv-node is-dynamic" data-path="${escapeAttr(childPath)}">
      <summary class="bcv-row">
        <i class="ph ph-caret-right bcv-caret"></i>
        <i class="ph ph-folder-user bcv-icon"></i>
        <span class="bcv-name">${escapeHtml(nombre)}</span>
        <span class="bcv-badge custom">dinámica</span>
        <div class="bcv-actions">
          <button type="button" class="bcv-btn" data-action="new-dynamic"
                  data-path="${escapeAttr(childPath)}" title="Crear subcarpeta aquí">
            <i class="ph ph-plus"></i>
          </button>
          <button type="button" class="bcv-btn" data-action="select"
                  data-path="${escapeAttr(childPath)}" title="Ver archivos">
            <i class="ph ph-target"></i>
          </button>
        </div>
      </summary>
      <div class="bcv-children">
        ${grand.map(g => renderDynamicChild(childPath, g, dynByParent)).join('')}
      </div>
    </details>
  `;
}

/* ═══════════════════════ INTERACTIONS ═══════════════════════ */

function wireBodyInteractions(host, { sedeId, onDynamicCreated }) {
  const body = host.querySelector('.bcv-body');
  if (!body || body.dataset.wired === 'true') return;
  body.dataset.wired = 'true';

  // Acordeón por nivel: al abrir un <details>, cerrar los hermanos del mismo nivel.
  body.addEventListener('toggle', (e) => {
    const det = e.target;
    if (!(det instanceof HTMLDetailsElement)) return;
    if (!det.open) return;
    if (!det.classList.contains('bcv-node')) return;
    const parent = det.parentElement;
    if (!parent) return;
    parent.querySelectorAll(':scope > details.bcv-node[open]').forEach(sib => {
      if (sib !== det) sib.open = false;
    });
  }, true);

  body.addEventListener('click', async (e) => {
    // 1) Hoja: click en toda la fila → cargar archivos (file-explorer escucha este evento).
    const leaf = e.target.closest('.bcv-leaf');
    if (leaf && !e.target.closest('[data-action]')) {
      const path = leaf.dataset.path;
      if (path) {
        emitPathSelected(sedeId, path);
        body.querySelectorAll('.bcv-leaf.is-selected').forEach(el => el.classList.remove('is-selected'));
        leaf.classList.add('is-selected');
      }
      return;
    }

    // 2) Acciones explícitas dentro de nodos con children.
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const action = btn.dataset.action;
    const path = btn.dataset.path;

    if (action === 'select' && path) {
      emitPathSelected(sedeId, path);
      return;
    }

    if (action === 'new-dynamic' && path) {
      try {
        // Tolerante al resultado: si la ruta no está marcada como dinámica,
        // igual permitimos el flujo (cascada de dinámicas). El modal hará
        // su propia validación de nomenclatura NN_.
        await isDynamicFolder(sedeId, path).catch(() => true);
        const result = await openDynamicFolderModal({ sedeId, parentPath: path });
        if (result?.created) onDynamicCreated?.();
      } catch (err) {
        Logger.error('[block-content-view] Error creando carpeta dinámica:', err);
        alert('No se pudo crear la carpeta: ' + (err?.message || err));
      }
    }
  });
}

function emitPathSelected(sedeId, path) {
  document.dispatchEvent(new CustomEvent('geovisor:structure-path-selected', {
    detail: { sedeId, path },
  }));
}

/* ═══════════════════════ HELPERS ═══════════════════════ */

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

function sedeDisplay(sedeId) {
  return ({
    pamplona: 'Sede Pamplona',
    rinconada: 'Granja La Rinconada',
    caldera: 'Finca La Caldera',
  })[sedeId] || sedeId;
}

function prettyBlockName(id) {
  if (!id) return '';
  return String(id).replace(/_/g, ' ').replace(/^\d+\s+/, m => m); // deja el prefijo NN_
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

/* ═══════════════════════ STYLES ═══════════════════════ */

function injectStyles() {
  if (document.getElementById('bcv-styles')) return;
  const css = `
    .bcv-host { display:flex; flex-direction:column; height:100%; min-height:0; }
    .bcv-wrap { display:flex; flex-direction:column; height:100%; min-height:0; }

    .bcv-header {
      flex: 0 0 auto;
      padding: 14px 16px 12px;
      border-bottom: 1px solid rgba(148,163,184,0.14);
      background: linear-gradient(180deg, rgba(34,211,238,0.04), transparent);
    }
    .bcv-title { display:flex; align-items:center; gap:10px; }
    .bcv-title > i { color:#22d3ee; font-size:22px; }
    .bcv-title-main {
      font-size: 0.92rem; font-weight: 700; color:#e5e7eb;
      font-family: ui-monospace, Menlo, Consolas, monospace;
      letter-spacing: 0.01em;
    }
    .bcv-title-sub {
      font-size: 0.68rem; color:#94a3b8; margin-top: 2px;
      text-transform: uppercase; letter-spacing: 0.08em;
    }

    .bcv-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 12px 14px; }
    .bcv-loading, .bcv-error { padding: 20px; text-align: center; color:#94a3b8; font-size: 0.8rem; }
    .bcv-error { color:#fca5a5; }
    .bcv-error code { background: rgba(239,68,68,0.12); padding: 1px 6px; border-radius: 4px; }

    /* Estado vacío — diseño minimalista */
    .bcv-empty {
      flex:1 1 auto; display:flex; flex-direction:column; align-items:center; justify-content:center;
      padding: 36px 24px; text-align:center; color:#94a3b8;
    }
    .bcv-empty-icon {
      width: 56px; height: 56px; border-radius: 14px;
      display:inline-flex; align-items:center; justify-content:center;
      background: rgba(34,211,238,0.08);
      border: 1px solid rgba(34,211,238,0.22);
      color: #22d3ee; font-size: 28px;
      margin-bottom: 14px;
    }
    .bcv-empty-title { font-size: 0.95rem; font-weight: 700; color:#e2e8f0; margin: 0 0 4px; }
    .bcv-empty-sub   { font-size: 0.75rem; color:#94a3b8; max-width: 340px; line-height: 1.5; }
    .bcv-empty-sub code {
      background: rgba(148,163,184,0.08); color:#cbd5e1;
      padding: 1px 6px; border-radius: 4px;
      font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.72rem;
    }
    .bcv-empty-sub strong { color: #e2e8f0; font-weight: 700; }
    .bcv-empty-inline { padding: 14px; color:#94a3b8; font-size:0.78rem; text-align:center; }
    /* Variante "soft": se usa cuando el bloque no tiene ficha en el schema.
       Mensaje neutro (no es un error). */
    .bcv-empty.bcv-empty-soft { padding: 28px 20px; }
    .bcv-empty.bcv-empty-soft .bcv-empty-icon {
      background: rgba(148,163,184,0.08);
      border-color: rgba(148,163,184,0.22);
      color: #94a3b8;
    }

    /* Lista / filas tipo VS Code */
    .bcv-list { display:flex; flex-direction:column; gap: 3px; }
    .bcv-node { padding: 0; }
    .bcv-node > summary, .bcv-row {
      list-style: none;
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px; border-radius: 8px;
      cursor: pointer; user-select: none;
      border: 1px solid transparent;
      transition: background .18s ease, border-color .18s ease, transform .15s ease;
    }
    .bcv-node > summary::-webkit-details-marker { display:none; }
    .bcv-node > summary:hover,
    .bcv-leaf:hover {
      background: rgba(34,211,238,0.06);
      border-color: rgba(34,211,238,0.18);
      transform: translateX(2px);
    }
    .bcv-leaf.is-selected {
      background: rgba(34,211,238,0.16);
      border-color: rgba(34,211,238,0.42);
      box-shadow: inset 2px 0 0 rgba(34,211,238,0.92);
    }
    .bcv-leaf.is-selected .bcv-icon { color:#22d3ee; }

    .bcv-caret {
      font-size: 12px; color:#64748b; flex:0 0 auto;
      transition: transform .18s ease;
    }
    .bcv-node[open] > summary .bcv-caret { transform: rotate(90deg); color:#22d3ee; }
    .bcv-icon { font-size: 16px; color:#94a3b8; flex:0 0 auto; }
    .bcv-node.is-dynamic > summary .bcv-icon,
    .bcv-leaf.is-dynamic .bcv-icon { color:#f97316; }

    .bcv-name {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 0.8rem; color:#e5e7eb;
      flex: 1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }

    .bcv-count {
      font-size: 0.6rem; font-weight: 700;
      padding: 1px 6px; border-radius: 999px;
      background: rgba(148,163,184,0.14); color:#cbd5e1;
    }
    .bcv-badge {
      font-size: 0.58rem; padding: 1px 6px; border-radius: 999px;
      text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700;
      white-space: nowrap;
    }
    .bcv-badge.dyn    { background: rgba(239,68,68,0.14); color:#f87171; border:1px solid rgba(239,68,68,0.22); }
    .bcv-badge.custom { background: rgba(249,115,22,0.14); color:#fb923c; border:1px solid rgba(249,115,22,0.22); }

    .bcv-meta-pill {
      font-size: 0.62rem; color:#64748b;
      display:inline-flex; align-items:center; gap:2px;
      padding: 1px 6px; border-radius: 999px;
      background: rgba(148,163,184,0.06);
      opacity: 0; transition: opacity .15s ease;
    }
    .bcv-row:hover .bcv-meta-pill { opacity: 1; color:#22d3ee; }

    .bcv-actions {
      display:flex; gap: 4px; margin-left: auto;
      opacity: 0; transition: opacity .12s ease;
    }
    .bcv-row:hover .bcv-actions { opacity: 1; }
    .bcv-btn {
      background: rgba(148,163,184,0.08);
      border: 1px solid rgba(148,163,184,0.22);
      color: #cbd5e1;
      border-radius: 6px;
      width: 24px; height: 24px;
      display:inline-flex; align-items:center; justify-content:center;
      cursor: pointer; font-size: 12px;
    }
    .bcv-btn:hover { color:#fff; background: rgba(34,211,238,0.10); border-color: rgba(34,211,238,0.36); }

    .bcv-children {
      margin-left: 14px; padding-left: 10px;
      border-left: 1px dashed rgba(148,163,184,0.16);
      display:flex; flex-direction:column; gap: 3px;
      margin-top: 3px; padding-top: 2px; padding-bottom: 2px;
    }
  `;
  const style = document.createElement('style');
  style.id = 'bcv-styles';
  style.textContent = css;
  document.head.appendChild(style);
}
