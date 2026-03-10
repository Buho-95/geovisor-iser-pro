/**
 * Bootstrap: inicializa la app con lazy loading de módulos opcionales.
 */
import { state } from './core/state.js';
import { initAuth } from './services/auth.js';
import { startArchivosSync } from './services/firestore.js';
import { init as initLayerManager } from './plugins/layer-manager.js';
import {
  initLeafletMap,
  getMap,
  getPerimetroPolygon,
  highlightBlock,
  resetBlockStyles,
  setGetCurrentBlockId
} from './map.js';
import {
  initGlobalView,
  showBlockView,
  generarArbolDirectorios,
  setupViewerDelegation,
  openBlockEditModal,
  closeBlockEditModal,
  saveBlockInfo
} from './ui.js';
import { openViewer, setupVisorButtons } from './visor.js';
import { setupUpload } from './upload.js';
import { initFileManager, getFileManager } from './file-manager.js';
import { estructuraPlanimetriaISER } from './planoteca-structure.js';

function doSelectBlock(id) {
  state.currentBlockId = id;
  highlightBlock(id, state.currentBlockId);
  showBlockView(id, (blockId) => state.archivosNube?.filter(a => a.bloque === blockId) || []);

  // Update upload modal block name
  const blockNameEl = document.getElementById('upload-block-name');
  if (blockNameEl) {
    const campusData = (window.__campusDataCache) || {};
    blockNameEl.textContent = campusData[id]?.name || id;
  }

  // Show upload button for admins
  if (state.userRole === 'admin') {
    document.getElementById('btn-open-upload')?.classList.remove('hidden');
  }
}

function doInitGlobalView() {
  state.currentBlockId = null;
  resetBlockStyles();
  initGlobalView(doSelectBlock);
}

export async function bootstrap() {
  initLayerManager();
  setGetCurrentBlockId(() => state.currentBlockId);

  initLeafletMap(doSelectBlock);

  // Cache campus data for upload modal
  try {
    const { getCampusData } = await import('./campus-data.js');
    window.__campusDataCache = getCampusData();
  } catch (e) { /* ignore */ }

  initAuth({
    onLoginSuccess() {
      // Populate global block list
      doInitGlobalView();

      setTimeout(() => {
        const mapInstance = getMap();
        const perimetro = getPerimetroPolygon();
        if (mapInstance && perimetro) {
          mapInstance.invalidateSize();
          mapInstance.fitBounds(perimetro.getBounds());
        }
      }, 500);
    },
    onAuthChange(u) {
      // Start Firestore sync for both visitor and admin (read-only is fine)
      startArchivosSync(() => {
        if (state.currentBlockId) {
          showBlockView(state.currentBlockId, (blockId) => state.archivosNube?.filter(a => a.bloque === blockId) || []);
        }
      });
    }
  });

  document.getElementById('reset-map-btn')?.addEventListener('click', () => {
    const mapInstance = getMap();
    const perimetro = getPerimetroPolygon();
    if (mapInstance && perimetro) {
      mapInstance.flyToBounds(perimetro.getBounds(), { padding: [20, 20], duration: 1 });
    }
    doInitGlobalView();
  });

  document.getElementById('btn-volver')?.addEventListener('click', doInitGlobalView);

  const arbolContainer = document.getElementById('arbol-carpetas-iser');
  if (arbolContainer) setupViewerDelegation(arbolContainer, openViewer);

  setupVisorButtons();
  setupUpload();

  // Inicializar el gestor de archivos mejorado
  initFileManager();
  // Exponer globalmente para que ui.js pueda usarlo
  window.getFileManager = () => getFileManager();

  // Event listeners para el modal de edición de bloques
  document.getElementById('btn-edit-block')?.addEventListener('click', () => {
    if (state.currentBlockId && state.userRole === 'admin') {
      openBlockEditModal(state.currentBlockId);
    }
  });

  document.getElementById('btn-cerrar-block-edit')?.addEventListener('click', closeBlockEditModal);
  document.getElementById('btn-cancel-block-edit')?.addEventListener('click', closeBlockEditModal);

  // Formulario de edición de bloque
  document.getElementById('block-edit-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = {
      area: document.getElementById('edit-block-area').value,
      rooms: document.getElementById('edit-block-rooms').value,
      construction: document.getElementById('edit-block-construction').value,
      roof: document.getElementById('edit-block-roof').value
    };

    if (saveBlockInfo(formData)) {
      closeBlockEditModal();
    }
  });

  // Cerrar modal al hacer clic fuera
  document.getElementById('block-edit-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'block-edit-modal') {
      closeBlockEditModal();
    }
  });

  // ─── Panel Tabs (Visor / Base de Datos / Dashboard) ───
  document.querySelectorAll('.panel-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;

      // Update tab active states
      document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show corresponding panel
      document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
      const target = document.getElementById(`panel-${panel}`);
      if (target) target.classList.add('active');
    });
  });

  // Lazy load: Dashboard
  if (document.getElementById('dashboard-container')) {
    try {
      const { initDashboardPro } = await import('./dashboard.js?v=dashboard-pro-2');
      initDashboardPro();
    } catch (e) {
      console.error('❌ Error cargando Dashboard Pro:', e);
      const el = document.getElementById('dashboard-container');
      if (el) {
        el.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:0.85rem;">No se pudo cargar el Dashboard.</div>';
      }
    }
  }
}
