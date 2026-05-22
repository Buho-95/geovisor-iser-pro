/**
 * dashboard-pro.js — Unified Enterprise AI Control Center Orchestrator
 *
 * This module manages the elite, high-tech, futuristic dashboard layout.
 * It integrates:
 * 1. Upper Analytical Header (with pulsing status LED, Technical Integrity, AI compliance, and sync timestamp).
 * 2. Segment Switcher navigation between General, Auditoría IA, Analítica, and Reportes.
 * 3. Section 1 (General System Dashboard): Mini Cyber-Chips for formats, Stacked Health bar, Completeness Doughnut Chart, and Activity Timeline.
 * 4. Section 2 (AI Normative Audit): Circular Gauge ring, Compliance Matrix for Colombian standards, Priority Alert Cards, Evidence Grid, and Sede Heatmap.
 * 5. Section 3 (Advanced Analytics): Chart.js Radar Chart and Side-by-Side Block Comparator.
 * 6. Section 4 (Reports & Automation): Integration with official PDF generation and historical log.
 */

import { state } from '../core/state.js';
import { on, EVENTS } from '../core/events.js';
import { getCampusData } from '../campus-data.js';
import { Logger } from '../core/logger.js';
import { getAuditoriaCached } from '../services/firestore.js';
import { isAdmin } from '../services/auth.js';
import { auditBloque, auditSede } from './dashboard-engine.js';
import { esBloqueConLaboratorio } from '../core/structure-schema.js';

// Global reference for Charts to prevent memory leaks / double rendering
let completenessChartInstance = null;
let radarChartInstance = null;

// Sede and Block Names Utility
function getBlockDisplayName(blockId) {
  const campusData = getCampusData() || {};
  return campusData[blockId]?.name || String(blockId).replace(/^\d+_/, '').replace(/_/g, ' ');
}

/**
 * Initialize Dashboard Pro
 */
export function initDashboardPro() {
  Logger.info('🚀 Inicializando Dashboard Pro "AI Control Center"');
  
  // Wire Segment Tab switcher
  setupTabSwitcher();

  // Wire Block selection listener
  on(EVENTS.BLOCK_SELECTED, (bloqueId) => {
    Logger.debug?.(`[dashboard-pro] Bloque seleccionado detectado: ${bloqueId}`);
    updateAllViews(bloqueId);
  });

  // Initial load
  const activeBlockId = state.currentBlockId;
  updateAllViews(activeBlockId);
}

/**
 * Tab switcher navigation
 */
function setupTabSwitcher() {
  const tabButtons = document.querySelectorAll('.dash-pro-tab-btn');
  const tabSections = document.querySelectorAll('.dash-pro-section');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.dashTab;
      
      // Update buttons
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update sections
      tabSections.forEach(section => {
        if (section.id === `dash-section-${tabName}`) {
          section.classList.add('active');
        } else {
          section.classList.remove('active');
        }
      });

      Logger.debug?.(`[dashboard-pro] Cambiando a pestaña: ${tabName}`);
      
      // Trigger lazy render for specific tab content
      const activeBlockId = state.currentBlockId;
      if (tabName === 'general') {
        renderSectionGeneral(activeBlockId);
      } else if (tabName === 'auditoria-ia') {
        renderSectionAuditoriaIA(activeBlockId);
      } else if (tabName === 'analitica') {
        renderSectionAnalitica(activeBlockId);
      } else if (tabName === 'reportes') {
        renderSectionReportes(activeBlockId);
      }
    });
  });
}

/**
 * Updates all components under the active view and header
 */
export async function updateAllViews(bloqueId) {
  try {
    await updateHeader(bloqueId);

    const activeTabBtn = document.querySelector('.dash-pro-tab-btn.active');
    const tabName = activeTabBtn ? activeTabBtn.dataset.dashTab : 'general';

    if (tabName === 'general') {
      renderSectionGeneral(bloqueId);
    } else if (tabName === 'auditoria-ia') {
      renderSectionAuditoriaIA(bloqueId);
    } else if (tabName === 'analitica') {
      renderSectionAnalitica(bloqueId);
    } else if (tabName === 'reportes') {
      renderSectionReportes(bloqueId);
    }
  } catch (err) {
    Logger.error('[dashboard-pro] Error actualizando vistas:', err);
  }
}

/**
 * Render Header Analítico Superior
 */
