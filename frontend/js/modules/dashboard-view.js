/**
 * dashboard-view.js — Vista del dashboard de auditoría de completitud.
 *
 * Renderiza las métricas calculadas por `dashboard-engine.js` sin tocar
 * el dashboard-pro existente. Monta su salida en un contenedor aislado
 * (`#dashboard-audit-root`) dentro de `#dashboard-container`, para no
 * interferir con los widgets anteriores.
 *
 * API:
 *   renderDashboard({ sedeId, bloques?, mountEl? })
 *   - sedeId   (obligatorio) "pamplona" | "rinconada" | "caldera"
 *   - bloques  (opcional)    lista [{name, path}]. Si se omite, los
 *                            saca del schema v3 vía auditSede().
 *   - mountEl  (opcional)    elemento/ID destino. Si se omite, usa o
 *                            crea `#dashboard-audit-root` dentro de
 *                            `#dashboard-container`.
 *
 * Sin cambios de lógica, auth, events ni estructura.
 */

import { auditSede } from './dashboard-engine.js';
import { esBloqueConLaboratorio } from '../core/structure-schema.js';
import { setBloque as setUiBloque } from '../core/ui-state.js';
import { Logger } from '../core/logger.js';

const ROOT_ID = 'dashboard-audit-root';
const HOST_ID = 'dashboard-container';

// ── Utilidades internas ───────────────────────────────────────────

/**
 * Resuelve el elemento raíz interno (`#dashboard-audit-root`) garantizando
 * que sea el único hijo del host. Si el host ya tenía contenido del
 * dashboard viejo, lo elimina. Idempotente en re-renders.
 */
