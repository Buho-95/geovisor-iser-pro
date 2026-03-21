/**
 * Dashboard Gerencial — Glassmorphism Dark Theme
 * Avance Global (Donut), KPIs, y 8 barras de progreso por especialidad
 */
import { on, EVENTS } from './core/events.js';
import { state } from './core/state.js';
import { estructuraPlanimetriaISER, formatearNombreCarpeta } from './planoteca-structure.js';

let chartEspecialidades = null;
let containerEl = null;

/** Compute file counts grouped by top-level specialty */
function computeDashboardStats() {
  const archivos = Array.isArray(state.archivosNube) ? state.archivosNube : [];
  const keys = Object.keys(estructuraPlanimetriaISER);

  const byEsp = {};
  keys.forEach(k => { byEsp[k] = 0; });

  archivos.forEach(a => {
    let carpeta = (a?.carpeta || '').split('/').filter(Boolean)[0];
    const secondFolder = (a?.carpeta || '').split('/').filter(Boolean)[1];

    // Si la primera carpeta es un prefijo de sede, usar la segunda carpeta
    if (carpeta && ['pamplona', 'rinconada', 'caldera'].includes(carpeta.toLowerCase())) {
      carpeta = secondFolder;
    }

    if (carpeta && byEsp.hasOwnProperty(carpeta)) {
      byEsp[carpeta]++;
    } else {
      // Try fuzzy matching
      const match = keys.find(k => carpeta && carpeta.toLowerCase().includes(k.substring(3).toLowerCase().replace(/_/g, ' ')));
      if (match) byEsp[match]++;
    }
  });

  return {
    total: archivos.length,
    modelos3d: archivos.filter(a => ['skp', 'rvt', 'ifc', 'glb', 'gltf', 'obj'].includes(a?.tipo?.toLowerCase())).length,
    byEsp,
    keys
  };
}

/** Render the complete dashboard shell */
function renderShell(stats) {
  if (!containerEl) return;

  const totalPossible = stats.keys.length * 5; // estimated per specialty
  const globalPct = totalPossible > 0 ? Math.min(Math.round((stats.total / totalPossible) * 100), 100) : 0;

  let barsHtml = '';
  stats.keys.forEach((key, idx) => {
    const count = stats.byEsp[key] || 0;
    const maxPerEsp = 5;
    const pct = Math.min(Math.round((count / maxPerEsp) * 100), 100);
    const pinkClass = idx >= 4 ? ' pink' : '';
    const name = formatearNombreCarpeta(key);

    barsHtml += `
      <div class="dash-progress-item">
        <div class="dash-progress-header">
          <span class="dash-progress-name">${name}</span>
          <span class="dash-progress-pct" ${idx >= 4 ? 'style="color:var(--pink)"' : ''}>${count} archivos</span>
        </div>
        <div class="dash-progress-bar">
          <div class="dash-progress-fill${pinkClass}" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  });

  containerEl.innerHTML = `
    <div class="dash-donut-container">
      <div class="dash-donut-ring">
        <canvas id="chart-especialidades"></canvas>
        <div class="dash-donut-center">
          <div class="dash-donut-pct">${globalPct}%</div>
          <div class="dash-donut-label">Avance Global</div>
        </div>
      </div>
    </div>

    <div class="dash-kpis">
      <div class="dash-kpi">
        <div class="dash-kpi-label">Total Documentos</div>
        <div class="dash-kpi-value" id="kpi-total-planos">${stats.total}</div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-label">Modelos 3D</div>
        <div class="dash-kpi-value">${stats.modelos3d}</div>
      </div>
    </div>

    <div class="dash-progress-section">
      <div class="dash-progress-title">Progreso por Especialidad</div>
      ${barsHtml}
    </div>
  `.trim();
}

/** Render donut chart with Chart.js */
function renderChart(stats) {
  const canvas = document.getElementById('chart-especialidades');
  if (!canvas) return;
  const Chart = window.Chart;
  if (!Chart) return;

  if (chartEspecialidades) {
    try { chartEspecialidades.destroy(); } catch { }
    chartEspecialidades = null;
  }

  const labels = stats.keys.map(k => formatearNombreCarpeta(k));
  const data = stats.keys.map(k => stats.byEsp[k] || 0);
  const colors = [
    '#00e5ff', '#0091ea', '#6366f1', '#7c3aed',
    '#ff2d7b', '#e0004d', '#84cc16', '#f59e0b'
  ];

  chartEspecialidades = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 0,
        borderRadius: 2,
        spacing: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(11,18,32,0.9)',
          titleColor: '#e8edf5',
          bodyColor: '#8892a8',
          borderColor: 'rgba(0,229,255,0.2)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 10,
          callbacks: {
            label(ctx) {
              return `${ctx.label}: ${ctx.parsed} archivo(s)`;
            }
          }
        }
      },
      animation: { duration: 600, easing: 'easeOutQuart' }
    }
  });
}

function render() {
  if (!containerEl) return;
  const stats = computeDashboardStats();
  renderShell(stats);
  renderChart(stats);
}

export function initDashboardPro() {
  containerEl = document.getElementById('dashboard-container');
  if (!containerEl) return;

  on(EVENTS.FIRESTORE_SYNC, () => render());
  render();
}