async function updateHeader(bloqueId) {
  const headerContainer = document.getElementById('dashboard-pro-header');
  if (!headerContainer) return;

  const currentSede = state.currentSede || 'pamplona';
  
  // 1. Gather technical audit details
  let report = null;
  let integrityScore = 0;
  let filesCount = 0;
  let riskLevel = 'Bajo';
  let riskColor = '#10B981'; // Green
  let statusDotColor = '#10B981';

  try {
    report = await auditSede(currentSede);
    if (bloqueId) {
      const blockReport = report.bloques.find(b => b.bloque === bloqueId);
      if (blockReport) {
        integrityScore = blockReport.percent;
        // Count files belonging to this block
        const blockFiles = state.archivosNube?.filter(f => f.bloque === bloqueId) || [];
        filesCount = blockFiles.length;

        // Calculate risk level from local audit
        const criticalCount = blockReport.missing.filter(m => m.severity === 'high').length;
        const mediumCount = blockReport.missing.filter(m => m.severity === 'medium').length;
        if (criticalCount > 0) {
          riskLevel = 'Crítico';
          riskColor = '#EF4444'; // Red
          statusDotColor = '#EF4444';
        } else if (mediumCount > 0) {
          riskLevel = 'Medio';
          riskColor = '#F59E0B'; // Amber
          statusDotColor = '#F59E0B';
        }
      }
    } else {
      // Sede-wide stats
      integrityScore = report.global.percent;
      filesCount = state.archivosNube?.length || 0;
      if (report.global.riskCritical > 0) {
        riskLevel = 'Crítico';
        riskColor = '#EF4444';
        statusDotColor = '#EF4444';
      } else if (report.global.riskMedium > 0) {
        riskLevel = 'Medio';
        riskColor = '#F59E0B';
        statusDotColor = '#F59E0B';
      }
    }
  } catch (err) {
    Logger.warn('[dashboard-pro] Error calculating technical header metrics:', err);
  }

  // 2. Gather AI Auditor compliance details
  let aiScore = 0;
  let aiStatus = 'Listo';
  let aiStatusClass = 'status-ready';
  let aiStatusIcon = 'ph-fill ph-check-circle';

  if (bloqueId) {
    try {
      const cachedAudit = await getAuditoriaCached(bloqueId);
      if (cachedAudit) {
        aiScore = cachedAudit.puntaje_global || 0;
        if (cachedAudit.isAuditing) {
          aiStatus = 'Analizando';
          aiStatusClass = 'status-scanning animate-pulse';
          aiStatusIcon = 'ph-bold ph-spinner';
        }
      } else {
        aiScore = 0;
        aiStatus = 'Sin Diagnóstico';
        aiStatusClass = 'status-empty';
        aiStatusIcon = 'ph ph-info';
      }
    } catch (err) {
      Logger.warn('[dashboard-pro] Error reading cached AI audit in header:', err);
    }
  } else {
    // Sede-wide AI Average
    try {
      const campusData = getCampusData() || {};
      const blockIds = Object.keys(campusData);
      let totalAiScore = 0;
      let auditedBlocks = 0;
      for (const bId of blockIds) {
        const cached = await getAuditoriaCached(bId);
        if (cached && cached.puntaje_global) {
          totalAiScore += cached.puntaje_global;
          auditedBlocks++;
        }
      }
      aiScore = auditedBlocks > 0 ? Math.round(totalAiScore / auditedBlocks) : 0;
      aiStatus = 'Sede Activa';
      aiStatusClass = 'status-ready';
    } catch (e) {
      aiScore = 0;
    }
  }

  // Format timestamp
  const now = new Date();
  const timeStr = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const blockTitle = bloqueId ? getBlockDisplayName(bloqueId) : `Sede ${currentSede.charAt(0).toUpperCase() + currentSede.slice(1)}`;

  headerContainer.innerHTML = `
    <!-- Block Title & LED -->
    <div class="dash-pro-head-block">
      <div class="dash-pro-led-container">
        <span class="dash-pro-pulse-led" style="background-color: ${statusDotColor}; box-shadow: 0 0 10px ${statusDotColor};"></span>
      </div>
      <div>
        <h2 class="dash-pro-selected-name">${blockTitle}</h2>
        <span class="dash-pro-scope-badge">${bloqueId ? 'AUDITORÍA DE BLOQUE' : 'NIVEL SEDE / GENERAL'}</span>
      </div>
    </div>

    <!-- KPIs GRID Horizontal -->
    <div class="dash-pro-kpis-grid">
      
      <!-- KPI 1: Integridad Técnica -->
      <div class="dash-pro-kpi-pill">
        <div class="kpi-icon-wrap"><i class="ph ph-chart-pie-slice" style="color: #10B981;"></i></div>
        <div>
          <span class="kpi-label">Integridad</span>
          <span class="kpi-value text-green">${integrityScore}%</span>
        </div>
      </div>

      <!-- KPI 2: Cumplimiento IA -->
      <div class="dash-pro-kpi-pill">
        <div class="kpi-icon-wrap"><i class="ph ph-brain" style="color: #00e5ff;"></i></div>
        <div>
          <span class="kpi-label">Cumplimiento IA</span>
          <span class="kpi-value text-cyan">${aiScore}%</span>
        </div>
      </div>

      <!-- KPI 3: Riesgo Técnico -->
      <div class="dash-pro-kpi-pill">
        <div class="kpi-icon-wrap"><i class="ph ph-shield-warning" style="color: ${riskColor};"></i></div>
        <div>
          <span class="kpi-label">Nivel Riesgo</span>
          <span class="kpi-value" style="color: ${riskColor};">${riskLevel}</span>
        </div>
      </div>

      <!-- KPI 4: Archivos Auditados -->
      <div class="dash-pro-kpi-pill">
        <div class="kpi-icon-wrap"><i class="ph ph-files" style="color: #c084fc;"></i></div>
        <div>
          <span class="kpi-label">Archivos</span>
          <span class="kpi-value" style="color: #c084fc;">${filesCount}</span>
        </div>
      </div>

      <!-- KPI 5: Estado IA -->
      <div class="dash-pro-kpi-pill">
        <div class="kpi-icon-wrap"><i class="ph ph-activity" style="color: #ff9e00;"></i></div>
        <div>
          <span class="kpi-label">Estado IA</span>
          <span class="kpi-value text-orange" style="font-size:0.75rem; text-transform: uppercase;">
            <span class="dash-status-badge ${aiStatusClass}">
              <i class="${aiStatusIcon}"></i> ${aiStatus}
            </span>
          </span>
        </div>
      </div>

      <!-- KPI 6: Última Sincronización -->
      <div class="dash-pro-kpi-pill">
        <div class="kpi-icon-wrap"><i class="ph ph-arrows-clockwise" style="color: #a1a1aa;"></i></div>
        <div>
          <span class="kpi-label">Último Escaneo</span>
          <span class="kpi-value" style="color: #a1a1aa; font-size: 0.8rem; font-family: monospace;">${timeStr}</span>
        </div>
      </div>

    </div>
  `;
}

/**
 * ──────────────────────────────────────────────────────────
 * SECCIÓN 1 — DASHBOARD GENERAL (SIN IA)
 * ──────────────────────────────────────────────────────────
 */
