/**
 * Módulo: Modal de Previsualización de Auditoría
 * ================================================
 * Muestra un modal elegante antes de generar el PDF con:
 * - Resumen ejecutivo IA
 * - Puntaje global
 * - Clones visuales de los gráficos del dashboard
 * 
 * Al confirmar, genera el PDF con los gráficos incrustados.
 */
import { state } from '../core/state.js';
import { getCampusData } from '../campus-data.js';
import { isAdmin } from '../services/auth.js';
import { Logger } from '../core/logger.js';

let modalEl = null;
let capturedChartImages = {};

/**
 * Captura todos los canvas de gráficos en el dashboard y los convierte a imagen.
 * @returns {Object} — { radarChart: dataUrl, ... }
 */
function captureChartImages() {
  const images = {};
  
  // Capturar radar chart de mantenimiento
  const radarCanvas = document.getElementById('mant-chart-radar');
  if (radarCanvas) {
    try {
      images.radarChart = radarCanvas.toDataURL('image/jpeg', 0.65);
    } catch (e) {
      Logger.warn('No se pudo capturar el radar chart:', e);
    }
  }

  // Capturar canvas 3D si existe
  const canvas3D = document.querySelector('#viewer-container canvas') || document.querySelector('canvas');
  if (canvas3D && canvas3D !== radarCanvas) {
    try {
      images.model3D = canvas3D.toDataURL('image/jpeg', 0.65);
    } catch (e) {
      Logger.warn('No se pudo capturar el Canvas 3D:', e);
    }
  }

  return images;
}

/**
 * Crea e inyecta el modal en el DOM si no existe.
 */
