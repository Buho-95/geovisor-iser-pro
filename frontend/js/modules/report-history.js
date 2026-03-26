/**
 * Módulo: Historial de Reportes
 * ================================
 * Renderiza una sección de historial de auditorías generadas.
 * - Lista cronológica de reportes PDF
 * - Botón Descargar (admin-only): abre PDF en nueva pestaña
 * - Botón Eliminar (admin-only): confirmación + borrado Firestore + Storage
 * - Carga diferida (lazy loading)
 */
import { getReportHistory, deleteReport } from '../services/firestore.js';
import { isAdmin } from '../services/auth.js';
import { Logger } from '../core/logger.js';

let isLoaded = false;
let reportsList = [];

/**
 * Inicializa y renderiza la sección de historial de reportes.
 */
export async function initReportHistory() {
  const container = document.getElementById('report-history-container');
  if (!container) return;

  // Render shell
  container.innerHTML = `
    <div class="report-history-section">
      <div class="report-history-header">
        <div class="report-history-header-icon">
          <i class="ph ph-clock-counter-clockwise"></i>
        </div>
        <div>
          <h3 class="report-history-title">Historial de Reportes</h3>
          <p class="report-history-subtitle">Auditorías PDF generadas</p>
        </div>
        <button type="button" id="btn-refresh-history" class="report-history-refresh-btn" title="Actualizar historial">
          <i class="ph ph-arrows-clockwise"></i>
        </button>
      </div>
      <div id="report-history-list" class="report-history-list">
        <div class="report-history-loading">
          <i class="ph ph-spinner animate-spin"></i>
          <span>Cargando historial...</span>
        </div>
      </div>
    </div>
  `;

  // Load data lazily
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !isLoaded) {
        loadHistory();
        observer.disconnect();
      }
    });
  }, { threshold: 0.1 });

  observer.observe(container);

  // Refresh button
  document.getElementById('btn-refresh-history')?.addEventListener('click', () => {
    isLoaded = false;
    loadHistory();
  });
}

/**
 * Carga el historial de reportes desde Firestore.
 */
async function loadHistory() {
  const listEl = document.getElementById('report-history-list');
  if (!listEl) return;

  listEl.innerHTML = `
    <div class="report-history-loading">
      <i class="ph ph-spinner animate-spin"></i>
      <span>Cargando historial...</span>
    </div>
  `;

  try {
    reportsList = await getReportHistory();
    isLoaded = true;
    renderList(listEl);
  } catch (err) {
    Logger.error('Error cargando historial:', err);
    listEl.innerHTML = `
      <div class="report-history-empty">
        <i class="ph ph-warning-circle"></i>
        <span>Error al cargar el historial. Intenta de nuevo.</span>
      </div>
    `;
  }
}

/**
 * Renderiza la lista de reportes.
 */
function renderList(listEl) {
  if (!reportsList || reportsList.length === 0) {
    listEl.innerHTML = `
      <div class="report-history-empty">
        <i class="ph ph-folder-dashed"></i>
        <span>No hay reportes generados aún.</span>
      </div>
    `;
    return;
  }

  const userIsAdmin = isAdmin();

  listEl.innerHTML = reportsList.map(report => {
    const fecha = report.fecha
      ? new Date(report.fecha).toLocaleString('es-CO', { 
          year: 'numeric', month: 'short', day: 'numeric', 
          hour: '2-digit', minute: '2-digit' 
        })
      : 'Fecha desconocida';

    const blockName = report.blockName || report.blockId || 'Bloque desconocido';
    const userEmail = report.userEmail || 'Usuario desconocido';

    return `
      <div class="report-history-item" data-report-id="${report.id}">
        <div class="report-history-item-icon">
          <i class="ph ph-file-pdf"></i>
        </div>
        <div class="report-history-item-info">
          <span class="report-history-item-name">${blockName}</span>
          <span class="report-history-item-meta">
            <i class="ph ph-calendar-blank"></i> ${fecha}
            <span class="report-history-item-user">
              <i class="ph ph-user"></i> ${userEmail.split('@')[0]}
            </span>
          </span>
        </div>
        <div class="report-history-item-actions">
          ${userIsAdmin ? `
            <button class="report-history-btn report-history-btn-download admin-only" 
                    data-url="${report.downloadUrl}" title="Descargar PDF">
              <i class="ph ph-download-simple"></i>
            </button>
            <button class="report-history-btn report-history-btn-delete admin-only" 
                    data-report-id="${report.id}" 
                    data-storage-path="${report.storagePath || ''}" 
                    data-block-name="${blockName}"
                    title="Eliminar reporte">
              <i class="ph ph-trash"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Wire event listeners via delegation
  listEl.addEventListener('click', handleListClick);
}

/**
 * Maneja clics en la lista de reportes (event delegation).
 */
async function handleListClick(e) {
  // Download
  const downloadBtn = e.target.closest('.report-history-btn-download');
  if (downloadBtn) {
    const url = downloadBtn.dataset.url;
    if (url) {
      window.open(url, '_blank');
    }
    return;
  }

  // Delete
  const deleteBtn = e.target.closest('.report-history-btn-delete');
  if (deleteBtn) {
    const reportId = deleteBtn.dataset.reportId;
    const storagePath = deleteBtn.dataset.storagePath;
    const blockName = deleteBtn.dataset.blockName;

    const confirmed = confirm(
      `¿Estás seguro de eliminar el reporte de "${blockName}"?\n\nEsta acción eliminará el archivo PDF y el registro del historial permanentemente.`
    );

    if (!confirmed) return;

    // Disable button and show loading
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<i class="ph ph-spinner animate-spin"></i>';

    try {
      await deleteReport(reportId, storagePath);
      Logger.info(`Reporte ${reportId} eliminado correctamente.`);
      
      // Remove from DOM with animation
      const item = deleteBtn.closest('.report-history-item');
      if (item) {
        item.style.transition = 'all 0.3s ease';
        item.style.opacity = '0';
        item.style.transform = 'translateX(20px)';
        setTimeout(() => {
          item.remove();
          // Check if list is now empty
          const listEl = document.getElementById('report-history-list');
          if (listEl && listEl.children.length === 0) {
            listEl.innerHTML = `
              <div class="report-history-empty">
                <i class="ph ph-folder-dashed"></i>
                <span>No hay reportes generados aún.</span>
              </div>
            `;
          }
        }, 300);
      }

      // Update local array
      reportsList = reportsList.filter(r => r.id !== reportId);
    } catch (err) {
      Logger.error('Error eliminando reporte:', err);
      alert('Error al eliminar el reporte. Intenta de nuevo.');
      deleteBtn.disabled = false;
      deleteBtn.innerHTML = '<i class="ph ph-trash"></i>';
    }
  }
}

/**
 * Fuerza la recarga del historial (llamada después de generar nuevo reporte).
 */
export function refreshHistory() {
  isLoaded = false;
  loadHistory();
}