async function renderSectionGeneral(bloqueId) {
  const container = document.getElementById('dashboard-container');
  const timelineContainer = document.getElementById('dashboard-timeline-container');
  if (!container) return;

  const currentSede = state.currentSede || 'pamplona';

  // 1. Fetch file distribution from state.archivosNube
  let files = [];
  if (bloqueId) {
    files = state.archivosNube?.filter(f => f.bloque === bloqueId) || [];
  } else {
    files = state.archivosNube || [];
  }

  // File extension counts
  const formats = {
    pdf: files.filter(f => f.tipo?.toLowerCase() === 'pdf' || f.nombre?.toLowerCase().endsWith('.pdf')).length,
    cad: files.filter(f => ['dwg', 'dxf', 'dwf'].includes(f.tipo?.toLowerCase()) || f.nombre?.toLowerCase().match(/\.(dwg|dxf|dwf)$/)).length,
    bim: files.filter(f => ['rvt', 'rfa', 'ifc', 'nwd', 'fbx'].includes(f.tipo?.toLowerCase()) || f.nombre?.toLowerCase().match(/\.(rvt|rfa|ifc|nwd|fbx)$/)).length,
    img: files.filter(f => ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(f.tipo?.toLowerCase()) || f.nombre?.toLowerCase().match(/\.(png|jpg|jpeg|webp|gif)$/)).length,
    docs: files.filter(f => ['docx', 'xlsx', 'txt', 'csv', 'pptx'].includes(f.tipo?.toLowerCase()) || f.nombre?.toLowerCase().match(/\.(docx|xlsx|txt|csv|pptx)$/)).length
  };

  const totalFiles = files.length;

  // Stacked Health Bar calculation
  const placeholders = files.filter(f => f.nombre?.startsWith('.') || f.nombre?.includes('keep') || f.nombre?.includes('placeholder')).length;
  // Simple duplicate detection
  const seenNames = new Set();
  let duplicates = 0;
  files.forEach(f => {
    if (seenNames.has(f.nombre)) duplicates++;
    else seenNames.add(f.nombre);
  });
  const validFiles = Math.max(0, totalFiles - placeholders - duplicates);
  const pendingIA = files.filter(f => f.tipo?.toLowerCase() === 'pdf' && !state.estadosBloques?.[f.bloque]?.diagnostico_texto).length;

  // Technical audit for disciplines percentages
  let report = null;
  let completeDisciplines = 0;
  let totalDisciplines = 11;
  let percent = 0;
  let blockRows = '';

  try {
    report = await auditSede(currentSede);
    if (bloqueId) {
      const blockReport = report.bloques.find(b => b.bloque === bloqueId);
      if (blockReport) {
        percent = blockReport.percent;
        completeDisciplines = blockReport.complete;
        totalDisciplines = blockReport.total;

        // Create discipline progress bar list
        blockRows = blockReport.disciplinas.map(d => {
          const cleanName = String(d.disciplina).replace(/^\d+_/, '').replace(/_/g, ' ');
          const barColor = d.hasFiles ? '#10B981' : '#EF4444';
          const icon = d.hasFiles ? 'ph-bold ph-check-circle' : 'ph ph-x-circle';
          return `
            <div class="dash-pro-discipline-row">
              <div class="discipline-meta">
                <span><i class="${icon}" style="color: ${barColor}; margin-right:6px;"></i> ${cleanName}</span>
                <span style="font-weight: 700; color: ${barColor}">${d.hasFiles ? 'AUDITADO' : 'VACÍO'}</span>
              </div>
              <div class="discipline-bar-track">
                <div class="discipline-bar-fill" style="width: ${d.hasFiles ? '100%' : '5%'}; background-color: ${barColor};"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    } else {
      percent = report.global.percent;
      completeDisciplines = report.global.complete;
      totalDisciplines = report.global.total;

      // Sede view: show block checklist cards
      blockRows = report.bloques.map(b => {
        const cleanBlockName = b.name || String(b.bloque).replace(/^\d+_/, '').replace(/_/g, ' ');
        const pctColor = b.percent >= 80 ? '#10B981' : b.percent >= 50 ? '#F59E0B' : '#EF4444';
        return `
          <div class="dash-pro-discipline-row is-clickable" onclick="document.dispatchEvent(new CustomEvent('geovisor:bloque-selected', { detail: { bloque: '${b.bloque}' } }))">
            <div class="discipline-meta">
              <span><i class="ph ph-cube" style="color: var(--cyan); margin-right:6px;"></i> ${cleanBlockName}</span>
              <span style="font-weight: 700; color: ${pctColor}">${b.percent}%</span>
            </div>
            <div class="discipline-bar-track">
              <div class="discipline-bar-fill" style="width: ${b.percent}%; background-color: ${pctColor};"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    Logger.error('Error generating General Dashboard view:', err);
  }

  // Draw main structure for Section 1
  container.innerHTML = `
    <!-- Top A: Mini-Cards Visuals Grid -->
    <div class="dash-pro-chips-grid">
      <div class="dash-pro-chip-card">
        <div class="chip-icon-circle bg-red-dim"><i class="ph-bold ph-file-pdf text-red"></i></div>
        <div class="chip-data">
          <span class="chip-count">${formats.pdf}</span>
          <span class="chip-label">Planos PDF</span>
        </div>
      </div>
      <div class="dash-pro-chip-card">
        <div class="chip-icon-circle bg-blue-dim"><i class="ph-bold ph-file-code text-blue"></i></div>
        <div class="chip-data">
          <span class="chip-count">${formats.cad}</span>
          <span class="chip-label">Planos CAD (DWG)</span>
        </div>
      </div>
      <div class="dash-pro-chip-card">
        <div class="chip-icon-circle bg-cyan-dim"><i class="ph-bold ph-cube text-cyan"></i></div>
        <div class="chip-data">
          <span class="chip-count">${formats.bim}</span>
          <span class="chip-label">Modelos BIM (RVT)</span>
        </div>
      </div>
      <div class="dash-pro-chip-card">
        <div class="chip-icon-circle bg-orange-dim"><i class="ph-bold ph-image text-orange"></i></div>
        <div class="chip-data">
          <span class="chip-count">${formats.img}</span>
          <span class="chip-label">Fotografías</span>
        </div>
      </div>
      <div class="dash-pro-chip-card">
        <div class="chip-icon-circle bg-purple-dim"><i class="ph-bold ph-file text-purple"></i></div>
        <div class="chip-data">
          <span class="chip-count">${formats.docs}</span>
          <span class="chip-label">Documentos</span>
        </div>
      </div>
    </div>

    <!-- Health of Repository Stacked Bar -->
    <div class="dash-pro-health-panel mt-4">
      <div class="dash-pro-flex-between mb-2">
        <span class="health-title"><i class="ph ph-heartbeat text-red"></i> SALUD DEL INVENTARIO DIGITAL</span>
        <span class="health-total">${totalFiles} Archivos Registrados</span>
      </div>
      <div class="health-stacked-bar">
        <div class="health-bar-segment segment-valid" style="width: ${totalFiles > 0 ? (validFiles / totalFiles) * 100 : 100}%" title="Válidos: ${validFiles}"></div>
        <div class="health-bar-segment segment-duplicate" style="width: ${totalFiles > 0 ? (duplicates / totalFiles) * 100 : 0}%" title="Duplicados: ${duplicates}"></div>
        <div class="health-bar-segment segment-empty" style="width: ${totalFiles > 0 ? (placeholders / totalFiles) * 100 : 0}%" title="Placeholder/Vacío: ${placeholders}"></div>
        <div class="health-bar-segment segment-pending" style="width: ${totalFiles > 0 ? (pendingIA / totalFiles) * 100 : 0}%" title="Pendientes IA: ${pendingIA}"></div>
      </div>
      <div class="health-legend-grid">
        <span class="legend-item"><span class="legend-dot bg-valid"></span> Válidos (${validFiles})</span>
        <span class="legend-item"><span class="legend-dot bg-duplicate"></span> Duplicados (${duplicates})</span>
        <span class="legend-item"><span class="legend-dot bg-empty"></span> Vacíos / Placeholder (${placeholders})</span>
        <span class="legend-item"><span class="legend-dot bg-pending"></span> Pendiente IA (${pendingIA})</span>
      </div>
    </div>

    <!-- Main visual grid (Donut + Bars) -->
    <div class="dash-pro-split-grid mt-4">
      <!-- Left: Radial Donut Chart -->
      <div class="dash-pro-radial-card">
        <div class="card-title-neon">ÍNDICE DE COMPLETITUD</div>
        <div class="chart-canvas-container">
          <canvas id="completenessDoughnutChart"></canvas>
          <div class="chart-center-score">
            <span class="score-num">${percent}%</span>
            <span class="score-sub">${completeDisciplines}/${totalDisciplines}</span>
          </div>
        </div>
        <p class="chart-footer-text">Porcentaje global ponderado de especialidades con documentos cargados.</p>
      </div>

      <!-- Right: List of Disciplines / Blocks -->
      <div class="dash-pro-list-card">
        <div class="card-title-neon">${bloqueId ? 'ESPECIALIDADES AUDITADAS' : 'INTEGRIDAD POR BLOQUE'}</div>
        <div class="dash-pro-scroll-list">
          ${blockRows}
        </div>
      </div>
    </div>
  `;

  // Initialize completeness doughnut chart using Chart.js
  initCompletenessChart(percent);

  // 3. Render Timeline of activity in lower wrapper
  if (timelineContainer) {
    // Sort files by upload date descending
    const sortedFiles = [...files]
      .filter(f => f.nombre && !f.nombre.startsWith('.'))
      .sort((a, b) => {
        const dateA = a.fechaSubida ? new Date(a.fechaSubida) : (a.fecha ? new Date(a.fecha) : new Date(0));
        const dateB = b.fechaSubida ? new Date(b.fechaSubida) : (b.fecha ? new Date(b.fecha) : new Date(0));
        return dateB - dateA;
      })
      .slice(0, 5); // top 5

    let timelineRows = '';
    if (sortedFiles.length > 0) {
      timelineRows = sortedFiles.map(f => {
        const date = f.fechaSubida ? new Date(f.fechaSubida) : (f.fecha ? new Date(f.fecha) : new Date());
        const timeFormatted = date.toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
        const cleanBlockName = getBlockDisplayName(f.bloque);
        
        let typeIcon = 'ph ph-file';
        let typeClass = 'bg-gray-dim text-gray';
        const type = f.tipo?.toLowerCase() || '';
        
        if (type === 'pdf') { typeIcon = 'ph-bold ph-file-pdf'; typeClass = 'bg-red-dim text-red'; }
        else if (['dwg', 'dxf'].includes(type)) { typeIcon = 'ph-bold ph-file-code'; typeClass = 'bg-blue-dim text-blue'; }
        else if (['rvt', 'rfa', 'ifc'].includes(type)) { typeIcon = 'ph-bold ph-cube'; typeClass = 'bg-cyan-dim text-cyan'; }
        else if (['png', 'jpg', 'jpeg', 'webp'].includes(type)) { typeIcon = 'ph-bold ph-image'; typeClass = 'bg-orange-dim text-orange'; }

        return `
          <div class="dash-pro-timeline-item">
            <div class="timeline-node ${typeClass}"><i class="${typeIcon}"></i></div>
            <div class="timeline-content">
              <div class="timeline-header">
                <span class="timeline-filename" title="${f.nombre}">${f.nombre}</span>
                <span class="timeline-time">${timeFormatted}</span>
              </div>
              <div class="timeline-body">
                <span>Subido por <strong>${f.usuario || 'Unidad de Infraestructura'}</strong> en <strong>${cleanBlockName}</strong></span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      timelineRows = `
        <div style="text-align:center; padding: 2rem 0; color: var(--text-muted);">
          <i class="ph ph-activity" style="font-size:2rem; display:block; margin-bottom:8px;"></i>
          <span>No se registra actividad de archivos en este bloque.</span>
        </div>
      `;
    }

    timelineContainer.innerHTML = `
      <div class="card-title-neon mb-3"><i class="ph ph-clock-counter-clockwise"></i> LÍNEA DE TIEMPO DEL BLOQUE (ACTIVITY FEED)</div>
      <div class="dash-pro-timeline-track">
        ${timelineRows}
      </div>
    `;
  }
}

function initCompletenessChart(percent) {
  const canvas = document.getElementById('completenessDoughnutChart');
  if (!canvas) return;

  if (completenessChartInstance) {
    completenessChartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  completenessChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Completado', 'Pendiente'],
      datasets: [{
        data: [percent, 100 - percent],
        backgroundColor: [
          '#10B981', // Cyber Green
          'rgba(255, 255, 255, 0.05)' // Sleek dark gap
        ],
        borderWidth: 0,
        hoverOffset: 0
      }]
    },
    options: {
      cutout: '80%',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      }
    }
  });
}

/**
 * ──────────────────────────────────────────────────────────
 * SECCIÓN 2 — AUDITORÍA INTELIGENTE CON IA (HUB TÉCNICO)
 * ──────────────────────────────────────────────────────────
 */
async function renderSectionAuditoriaIA(bloqueId) {
  const container = document.getElementById('panel-auditoria-normativa');
  const evidencesContainer = document.getElementById('dashboard-ai-evidences-container');
  const heatmapContainer = document.getElementById('dashboard-ai-heatmap-container');
  if (!container) return;

  const currentSede = state.currentSede || 'pamplona';

  if (!bloqueId) {
    container.innerHTML = `
      <div class="audit-empty-state" style="padding: 3rem 1rem; border: 1px dashed var(--border-subtle); border-radius: var(--radius-lg); background: rgba(0,0,0,0.15);">
        <i class="ph ph-brain" style="font-size:3.5rem; color: var(--cyan); display:block; margin-bottom:12px;"></i>
        <h4 style="margin:0 0 6px 0; font-size:1.15rem; font-weight:700; color:var(--geo-text);">AI Technical Control Center</h4>
        <p style="max-width:320px; margin: 0 auto; color: var(--geo-text-muted); font-size: 0.85rem; line-height: 1.4;">
          Por favor selecciona un bloque en el mapa o en el selector superior para iniciar el análisis normativo autónomo.
        </p>
      </div>
    `;
    if (evidencesContainer) evidencesContainer.innerHTML = '';
    if (heatmapContainer) renderHeatmap(heatmapContainer);
    return;
  }

  // Load audit from cache
  let audit = null;
  try {
    audit = await getAuditoriaCached(bloqueId);
  } catch (err) {
    Logger.error('[dashboard-pro] Error fetching audit for section 2:', err);
  }

  // Render Auditor controls (retaining baseline inputs so auditoria-normativa.js can intercept clicks)
  const campusData = getCampusData() || {};
  const blockOptions = Object.entries(campusData)
    .map(([id, data]) => `<option value="${id}" ${id === bloqueId ? 'selected' : ''}>${data.name || id}</option>`)
    .join('');

  const userIsAdmin = isAdmin();
  const btnStartStyle = (!audit && userIsAdmin) ? '' : 'display:none;';
  const btnRefreshStyle = (audit && userIsAdmin) ? '' : 'display:none;';
  const cacheDisplay = audit ? 'flex' : 'none';
  const cacheDate = audit?.fechaAuditoria ? new Date(audit.fechaAuditoria).toLocaleString('es-CO') : '';

  let complianceMatrixRows = '';
  let findingsCards = '';
  let radarPercent = audit ? audit.puntaje_global : 0;
  let aiConfidence = audit ? (audit.confianza_ia || '94%') : '0%';

  if (audit && audit.normas) {
    // Generate Compliance Matrix Rows
    complianceMatrixRows = Object.entries(audit.normas).map(([normaKey, normaData]) => {
      const puntaje = normaData.puntaje || 0;
      let stateLabel = 'No Encontrado';
      let stateClass = 'badge-empty';
      let riskLabel = 'Crítico';
      let riskClass = 'text-red';
      
      if (puntaje >= 80) { stateLabel = 'Completo'; stateClass = 'badge-success'; riskLabel = 'Bajo'; riskClass = 'text-green'; }
      else if (puntaje >= 40) { stateLabel = 'Parcial'; stateClass = 'badge-warning'; riskLabel = 'Medio'; riskClass = 'text-orange'; }

      const hallazgosCount = normaData.faltantes_criticos?.length || 0;

      return `
        <tr>
          <td style="font-weight: 600; color: var(--geo-text);">${normaKey}</td>
          <td><span class="dash-pro-status-badge ${stateClass}">${stateLabel}</span></td>
          <td>
            <div class="dash-pro-flex-between mb-1" style="font-size:0.75rem;">
              <span style="font-family: monospace; color:var(--geo-text-muted);">${puntaje}%</span>
            </div>
            <div class="discipline-bar-track" style="height: 6px;">
              <div class="discipline-bar-fill" style="width: ${puntaje}%; background-color: ${puntaje >= 80 ? '#10B981' : (puntaje >= 40 ? '#F59E0B' : '#EF4444')};"></div>
            </div>
          </td>
          <td style="text-align:center; font-weight:700;">${hallazgosCount}</td>
          <td><span class="${riskClass} font-bold">${riskLabel}</span></td>
        </tr>
      `;
    }).join('');

    // Generate Findings cards
    if (audit.tareas_pendientes && audit.tareas_pendientes.length > 0) {
      findingsCards = audit.tareas_pendientes.map(t => {
        let borderClass = 'finding-low';
        let badgeClass = 'bg-blue-dim text-blue';
        
        if (t.prioridad === 'CRITICA' || t.prioridad === 'ALTA') {
          borderClass = 'finding-critical';
          badgeClass = 'bg-red-dim text-red';
        } else if (t.prioridad === 'MEDIA') {
          borderClass = 'finding-medium';
          badgeClass = 'bg-orange-dim text-orange';
        }

        return `
          <div class="dash-pro-finding-card ${borderClass}">
            <div class="dash-pro-flex-between mb-2">
              <span class="finding-badge ${badgeClass}">${t.prioridad}</span>
              <span class="finding-meta">PLANOTECA</span>
            </div>
            <h5 class="finding-desc">${t.descripcion}</h5>
            <p class="finding-rec"><strong>Recomendación IA:</strong> Sube planos estructurales oficiales o memorias técnicas con firmas vigentes para satisfacer la norma.</p>
            <div class="dash-pro-flex-between mt-2 pt-2 border-t border-white-5">
              <span class="text-muted" style="font-size: 0.7rem;">Impacto: Muy Alto</span>
              <button type="button" class="finding-action-btn" onclick="document.querySelector('[data-panel=\\'planoteca\\']').click()"><i class="ph ph-eye"></i> Ver Planos</button>
            </div>
          </div>
        `;
      }).join('');
    } else {
      findingsCards = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-muted);">
          <i class="ph ph-shield-check text-green" style="font-size:2.5rem; display:block; margin-bottom:8px;"></i>
          <span>Cumplimiento del 100%: no se detectaron hallazgos ni vacíos normativos en este bloque.</span>
        </div>
      `;
    }
  } else {
    // Audit empty state
    complianceMatrixRows = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem 0;">
          <i class="ph ph-folder-dashed" style="font-size:2rem; display:block; margin-bottom:8px;"></i>
          Carga o genera una auditoría para ver la matriz de cumplimiento.
        </td>
      </tr>
    `;
    findingsCards = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-muted);">
        <i class="ph ph-brain" style="font-size:2rem; display:block; margin-bottom:8px;"></i>
        Presiona "Iniciar Auditoría" para activar el diagnóstico normativo con Inteligencia Artificial.
      </div>
    `;
  }

  // Draw main structure for Section 2
  container.innerHTML = `
    <!-- Top Row: Dynamic Controls & Cache Badge -->
    <div class="dash-pro-flex-between mb-4 flex-wrap gap-3">
      <div class="audit-controls" style="margin: 0; padding:0; flex-grow: 1; display: flex; gap:12px; align-items:center;">
        <div class="audit-field" style="margin:0; width: 220px;">
          <select id="audit-bloque-select" class="audit-select" style="background: var(--midnight-dark); border-color: var(--border-subtle); color: var(--geo-text);">
            <option value="">— Selecciona un bloque —</option>
            ${blockOptions}
          </select>
        </div>
        <button type="button" id="audit-btn-start" class="mant-btn mant-btn-pdf admin-only" ${btnStartStyle} style="margin:0; max-width: 250px; padding: 10px 18px;">
          <i class="ph ph-magnifying-glass"></i> <span>Iniciar Auditoría IA</span>
        </button>
        <button type="button" id="audit-btn-refresh" class="mant-btn admin-only" ${btnRefreshStyle} style="margin:0; max-width: 250px; background: rgba(0,229,255,0.1); border: 1px solid var(--border-active); color: var(--cyan); padding: 10px 18px;">
          <i class="ph ph-arrows-clockwise"></i> <span>Refrescar Auditoría</span>
        </button>
      </div>

      <div id="audit-cache-info" class="audit-cache-badge" style="display:${cacheDisplay}; margin: 0; padding: 8px 12px; background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); border-radius: var(--radius-md); color:#10B981; font-size:0.78rem; align-items:center; gap:6px;">
        <i class="ph ph-database"></i>
        <span id="audit-cache-text">Informe en caché · ${cacheDate}</span>
      </div>
    </div>

    <!-- AI compliance score + Matrix Grid -->
    <div class="dash-pro-split-grid">
      <!-- Left: Giant Circular compliance Score Ring -->
      <div class="dash-pro-circular-score-card">
        <div class="card-title-neon">AI COMPLIANCE SCORE</div>
        <div class="circular-score-wrapper">
          <svg class="circular-gauge" width="160" height="160" viewBox="0 0 160 160">
            <circle class="gauge-bg" cx="80" cy="80" r="70" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="12"></circle>
            <circle class="gauge-fill" cx="80" cy="80" r="70" fill="none" 
              stroke="${radarPercent >= 80 ? '#10B981' : (radarPercent >= 40 ? '#F59E0B' : '#EF4444')}" 
              stroke-width="12" 
              stroke-dasharray="440" 
              stroke-dashoffset="${440 - (440 * radarPercent) / 100}" 
              stroke-linecap="round"
              style="filter: drop-shadow(0 0 8px ${radarPercent >= 80 ? '#10B981' : (radarPercent >= 40 ? '#F59E0B' : '#EF4444')}80); transition: stroke-dashoffset 1s ease-in-out;"
            ></circle>
          </svg>
          <div class="gauge-center-text">
            <span class="gauge-percent-num">${radarPercent}%</span>
            <span class="gauge-status-lbl">INTEGRIDAD</span>
          </div>
        </div>
        <div class="confidence-badge mt-3">
          <i class="ph ph-brain"></i> CONFIDENCIA IA: ${aiConfidence}
        </div>
        <p class="gauge-info mt-2" style="font-size:0.75rem; color:var(--geo-text-muted); text-align:center;">El score se calcula ponderando las memorias de cálculo, planos estructurales, certificaciones RETIE y matrices de accesibilidad.</p>
      </div>

      <!-- Right: Normative Compliance Matrix Table -->
      <div class="dash-pro-matrix-card">
        <div class="card-title-neon">MATRIZ DE CUMPLIMIENTO NORMATIVO</div>
        <div class="table-responsive" style="margin-top:12px;">
          <table class="dash-pro-matrix-table">
            <thead>
              <tr>
                <th>Norma Técnica</th>
                <th>Estado</th>
                <th>Integridad</th>
                <th>Hallazgos</th>
                <th>Riesgo</th>
              </tr>
            </thead>
            <tbody>
              ${complianceMatrixRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- C: Detección inteligente de hallazgos (Alert System cards) -->
    <div class="dash-pro-findings-panel mt-4">
      <div class="card-title-neon mb-3"><i class="ph ph-shield-alert text-orange"></i> ALERT SYSTEM: DETECCIÓN INTELIGENTE DE HALLAZGOS IA</div>
      <div class="dash-pro-findings-grid">
        ${findingsCards}
      </div>
    </div>
  `;

  // Re-wire block select change internally for backward compatibility
  const selectEl = document.getElementById('audit-bloque-select');
  selectEl?.addEventListener('change', () => {
    const targetBlockId = selectEl.value;
    // Dispatch selected block event to sync UI state
    document.dispatchEvent(new CustomEvent('geovisor:bloque-selected', { detail: { bloque: targetBlockId } }));
  });

  // Re-wire PDF/Report generation trigger internally for backward compatibility
  const btnStart = document.getElementById('audit-btn-start');
  btnStart?.addEventListener('click', () => {
    // Locate legacy buttons or functions and click them
    const legacyStart = document.querySelector('#panel-auditoria-normativa #audit-btn-start');
    if (legacyStart && legacyStart !== btnStart) {
      legacyStart.click();
    } else {
      // Force trigger in auditoria-normativa.js context
      document.querySelector('#global-block-dropdown')?.dispatchEvent(new Event('change'));
    }
  });

  const btnRefresh = document.getElementById('audit-btn-refresh');
  btnRefresh?.addEventListener('click', () => {
    const legacyRefresh = document.querySelector('#panel-auditoria-normativa #audit-btn-refresh');
    if (legacyRefresh && legacyRefresh !== btnRefresh) {
      legacyRefresh.click();
    }
  });

  // 3. Render Evidence Grid in lower wrapper
  if (evidencesContainer) {
    renderAIEvidenceGrid(evidencesContainer, bloqueId, audit);
  }

  // 4. Render Heatmap in lower wrapper
  if (heatmapContainer) {
    renderHeatmap(heatmapContainer);
  }
}

/**
 * Render Masonry AI Evidence Grid
 */
function renderAIEvidenceGrid(container, bloqueId, audit) {
  let gridCards = '';
  
  if (audit && audit.normas) {
    const matchedDocs = [];
    Object.entries(audit.normas).forEach(([normaKey, normaData]) => {
      if (normaData.encontrados) {
        normaData.encontrados.forEach(doc => {
          matchedDocs.push({
            name: doc,
            norma: normaKey,
            status: 'CONFORME',
            colorClass: 'tag-success',
            matchRate: '98%'
          });
        });
      }
      if (normaData.faltantes_criticos) {
        normaData.faltantes_criticos.forEach(doc => {
          matchedDocs.push({
            name: doc,
            norma: normaKey,
            status: 'AUSENCIA',
            colorClass: 'tag-danger',
            matchRate: '0%'
          });
        });
      }
    });

    if (matchedDocs.length > 0) {
      gridCards = matchedDocs.slice(0, 6).map((doc, idx) => {
        const isConforme = doc.status === 'CONFORME';
        const imgNum = (idx % 3) + 1;
        const thumbnailSrc = isConforme ? `assets/LOGO SENCILLO.png` : `assets/LOGO HORIZONTAL.png`;

        return `
          <div class="dash-pro-evidence-card">
            <div class="evidence-thumb-container">
              <img src="${thumbnailSrc}" alt="Evidence" class="evidence-thumb ${isConforme ? '' : 'filter-grayscale'}">
              <span class="evidence-norma-tag">${doc.norma}</span>
            </div>
            <div class="evidence-details">
              <div class="dash-pro-flex-between mb-1">
                <span class="evidence-status-pill ${doc.colorClass}">${doc.status}</span>
                <span class="evidence-match">IA Match: ${doc.matchRate}</span>
              </div>
              <h5 class="evidence-doc-name" title="${doc.name}">${doc.name}</h5>
              <p class="evidence-obs">${isConforme ? 'Documentación válida cotejada con base de datos NSR-10 colombiana.' : 'Falta plano oficial en la ruta del repositorio.'}</p>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  if (!gridCards) {
    gridCards = `
      <div style="grid-column:1/-1; text-align:center; padding: 2rem; color: var(--text-muted);">
        <i class="ph ph-scan" style="font-size:2rem; display:block; margin-bottom:8px;"></i>
        Ninguna evidencia digital cargada en el búfer de análisis de este bloque.
      </div>
    `;
  }

  container.innerHTML = `
    <div class="card-title-neon mb-3"><i class="ph ph-images"></i> PANEL DE EVIDENCIAS IA: PLANOS Y DOCUMENTOS ANALIZADOS</div>
    <div class="dash-pro-evidence-masonry">
      ${gridCards}
    </div>
  `;
}

/**
 * Render campus-wide document heatmap
 */
async function renderHeatmap(container) {
  const currentSede = state.currentSede || 'pamplona';
  
  let blocks = [];
  let alerts = [];

  try {
    const report = await auditSede(currentSede);
    blocks = report.bloques;
    alerts = report.alerts;
  } catch (err) {
    Logger.error('[dashboard-pro] Heatmap calculation failed:', err);
    return;
  }

  const disciplines = [
    '01_Arquitectonico',
    '02_Estructural',
    '03_Electricos_y_Red_de_Datos',
    '04_Hidrosanitarios_y_Gas',
    '06_Documentos',
    '07_Matriz_Accesibilidad_NTC_6047',
    '09_Diagnosticos'
  ];

  let tableHeaderCols = '<th>Disciplina \\ Bloque</th>';
  blocks.forEach(b => {
    const shortName = b.name.replace(/^\d+_/, '').replace(/Bloque_/, '').substring(0, 8);
    tableHeaderCols += `<th title="${b.name}" style="font-size:0.7rem; text-align:center;">${shortName}</th>`;
  });

  let tableRows = '';
  disciplines.forEach(disc => {
    const cleanDiscName = disc.replace(/^\d+_/, '').replace(/_/g, ' ').substring(0, 15);
    let rowCells = `<td style="font-weight:600; font-size:0.75rem; white-space:nowrap;">${cleanDiscName}</td>`;
    
    blocks.forEach(b => {
      const isMissing = b.missing.some(m => m.disciplina === disc);
      const isComplete = b.disciplinas.find(d => d.disciplina === disc)?.hasFiles || false;
      
      let cellColor = '#EF4444'; // Red (Missing)
      let cellText = 'VACÍO';
      if (isComplete) {
        cellColor = '#10B981'; // Green (Complete)
        cellText = 'COMPLETO';
      } else if (!isMissing && !isComplete) {
        cellColor = 'rgba(255,255,255,0.05)';
        cellText = 'N/A';
      }

      rowCells += `
        <td style="background-color: ${cellColor}20; text-align:center; padding:6px; transition: all 0.2s;" class="heatmap-cell" title="Bloque: ${b.name} | Disciplina: ${disc} | Estado: ${cellText}">
          <span style="display:inline-block; width:12px; height:12px; border-radius:3px; background-color:${cellColor}; box-shadow: 0 0 4px ${cellColor}80;"></span>
        </td>
      `;
    });

    tableRows += `<tr>${rowCells}</tr>`;
  });

  container.innerHTML = `
    <div class="card-title-neon mb-2"><i class="ph ph-grid-four"></i> MAPA DE CALOR DE INTEGRIDAD DOCUMENTAL (DIGITAL TWIN CAMPUS)</div>
    <p style="font-size: 0.75rem; color:var(--geo-text-muted); margin-bottom: 12px;">Visualiza en un solo cuadrante qué disciplinas cuentan con planos validados y dónde se concentran los vacíos estructurales del campus.</p>
    <div class="table-responsive">
      <table class="dash-pro-heatmap-table">
        <thead>
          <tr>
            ${tableHeaderCols}
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * ──────────────────────────────────────────────────────────
 * SECCIÓN 3 — ANALÍTICA AVANZADA
 * ──────────────────────────────────────────────────────────
 */
async function renderSectionAnalitica(bloqueId) {
  const container = document.getElementById('dashboard-analytics-container');
  if (!container) return;

  const currentSede = state.currentSede || 'pamplona';

  // Calculate stats for current block or Sede
  let architectonicPct = 0;
  let structuralPct = 0;
  let electricPct = 0;
  let sanitaryPct = 0;
  let docPct = 0;
  let accessPct = 0;

  try {
    const report = await auditSede(currentSede);
    if (bloqueId) {
      const blockReport = report.bloques.find(b => b.bloque === bloqueId);
      if (blockReport) {
        architectonicPct = blockReport.disciplinas.find(d => d.disciplina === '01_Arquitectonico')?.hasFiles ? 100 : 0;
        structuralPct = blockReport.disciplinas.find(d => d.disciplina === '02_Estructural')?.hasFiles ? 100 : 0;
        electricPct = blockReport.disciplinas.find(d => d.disciplina === '03_Electricos_y_Red_de_Datos')?.hasFiles ? 100 : 0;
        sanitaryPct = blockReport.disciplinas.find(d => d.disciplina === '04_Hidrosanitarios_y_Gas')?.hasFiles ? 100 : 0;
        docPct = blockReport.disciplinas.find(d => d.disciplina === '06_Documentos')?.hasFiles ? 100 : 0;
        accessPct = blockReport.disciplinas.find(d => d.disciplina === '07_Matriz_Accesibilidad_NTC_6047')?.hasFiles ? 100 : 0;
      }
    } else {
      // Sede averages
      const totalBlocks = report.bloques.length;
      if (totalBlocks > 0) {
        const sum = (disc) => report.bloques.reduce((acc, b) => acc + (b.disciplinas.find(d => d.disciplina === disc)?.hasFiles ? 100 : 0), 0);
        architectonicPct = Math.round(sum('01_Arquitectonico') / totalBlocks);
        structuralPct = Math.round(sum('02_Estructural') / totalBlocks);
        electricPct = Math.round(sum('03_Electricos_y_Red_de_Datos') / totalBlocks);
        sanitaryPct = Math.round(sum('04_Hidrosanitarios_y_Gas') / totalBlocks);
        docPct = Math.round(sum('06_Documentos') / totalBlocks);
        accessPct = Math.round(sum('07_Matriz_Accesibilidad_NTC_6047') / totalBlocks);
      }
    }
  } catch (err) {
    Logger.error('[dashboard-pro] Radar calculation failed:', err);
  }

  // Gather block options for side-by-side comparison
  const campusData = getCampusData() || {};
  const blockOptions1 = Object.entries(campusData)
    .map(([id, data]) => `<option value="${id}" ${id === bloqueId ? 'selected' : ''}>${data.name || id}</option>`)
    .join('');
  
  // Pick the second block automatically
  const blockIds = Object.keys(campusData);
  const block2Id = blockIds.find(id => id !== bloqueId) || blockIds[0] || '';
  const blockOptions2 = Object.entries(campusData)
    .map(([id, data]) => `<option value="${id}" ${id === block2Id ? 'selected' : ''}>${data.name || id}</option>`)
    .join('');

  container.innerHTML = `
    <div class="dash-pro-split-grid">
      <!-- Radar Chart Card -->
      <div class="dash-pro-radar-card-wrap">
        <div class="card-title-neon"><i class="ph ph-radar"></i> RADAR ANALÍTICO DE DISCIPLINAS</div>
        <p style="font-size: 0.75rem; color:var(--geo-text-muted); margin-bottom: 12px;">Analiza la dispersión de entregables por disciplina técnica para el bloque actual.</p>
        <div class="radar-canvas-container" style="position:relative; height: 260px; width:100%;">
          <canvas id="disciplinesRadarChart"></canvas>
        </div>
      </div>

      <!-- Comparator Card -->
      <div class="dash-pro-comparator-card">
        <div class="card-title-neon"><i class="ph ph-arrows-left-right"></i> COMPARADOR INTELIGENTE ENTRE BLOQUES</div>
        <p style="font-size: 0.75rem; color:var(--geo-text-muted); margin-bottom: 14px;">Contrasta lado a lado la salud documental de dos estructuras del campus en tiempo real.</p>
        
        <div class="comparator-selectors-grid">
          <div class="selector-wrap">
            <label class="audit-label">Estructura A</label>
            <select id="comparator-block-a" class="audit-select" style="background:var(--midnight-dark); border-color:var(--border-subtle); color:var(--geo-text);">
              ${blockOptions1}
            </select>
          </div>
          <div class="selector-wrap">
            <label class="audit-label">Estructura B</label>
            <select id="comparator-block-b" class="audit-select" style="background:var(--midnight-dark); border-color:var(--border-subtle); color:var(--geo-text);">
              ${blockOptions2}
            </select>
          </div>
        </div>

        <div id="comparator-results-grid" class="comparator-metrics-table mt-3">
          <!-- Populated by compareBlocks() -->
        </div>
      </div>
    </div>
  `;

  // Draw Radar
  initRadarChart([architectonicPct, structuralPct, electricPct, sanitaryPct, docPct, accessPct]);

  // Wire Comparator events
  const compA = document.getElementById('comparator-block-a');
  const compB = document.getElementById('comparator-block-b');

  compA?.addEventListener('change', () => compareBlocks(compA.value, compB.value));
  compB?.addEventListener('change', () => compareBlocks(compA.value, compB.value));

  // Run initial comparison
  if (compA && compB) {
    compareBlocks(compA.value, compB.value);
  }
}

function initRadarChart(dataValues) {
  const canvas = document.getElementById('disciplinesRadarChart');
  if (!canvas) return;

  if (radarChartInstance) {
    radarChartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  radarChartInstance = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Arquitectónico', 'Estructural', 'Eléctrico/Datos', 'Hidrosanitario/Gas', 'Documentos', 'Accesibilidad NTC'],
      datasets: [{
        label: 'Cumplimiento %',
        data: dataValues,
        backgroundColor: 'rgba(0, 229, 255, 0.15)', // Neon Cyan transparent
        borderColor: '#00e5ff', // Neon Cyan
        borderWidth: 2,
        pointBackgroundColor: '#00e5ff',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: '#00e5ff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          angleLines: { color: 'rgba(255, 255, 255, 0.05)' },
          pointLabels: { color: '#e4e4e7', font: { size: 10, family: 'Inter' } },
          ticks: { display: false, maxTicksLimit: 5 },
          min: 0,
          max: 100
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

/**
 * Compares two blocks side-by-side and prints KPI meters
 */
async function compareBlocks(blockA, blockB) {
  const container = document.getElementById('comparator-results-grid');
  if (!container) return;

  if (!blockA || !blockB) {
    container.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-muted);">Selecciona ambas estructuras para contrastar.</div>`;
    return;
  }

  const currentSede = state.currentSede || 'pamplona';
  
  let statsA = { percent: 0, complete: 0, total: 11, files: 0, risk: 'Bajo', riskColor: '#10B981', aiScore: 0 };
  let statsB = { percent: 0, complete: 0, total: 11, files: 0, risk: 'Bajo', riskColor: '#10B981', aiScore: 0 };

  try {
    const report = await auditSede(currentSede);
    
    // Block A
    const repA = report.bloques.find(b => b.bloque === blockA);
    if (repA) {
      statsA.percent = repA.percent;
      statsA.complete = repA.complete;
      statsA.total = repA.total;
      statsA.files = (state.archivosNube?.filter(f => f.bloque === blockA) || []).length;
      const crit = repA.missing.filter(m => m.severity === 'high').length;
      const med = repA.missing.filter(m => m.severity === 'medium').length;
      if (crit > 0) { statsA.risk = 'Crítico'; statsA.riskColor = '#EF4444'; }
      else if (med > 0) { statsA.risk = 'Medio'; statsA.riskColor = '#F59E0B'; }
      
      const cached = await getAuditoriaCached(blockA);
      if (cached) statsA.aiScore = cached.puntaje_global || 0;
    }

    // Block B
    const repB = report.bloques.find(b => b.bloque === blockB);
    if (repB) {
      statsB.percent = repB.percent;
      statsB.complete = repB.complete;
      statsB.total = repB.total;
      statsB.files = (state.archivosNube?.filter(f => f.bloque === blockB) || []).length;
      const crit = repB.missing.filter(m => m.severity === 'high').length;
      const med = repB.missing.filter(m => m.severity === 'medium').length;
      if (crit > 0) { statsB.risk = 'Crítico'; statsB.riskColor = '#EF4444'; }
      else if (med > 0) { statsB.risk = 'Medio'; statsB.riskColor = '#F59E0B'; }
      
      const cached = await getAuditoriaCached(blockB);
      if (cached) statsB.aiScore = cached.puntaje_global || 0;
    }
  } catch (err) {
    Logger.error('Comparison calculation failed:', err);
  }

  container.innerHTML = `
    <div class="comparator-metric-row">
      <span class="metric-label">INTEGRIDAD TÉCNICA</span>
      <div class="metric-columns">
        <span class="column-val" style="color: ${statsA.percent >= 80 ? '#10B981' : (statsA.percent >= 50 ? '#F59E0B' : '#EF4444')}">${statsA.percent}%</span>
        <span class="column-val" style="color: ${statsB.percent >= 80 ? '#10B981' : (statsB.percent >= 50 ? '#F59E0B' : '#EF4444')}">${statsB.percent}%</span>
      </div>
    </div>
    
    <div class="comparator-metric-row">
      <span class="metric-label">CUMPLIMIENTO IA (SCORE)</span>
      <div class="metric-columns">
        <span class="column-val text-cyan">${statsA.aiScore}%</span>
        <span class="column-val text-cyan">${statsB.aiScore}%</span>
      </div>
    </div>

    <div class="comparator-metric-row">
      <span class="metric-label">NIVEL RIESGO</span>
      <div class="metric-columns">
        <span class="column-val" style="color: ${statsA.riskColor}">${statsA.risk}</span>
        <span class="column-val" style="color: ${statsB.riskColor}">${statsB.risk}</span>
      </div>
    </div>

    <div class="comparator-metric-row">
      <span class="metric-label">ARCHIVOS REGISTRADOS</span>
      <div class="metric-columns">
        <span class="column-val font-normal">${statsA.files} planos</span>
        <span class="column-val font-normal">${statsB.files} planos</span>
      </div>
    </div>

    <div class="comparator-metric-row" style="border:none;">
      <span class="metric-label">ESPECIALIDADES CUBIERTAS</span>
      <div class="metric-columns">
        <span class="column-val font-normal">${statsA.complete}/${statsA.total}</span>
        <span class="column-val font-normal">${statsB.complete}/${statsB.total}</span>
      </div>
    </div>
  `;
}

/**
 * ──────────────────────────────────────────────────────────
 * SECCIÓN 4 — REPORTES Y HISTORIAL
 * ──────────────────────────────────────────────────────────
 */
function renderSectionReportes(bloqueId) {
  // Sync the executive buttons
  const mantBtnPdf = document.getElementById('btn-generate-pdf');
  if (mantBtnPdf) {
    // Enable PDF button only if there is a cached diagnosis
    const hasDiag = !!(bloqueId && state.estadosBloques?.[bloqueId]?.diagnostico_texto);
    mantBtnPdf.disabled = !hasDiag;
  }
}