function ensureModalExists() {
  if (document.getElementById('audit-preview-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'audit-preview-modal';
  modal.className = 'audit-modal-backdrop';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="audit-modal-container">
      <div class="audit-modal-header">
        <div class="audit-modal-header-icon">
          <i class="ph ph-file-magnifying-glass"></i>
        </div>
        <div>
          <h2 class="audit-modal-title" id="audit-modal-title">Vista Previa de Auditoría</h2>
          <p class="audit-modal-subtitle">Revisa el contenido antes de generar el PDF</p>
        </div>
        <button class="audit-modal-close" id="audit-modal-close">
          <i class="ph ph-x"></i>
        </button>
      </div>

      <div class="audit-modal-body" id="audit-modal-body">
        <!-- Score badge -->
        <div class="audit-modal-score-section" id="audit-modal-score-section">
          <div class="audit-modal-score-circle" id="audit-modal-score-circle">
            <span id="audit-modal-score-value">0%</span>
          </div>
          <div class="audit-modal-score-label" id="audit-modal-score-label">Puntaje Global</div>
        </div>

        <!-- AI Summary -->
        <div class="audit-modal-section">
          <h4><i class="ph ph-brain"></i> Resumen Ejecutivo IA</h4>
          <div class="audit-modal-summary" id="audit-modal-summary">Sin resumen disponible.</div>
        </div>

        <!-- Chart Preview -->
        <div class="audit-modal-section" id="audit-modal-charts-section" style="display:none;">
          <h4><i class="ph ph-chart-polar"></i> Gráficos del Dashboard</h4>
          <div class="audit-modal-charts-grid" id="audit-modal-charts-grid"></div>
        </div>

        <!-- Normas summary -->
        <div class="audit-modal-section" id="audit-modal-normas-section" style="display:none;">
          <h4><i class="ph ph-shield-check"></i> Resumen Normativo</h4>
          <div class="audit-modal-normas" id="audit-modal-normas"></div>
        </div>
      </div>

      <div class="audit-modal-footer">
        <button class="audit-modal-btn audit-modal-btn-cancel" id="audit-modal-btn-cancel">
          <i class="ph ph-x-circle"></i> Cancelar
        </button>
        <button class="audit-modal-btn audit-modal-btn-confirm" id="audit-modal-btn-confirm">
          <i class="ph ph-file-pdf"></i> Confirmar y Generar PDF
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modalEl = modal;

  // Event listeners
  document.getElementById('audit-modal-close').addEventListener('click', closeModal);
  document.getElementById('audit-modal-btn-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

/**
 * Abre el modal de previsualización de auditoría.
 * @param {Function} onConfirm — Callback cuando el usuario confirma la generación del PDF
 */
export function openAuditPreviewModal(onConfirm) {
  if (!isAdmin()) return;

  const blockId = state.currentBlockId;
  if (!blockId) {
    alert('Por favor, selecciona un bloque en el mapa antes de generar el reporte.');
    return;
  }

  const campusData = getCampusData() || {};
  const blockName = campusData?.[blockId]?.name || blockId;
  const estadoData = state.estadosBloques?.[blockId] || {};

  ensureModalExists();
  const modal = document.getElementById('audit-preview-modal');

  // Capturar gráficos ANTES de abrir el modal
  capturedChartImages = captureChartImages();

  // Populate modal
  const titleEl = document.getElementById('audit-modal-title');
  titleEl.textContent = `Vista Previa de Auditoría: ${blockName}`;

  // Score
  const score = estadoData.score_infraestructura || 0;
  const scoreCircle = document.getElementById('audit-modal-score-circle');
  const scoreValue = document.getElementById('audit-modal-score-value');
  let scoreColor = '#EF4444';
  if (score >= 85) scoreColor = '#10B981';
  else if (score >= 60) scoreColor = '#F59E0B';
  
  scoreCircle.style.borderColor = scoreColor;
  scoreCircle.style.boxShadow = `0 0 30px ${scoreColor}40`;
  scoreValue.textContent = `${score}%`;
  scoreValue.style.color = scoreColor;

  // Summary
  const summaryEl = document.getElementById('audit-modal-summary');
  const textoIA = (estadoData.diagnostico_texto || 'Sin diagnóstico generado. Ejecute la auditoría primero.').replace(/[%!&🛡️⚠️]/g, '');
  summaryEl.innerHTML = textoIA;

  // Charts
  const chartsSection = document.getElementById('audit-modal-charts-section');
  const chartsGrid = document.getElementById('audit-modal-charts-grid');
  if (Object.keys(capturedChartImages).length > 0) {
    chartsSection.style.display = '';
    let chartsHtml = '';
    if (capturedChartImages.radarChart) {
      chartsHtml += `<div class="audit-modal-chart-item">
        <img src="${capturedChartImages.radarChart}" alt="Radar Chart" />
        <span>Evaluación Técnica</span>
      </div>`;
    }
    if (capturedChartImages.model3D) {
      chartsHtml += `<div class="audit-modal-chart-item">
        <img src="${capturedChartImages.model3D}" alt="Modelo 3D" />
        <span>Vista 3D del Bloque</span>
      </div>`;
    }
    chartsGrid.innerHTML = chartsHtml;
  } else {
    chartsSection.style.display = 'none';
  }

  // Normas
  const normasSection = document.getElementById('audit-modal-normas-section');
  const normasEl = document.getElementById('audit-modal-normas');
  if (estadoData.normas && Object.keys(estadoData.normas).length > 0) {
    normasSection.style.display = '';
    let normasHtml = '';
    Object.entries(estadoData.normas).forEach(([norma, data]) => {
      const puntaje = data.puntaje || 0;
      let barColor = '#EF4444';
      if (puntaje >= 85) barColor = '#10B981';
      else if (puntaje >= 60) barColor = '#F59E0B';
      normasHtml += `
        <div class="audit-modal-norma-row">
          <span class="audit-modal-norma-name">${norma}</span>
          <div class="audit-modal-norma-bar">
            <div class="audit-modal-norma-bar-fill" style="width:${puntaje}%;background:${barColor}"></div>
          </div>
          <span class="audit-modal-norma-score" style="color:${barColor}">${puntaje}%</span>
        </div>
      `;
    });
    normasEl.innerHTML = normasHtml;
  } else {
    normasSection.style.display = 'none';
  }

  // Confirm button
  const confirmBtn = document.getElementById('audit-modal-btn-confirm');
  const newConfirm = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
  newConfirm.addEventListener('click', () => {
    closeModal();
    onConfirm?.(capturedChartImages);
  });

  // Show modal with animation
  modal.style.display = 'flex';
  requestAnimationFrame(() => {
    modal.classList.add('audit-modal-visible');
  });
}

/**
 * Cierra el modal.
 */
function closeModal() {
  const modal = document.getElementById('audit-preview-modal');
  if (!modal) return;
  modal.classList.remove('audit-modal-visible');
  setTimeout(() => {
    modal.style.display = 'none';
  }, 300);
}

/**
 * Obtiene las imágenes capturadas de los gráficos.
 * @returns {Object}
 */
export function getCapturedChartImages() {
  return capturedChartImages;
}
