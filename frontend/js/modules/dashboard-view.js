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

/**
 * Empty-state "inteligente": se muestra cuando la sede tiene estructura
 * pero ninguna disciplina contiene archivos (arranque de proyecto).
 * Invita a subir contenido en lugar de mostrar 0% plano y alarmista.
 */
function renderEmptyIntelligent(root, sedeId) {
  root.innerHTML = `
    <div class="dash-head">
      <div class="dash-head-title">
        <i class="ph ph-chart-pie-slice"></i>Auditoría de completitud
      </div>
      <div class="dash-head-sede">${escapeHtml(sedeId)}</div>
    </div>
    <div class="dash-empty-smart">
      <div class="dash-empty-icon">
        <i class="ph-fill ph-folder-simple-plus"></i>
      </div>
      <div class="dash-empty-title">Sin información aún</div>
      <div class="dash-empty-text">
        Sube archivos a los bloques para comenzar la auditoría automática.<br/>
        El dashboard calculará el avance por disciplina en tiempo real.
      </div>
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

const GROUP_THRESHOLD = 12;           // cuando hay más, se agrupa por bloque
const FLAT_MAX = 24;                  // tope en render plano
const MAX_GROUPS_EXPANDED = 3;        // primeros N grupos abiertos por defecto
const SEV_RANK = { high: 0, medium: 1, low: 2 };

function iconForSeverity(sev) {
  if (sev === 'high') return 'ph-fill ph-warning-octagon';
  if (sev === 'medium') return 'ph-fill ph-warning-circle';
  return 'ph ph-info';
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

  if (alerts.length <= GROUP_THRESHOLD) {
    return renderAlertsFlat(alerts);
  }
  return renderAlertsGrouped(alerts);
}

/** Render plano — tope FLAT_MAX con contador de excedente. */
function renderAlertsFlat(alerts) {
  const shown = alerts.slice(0, FLAT_MAX);
  const rest = alerts.length - shown.length;

  const items = shown
    .map((a) => {
      const sev = a.severity || 'low';
      return `
        <div class="dash-alert ${sev}"
             data-bloque="${escapeHtml(a.bloquePath || a.bloque)}"
             title="${escapeHtml(a.path)}">
          <i class="${iconForSeverity(sev)}"></i>
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

/**
 * Render agrupado por bloque. Cada grupo es un <details> con la severidad
 * máxima, cantidad de pendientes y lista interna. Los primeros
 * MAX_GROUPS_EXPANDED se abren por defecto para no ocultar lo crítico.
 */
function renderAlertsGrouped(alerts) {
  const grouped = new Map();
  for (const a of alerts) {
    const key = a.bloquePath || a.bloque;
    if (!grouped.has(key)) {
      grouped.set(key, { name: a.bloque, bloquePath: key, items: [] });
    }
    grouped.get(key).items.push(a);
  }

  // Orden de grupos: por severidad máxima (high primero) y luego por cantidad.
  const groups = [...grouped.values()]
    .map((g) => {
      const topSev = g.items.reduce(
        (min, cur) => (SEV_RANK[cur.severity] < SEV_RANK[min] ? cur.severity : min),
        'low'
      );
      return { ...g, topSev, count: g.items.length };
    })
    .sort((x, y) => (SEV_RANK[x.topSev] - SEV_RANK[y.topSev]) || (y.count - x.count));

  const groupsHtml = groups
    .map((g, idx) => {
      const openAttr = idx < MAX_GROUPS_EXPANDED ? 'open' : '';
      const inner = g.items
        .map(
          (a) => `
            <div class="dash-alert ${a.severity || 'low'}"
                 data-bloque="${escapeHtml(a.bloquePath || a.bloque)}"
                 title="${escapeHtml(a.path)}">
              <i class="${iconForSeverity(a.severity)}"></i>
              <span>falta <span class="path">${escapeHtml(prettyDisciplina(a.disciplina))}</span></span>
            </div>
          `
        )
        .join('');
      // IMPORTANTE: el <summary> NO lleva `data-bloque`. Su click sólo
      // expande/colapsa el grupo. Para navegar al bloque, el usuario
      // pulsa el botón `.dash-go` (stopPropagation en wireInteractions).
      return `
        <details class="dash-alert-group ${g.topSev}" ${openAttr}>
          <summary class="dash-alert-sum">
            <span class="dash-alert-title">
              <i class="${iconForSeverity(g.topSev)}"></i>
              ${escapeHtml(prettyBloque(g.name))}
            </span>
            <span class="dash-alert-actions">
              <span class="dash-alert-items">${g.count} pendientes</span>
              <button type="button"
                      class="dash-go"
                      data-bloque="${escapeHtml(g.bloquePath)}"
                      title="Ir al bloque ${escapeHtml(prettyBloque(g.name))}">
                <i class="ph ph-arrow-right"></i>
                <span>Ver bloque</span>
              </button>
            </span>
          </summary>
          <div class="dash-alert-body">${inner}</div>
        </details>
      `;
    })
    .join('');

  return `
    <div class="dash-alerts dash-alerts-grouped">
      <div class="dash-alerts-title">Vacíos detectados (${alerts.length}) · ${groups.length} bloques</div>
      ${groupsHtml}
    </div>
  `;
}

function renderKpis(global) {
  const gClass = classifyPercent(global.percent);
  const done = Number(global.blocksComplete ?? 0);
  const totalBlocks = Number(global.blocksCount ?? 0);
  const risk = Number(global.riskCritical ?? 0);
  const blocksAtRisk = Number(global.blocksAtRisk ?? 0);

  // KPI "bloques completos": verde si ≥ mitad, ámbar si algunos, rojo si 0.
  const doneClass = done === 0 && totalBlocks > 0
    ? 'empty'
    : (done < Math.ceil(totalBlocks / 2) ? 'warn' : 'done');

  // Sub-línea del KPI de riesgo: "en N bloques".
  const riskSub = risk === 0
    ? 'Sin huecos críticos'
    : `en ${blocksAtRisk} bloque${blocksAtRisk === 1 ? '' : 's'}`;
  // La card queda en modo "alerta" sólo si hay riesgo real.
  const riskCardClass = risk > 0 ? 'dash-kpi-card danger' : 'dash-kpi-card';
  const riskValueClass = risk > 0 ? 'empty' : 'done';

  // Avance bruto (sin pesos) para contraste: si el ojo ve 70% técnico y
  // 90% bruto, significa que faltan justamente las disciplinas críticas.
  const flat = Number(global.flatPercent ?? global.percent ?? 0);
  const gap = Math.abs(flat - Number(global.percent ?? 0));
  // Sólo mostramos el avance bruto si aporta (o si hay diferencia con el
  // ponderado). Si son iguales, la línea sutil se reduce a "ponderado".
  const subtleLine = gap === 0
    ? `<div class="dash-kpi-subtle" title="Score ponderado por peso de disciplinas críticas">Índice técnico ponderado</div>`
    : `<div class="dash-kpi-subtle" title="Avance bruto: disciplinas con contenido / total (sin pesos)">
         Índice técnico · Avance bruto:
         <span class="dash-kpi-subtle-val">${flat}%</span>
       </div>`;

  return `
    <div class="dash-kpi">
      <div class="dash-kpi-card">
        <div class="dash-kpi-label">Completitud global</div>
        <div class="dash-kpi-value ${gClass}">${global.percent}%</div>
        ${subtleLine}
      </div>
      <div class="dash-kpi-card">
        <div class="dash-kpi-label">Bloques completos</div>
        <div class="dash-kpi-value ${doneClass}">${done}<span class="dash-kpi-sub">/${totalBlocks}</span></div>
      </div>
      <div class="${riskCardClass}">
        <div class="dash-kpi-label">
          <i class="ph-fill ph-warning-octagon" aria-hidden="true"></i>
          Riesgos críticos
        </div>
        <div class="dash-kpi-value ${riskValueClass}">${risk}</div>
        <div class="dash-kpi-note">${riskSub}</div>
      </div>
      <div class="dash-kpi-card">
        <div class="dash-kpi-label">Disciplinas con contenido</div>
        <div class="dash-kpi-value dim">${global.complete}/${global.total}</div>
      </div>
    </div>
  `;
}

/**
 * Difunde el estado de riesgo por bloque hacia el resto del sistema.
 * El mapa (u otros componentes) pueden escuchar `geovisor:dashboard-risk`
 * para resaltar bloques con huecos críticos.
 *
 * Payload:
 *   { sede, bloque, severity: 'high'|'medium'|'none',
 *     criticalCount, mediumCount, percent, status: 'ok'|'incomplete' }
 *
 * Se emite en `window` y también se publica un evento agregado
 * `geovisor:dashboard-risk-summary` con el snapshot completo de la sede.
 *
 * Optimización (diferencial): calculamos un snapshot compacto de riesgo
 * por bloque y lo comparamos con el anterior de la misma sede. Si nada
 * cambió, saltamos toda la emisión (y con ello todo el repintado del
 * mapa). Si cambió, actualizamos el snapshot y emitimos.
 */
const lastRiskSnapshotBySede = new Map(); // sedeId → snapshot string

function buildRiskSnapshot(report) {
  const parts = (report.bloques || [])
    .map((a) => {
      const high = a.missing.filter((m) => m.severity === 'high').length;
      const mid = a.missing.filter((m) => m.severity === 'medium').length;
      const sev = high > 0 ? 'h' : mid > 0 ? 'm' : 'n';
      return `${a.bloque}:${sev}:${a.percent}`;
    })
    .sort();
  return parts.join('|');
}

function emitRiskEvents(report) {
  if (!report || !Array.isArray(report.bloques)) return;

  const sedeKey = report.sede || 'unknown';
  const snapshot = buildRiskSnapshot(report);
  if (lastRiskSnapshotBySede.get(sedeKey) === snapshot) {
    // Sin cambios respecto al render anterior: no re-emitimos.
    // Evita repintados innecesarios del mapa y del overlay.
    Logger.debug?.('[dashboard-view] snapshot de riesgo sin cambios, omitiendo emit.');
    return;
  }
  lastRiskSnapshotBySede.set(sedeKey, snapshot);

  const summary = {};
  for (const a of report.bloques) {
    const critical = a.missing.filter((m) => m.severity === 'high').length;
    const mediumN = a.missing.filter((m) => m.severity === 'medium').length;
    const severity = critical > 0 ? 'high' : mediumN > 0 ? 'medium' : 'none';
    const status = a.percent >= 80 ? 'ok' : 'incomplete';

    const detail = {
      sede: report.sede,
      bloque: a.bloque,
      name: a.name || a.bloque,
      severity,
      criticalCount: critical,
      mediumCount: mediumN,
      percent: a.percent,
      status,
    };
    summary[a.bloque] = detail;

    try {
      window.dispatchEvent(new CustomEvent('geovisor:dashboard-risk', { detail }));
    } catch (_) { /* noop */ }
  }

  try {
    window.dispatchEvent(
      new CustomEvent('geovisor:dashboard-risk-summary', {
        detail: { sede: report.sede, bloques: summary },
      })
    );
  } catch (_) { /* noop */ }
}

/**
 * Invalida el snapshot de riesgo (útil tras subir/borrar archivos para
 * forzar re-emisión incluso si el % ponderado no cambió).
 */
export function invalidateRiskSnapshot(sedeId) {
  if (sedeId) lastRiskSnapshotBySede.delete(sedeId);
  else lastRiskSnapshotBySede.clear();
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
  const { sedeId, bloques, mountEl, silent = false } = opts;
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

  // Empty-state inteligente: sede con estructura pero sin ningún contenido.
  // (global.complete = 0 → ninguna disciplina de ningún bloque tiene archivos)
  if ((report.global?.complete ?? 0) === 0) {
    renderEmptyIntelligent(root, sedeId);
    wireInteractions(root); // inocuo, pero permite re-render limpio al subir algo
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

  // Notifica al mapa (o a cualquier listener) el estado de riesgo por
  // bloque. Se hace después del render para que la UI del dashboard
  // quede disponible antes del repintado del mapa.
  // En modo silent (preload parcial) no emitimos: el report cubre solo
  // algunos bloques y sería confuso pintar el mapa con info incompleta.
  if (!silent) emitRiskEvents(report);
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
    // Botón explícito "Ver bloque" dentro de un <summary>: debe navegar
    // SIN togglear el <details>. Por eso stopPropagation + preventDefault.
    const go = e.target.closest('.dash-go');
    if (go && root.contains(go)) {
      e.preventDefault();
      e.stopPropagation();
      emit(go.dataset.bloque);
      return;
    }

    // Cualquier otro elemento navegable (cards, alertas individuales).
    // Nota: el <summary> de un grupo ya NO lleva data-bloque, así que su
    // click conserva el comportamiento nativo (expandir/colapsar).
    const target = e.target.closest('[data-bloque]');
    if (!target || !root.contains(target)) return;
    emit(target.dataset.bloque);
  });

  // Accesibilidad: Enter / Space en cards y en el botón "Ver bloque".
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('.dash-card[data-bloque], .dash-go[data-bloque]');
    if (!target || !root.contains(target)) return;
    e.preventDefault();
    e.stopPropagation();
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