function resolveMount(mountEl) {
  let host = null;

  if (mountEl instanceof HTMLElement) host = mountEl;
  else if (typeof mountEl === 'string') {
    host = document.getElementById(mountEl) || document.querySelector(mountEl);
  }
  if (!host) host = document.getElementById(HOST_ID);

  // Caso edge: nadie nos dio host y no existe #dashboard-container.
  if (!host) {
    Logger.warn?.(`[dashboard-view] No existe #${HOST_ID}. Creando fallback en <body>.`);
    const fallback = document.createElement('div');
    fallback.id = ROOT_ID;
    document.body.appendChild(fallback);
    return fallback;
  }

  // Si el host ES el root directamente, úsalo.
  if (host.id === ROOT_ID) return host;

  // ¿Ya existe el root dentro del host?
  let root = host.querySelector(`#${ROOT_ID}`);
  if (!root) {
    // Primer mount: limpiamos restos del dashboard viejo y creamos el root.
    host.innerHTML = '';
    root = document.createElement('div');
    root.id = ROOT_ID;
    host.appendChild(root);
  } else {
    // Re-mount: eliminar cualquier hermano que se haya metido antes.
    Array.from(host.children).forEach((child) => {
      if (child !== root) child.remove();
    });
  }
  return root;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function prettyBloque(name) {
  if (!name) return '';
  return String(name).replace(/^\d+_/, '').replace(/_/g, ' ');
}

function prettyDisciplina(d) {
  if (!d) return '';
  return String(d).replace(/^\d+_/, '').replace(/_/g, ' ');
}

function classifyPercent(pct) {
  if (pct === 0) return 'empty';
  if (pct < 50) return 'low';
  return '';
}

// ── Render HTML ───────────────────────────────────────────────────

function renderLoading(root, sedeId) {
  root.innerHTML = `
    <div class="dash-head">
      <div class="dash-head-title">
        <i class="ph ph-chart-pie-slice"></i>Auditoría de completitud
      </div>
      <div class="dash-head-sede">${escapeHtml(sedeId)}</div>
    </div>
    <div class="dash-loading">
      <i class="ph ph-spinner-gap ph-spin"></i>
      <span>Analizando contenido de Storage…</span>
    </div>
  `;
}

function renderEmpty(root, sedeId, msg) {
  root.innerHTML = `
    <div class="dash-head">
      <div class="dash-head-title">
        <i class="ph ph-chart-pie-slice"></i>Auditoría de completitud
      </div>
      <div class="dash-head-sede">${escapeHtml(sedeId)}</div>
    </div>
    <div class="dash-empty">
      <i class="ph ph-info"></i>
      <span>${escapeHtml(msg)}</span>
    </div>
  `;
}

async function renderCards(bloques, sedeId) {
  const rows = await Promise.all(
    bloques.map(async (a) => {
      const isLab = await esBloqueConLaboratorio(a.bloque, sedeId).catch(() => false);
      const pctClass = classifyPercent(a.percent);
      const labBadge = isLab ? `<span class="dash-lab">LAB</span>` : '';
      return `
        <article class="dash-card is-clickable"
                 role="button" tabindex="0"
                 data-bloque="${escapeHtml(a.bloque)}"
                 title="Seleccionar ${escapeHtml(prettyBloque(a.name || a.bloque))}">
          <div class="dash-title">
            <span>${escapeHtml(prettyBloque(a.name || a.bloque))}</span>
            ${labBadge}
          </div>
          <div class="dash-percent ${pctClass}">${a.percent}%</div>
          <div class="dash-bar">
            <div class="dash-bar-fill ${pctClass}" style="width:${a.percent}%"></div>
          </div>
          <div class="dash-meta">${a.complete}/${a.total} disciplinas con contenido</div>
        </article>
      `;
    })
  );
  return rows.join('');
}

function renderAlertsBlock(alerts) {
  if (!alerts || alerts.length === 0) {
    return `
      <div class="dash-alerts">
        <div class="dash-alerts-title">Vacíos detectados</div>
        <div class="dash-alerts-empty">
          <i class="ph-fill ph-check-circle"></i>
          Sin alertas: todas las disciplinas auditadas tienen contenido.
        </div>
      </div>
    `;
  }

  const MAX = 24;
  const shown = alerts.slice(0, MAX);
  const rest = alerts.length - shown.length;

  const items = shown
    .map((a) => {
      const sev = a.severity || 'low';
      const icon = sev === 'high'
        ? 'ph-fill ph-warning-octagon'
        : sev === 'medium'
          ? 'ph-fill ph-warning-circle'
          : 'ph ph-info';
      return `
        <div class="dash-alert ${sev}"
             data-bloque="${escapeHtml(a.bloquePath || a.bloque)}"
             title="${escapeHtml(a.path)}">
          <i class="${icon}"></i>
          <span><b>${escapeHtml(prettyBloque(a.bloque))}</b> · falta
            <span class="path">${escapeHtml(prettyDisciplina(a.disciplina))}</span>
          </span>
        </div>
      `;
    })
    .join('');

  const more = rest > 0
    ? `<div class="dash-alert" style="opacity:.7"><i class="ph ph-dots-three"></i><span>+${rest} alertas adicionales</span></div>`
    : '';

  return `
    <div class="dash-alerts">
      <div class="dash-alerts-title">Vacíos detectados (${alerts.length})</div>
      ${items}
      ${more}
    </div>
  `;
}

function renderKpis(global) {
  const gClass = classifyPercent(global.percent);
  return `
    <div class="dash-kpi">
      <div class="dash-kpi-card">
        <div class="dash-kpi-label">Completitud global</div>
        <div class="dash-kpi-value ${gClass}">${global.percent}%</div>
      </div>
      <div class="dash-kpi-card">
        <div class="dash-kpi-label">Bloques auditados</div>
        <div class="dash-kpi-value dim">${global.blocksCount}</div>
      </div>
      <div class="dash-kpi-card">
        <div class="dash-kpi-label">Disciplinas con contenido</div>
        <div class="dash-kpi-value dim">${global.complete}/${global.total}</div>
      </div>
    </div>
  `;
}

// ── API pública ───────────────────────────────────────────────────

/**
 * Renderiza el dashboard de auditoría. Controla los estados loading /
 * empty / ok. Seguro de llamar varias veces (idempotente por montaje).
 *
 * @param {Object} opts
 * @param {string} opts.sedeId
 * @param {Array<{name?: string, path?: string}>} [opts.bloques]
 * @param {HTMLElement|string} [opts.mountEl]
 * @returns {Promise<void>}
 */
export async function renderDashboard(opts = {}) {
  const { sedeId, bloques, mountEl } = opts;
  if (!sedeId) {
    Logger.warn?.('[dashboard-view] renderDashboard requiere sedeId.');
    return;
  }

  const root = resolveMount(mountEl);
  renderLoading(root, sedeId);

  let report;
  try {
    report = await auditSede(sedeId, bloques);
  } catch (err) {
    Logger.error?.('[dashboard-view] Falló auditSede:', err);
    renderEmpty(root, sedeId, `No se pudo auditar la sede: ${err.message}`);
    return;
  }

  if (!report.bloques || report.bloques.length === 0) {
    renderEmpty(root, sedeId, 'Esta sede no tiene bloques auditables en el schema.');
    return;
  }

  const cardsHtml = await renderCards(report.bloques, sedeId);

  root.innerHTML = `
    <div class="dash-head">
      <div class="dash-head-title">
        <i class="ph ph-chart-pie-slice"></i>Auditoría de completitud
      </div>
      <div class="dash-head-sede">${escapeHtml(sedeId)}</div>
    </div>
    ${renderKpis(report.global)}
    <div class="dash-grid">${cardsHtml}</div>
    ${renderAlertsBlock(report.alerts)}
  `;

  wireInteractions(root);
}

/**
 * Conecta la navegación del dashboard con el resto del sistema. Cada card
 * (y cada alerta con `data-bloque`) dispara `geovisor:bloque-selected`,
 * que el resto de la app ya sabe consumir (mapa, block-content-view,
 * structure-tree). Event delegation → sobrevive a re-renders sin leaks.
 */
function wireInteractions(root) {
  if (root.dataset.wired === 'true') return;
  root.dataset.wired = 'true';

  const emit = (bloqueId) => {
    if (!bloqueId) return;
    // Canal canónico: ui-state.setBloque() dispara `geovisor:bloque-selected`
    // sobre `document` con payload `{ bloque, sede, prev }` que consume el
    // resto del sistema (bootstrap, block-content-view, structure-tree).
    // Es idempotente: no emite si el bloque ya está seleccionado (evita loops).
    try {
      setUiBloque(bloqueId);
    } catch (err) {
      Logger.warn?.('[dashboard-view] setUiBloque falló, emitiendo fallback.', err);
      document.dispatchEvent(
        new CustomEvent('geovisor:bloque-selected', {
          detail: { bloque: bloqueId, source: 'dashboard' },
        })
      );
    }
  };

  root.addEventListener('click', (e) => {
    const target = e.target.closest('[data-bloque]');
    if (!target || !root.contains(target)) return;
    emit(target.dataset.bloque);
  });

  // Accesibilidad: Enter / Space en cards con role="button".
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('.dash-card[data-bloque]');
    if (!target || !root.contains(target)) return;
    e.preventDefault();
    emit(target.dataset.bloque);
  });
}

/**
 * Helper de conveniencia: re-renderiza usando la sede activa del state
 * global si está disponible (lectura pasiva, no escribe estado).
 */
export async function refreshDashboard(mountEl) {
  try {
    const { getSedeActiva } = await import('../core/ui-state.js');
    const sedeId = getSedeActiva?.();
    if (sedeId) await renderDashboard({ sedeId, mountEl });
  } catch (err) {
    Logger.debug?.('[dashboard-view] refreshDashboard: ui-state no disponible.', err?.message);
  }
}
