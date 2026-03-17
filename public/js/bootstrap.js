/**
 * Bootstrap: inicializa la app con lazy loading de módulos opcionales.
 */
import { state, setSede } from './core/state.js';
import { initAuth } from './services/auth.js';
import { startArchivosSync } from './services/firestore.js';
import { init as initLayerManager } from './plugins/layer-manager.js';
import {
  initLeafletMap,
  getMap,
  getPerimetroPolygon,
  highlightBlock,
  resetBlockStyles,
  setGetCurrentBlockId,
  switchSede
} from './map.js';
import {
  initGlobalView,
  showBlockView,
  generarArbolDirectorios,
  setupViewerDelegation,
  setupDeleteDelegation,
  openBlockEditModal,
  closeBlockEditModal,
  saveBlockInfo
} from './ui.js';
import { openViewer, setupVisorButtons, setVisorFileList } from './visor.js';
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

  // ─── Sede Selector: Multi-Campus (Top Nav Bar) ───
  const sedeSelector = document.getElementById('top-nav-sede-selector');
  if (sedeSelector) {
    sedeSelector.addEventListener('change', (e) => {
      const nuevaSede = e.target.value;
      setSede(nuevaSede);
      console.log(`🏛️ Sede cambiada a: ${nuevaSede}`);

      // 🗺️ Cambiar vista del mapa con flyTo + polígonos
      switchSede(nuevaSede);

      // Limpiar panel y volver a vista global
      doInitGlobalView();

      // Asegurar que el módulo MAPA esté activo al cambiar sede
      activateModule('mapa');
    });
  }

  // ─── Top Nav: Module Switching ([MAPA] | [MANTENIMIENTO] | [DASHBOARD]) ───
  function activateModule(moduleId) {
    // Update nav buttons
    document.querySelectorAll('.top-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.module === moduleId);
    });

    // Module view visibility
    const appMain = document.querySelector('.app-main');
    const panelTabs = document.querySelector('.panel-tabs');

    if (moduleId === 'mapa') {
      // Show the full 60/40 layout — activate the Visor panel tab
      if (appMain) appMain.style.display = '';
      if (panelTabs) panelTabs.style.display = '';
      // Activate Visor tab
      document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-panel="visor"]')?.classList.add('active');
      document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
      document.getElementById('panel-visor')?.classList.add('active');
    } else if (moduleId === 'mantenimiento') {
      // 🔐 Guard: Solo admins pueden acceder al módulo de Mantenimiento
      if (state.userRole !== 'admin') {
        if (appMain) appMain.style.display = '';
        if (panelTabs) panelTabs.style.display = '';
        document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
        const mantPanel = document.getElementById('panel-mantenimiento');
        if (mantPanel) {
          mantPanel.classList.add('active');
          mantPanel.innerHTML = `
            <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
              <div style="text-align:center;max-width:340px;">
                <i class="ph ph-lock-key" style="font-size:3.5rem;color:var(--danger);display:block;margin-bottom:1rem;"></i>
                <h3 style="font-size:1.1rem;font-weight:700;color:var(--text-heading);margin:0 0 0.5rem;">Acceso Denegado</h3>
                <p style="font-size:0.82rem;color:var(--text-muted);line-height:1.6;margin:0 0 1.25rem;">
                  Esta función es exclusiva para administradores autorizados.
                </p>
                <button type="button" id="mant-denied-back" style="
                  padding:10px 24px;background:linear-gradient(135deg,var(--cyan),#1B5E20);color:white;
                  border:none;border-radius:var(--radius-md);font-weight:700;font-size:0.8rem;cursor:pointer;
                  display:inline-flex;align-items:center;gap:6px;
                "><i class="ph ph-arrow-left"></i> Volver al Mapa</button>
              </div>
            </div>`;
          document.getElementById('mant-denied-back')?.addEventListener('click', () => activateModule('mapa'));
        }
        return;
      }
      // Show the full layout but activate Mantenimiento panel
      if (appMain) appMain.style.display = '';
      if (panelTabs) panelTabs.style.display = '';
      document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
      document.getElementById('panel-mantenimiento')?.classList.add('active');
    } else if (moduleId === 'dashboard') {
      // Show the full layout but activate Dashboard panel tab
      if (appMain) appMain.style.display = '';
      if (panelTabs) panelTabs.style.display = '';
      document.querySelectorAll('.panel-tab').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-panel="dashboard"]')?.classList.add('active');
      document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
      document.getElementById('panel-dashboard')?.classList.add('active');
    }
  }

  document.querySelectorAll('.top-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const moduleId = btn.dataset.module;
      if (moduleId) activateModule(moduleId);
    });
  });

  document.getElementById('btn-volver')?.addEventListener('click', doInitGlobalView);

  const arbolContainer = document.getElementById('arbol-carpetas-iser');
  if (arbolContainer) {
    setupViewerDelegation(arbolContainer, openViewer, setVisorFileList);
    setupDeleteDelegation(arbolContainer);
  }

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

  // Lazy load: Mantenimiento Module
  if (document.getElementById('mant-form')) {
    try {
      const { initMantenimiento } = await import('./mantenimiento.js');
      initMantenimiento();
    } catch (e) {
      console.error('❌ Error cargando Módulo de Mantenimiento:', e);
    }
  }

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
