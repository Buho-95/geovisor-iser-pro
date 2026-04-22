/**
 * Bootstrap: inicializa la app con lazy loading de módulos opcionales.
 */
import { Logger } from './core/logger.js';
import { state, setSede, setCurrentBlock } from './core/state.js';
import { initAuth } from './services/auth.js';
import { initArchivosSubscription, startEstadosBloquesSync } from './services/firestore.js';
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
import { isStaging } from './core/env.js';
import {
  setSede as setUiSede,
  setBloque as setUiBloque,
  hydrateFromLegacy as hydrateUiState,
} from './core/ui-state.js';
import { mountSedeSwitcher } from './components/sede-switcher.js';

function doSelectBlock(id) {
  setCurrentBlock(id);
  highlightBlock(id, state.currentBlockId);
  showBlockView(id, (blockId) => state.archivosNube?.filter(a => a.bloque === blockId) || []);

  // Propagar a ui-state (nuevo estado reactivo). El árbol de Base de Datos
  // escucha este evento para auto-expandir el bloque correspondiente.
  try { setUiBloque(id); } catch { /* no-op */ }

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
  let unsubArchivos = null;
  let unsubEstados = null;
  let dataStreamsStarted = false;

  initLayerManager();
  setGetCurrentBlockId(() => state.currentBlockId);

  initLeafletMap(doSelectBlock);

  // ─── Montar Sede Switcher (pill overlay sobre el mapa) ───
  // En staging ocultamos el selector legacy del top-nav para evitar duplicados.
  try {
    await hydrateUiState();
    const mapColumn = document.querySelector('.map-column');
    if (mapColumn) {
      mountSedeSwitcher(mapColumn, { initial: state?.currentSede || 'pamplona' });
    }
    if (isStaging) {
      const legacyWrap = document.querySelector('[data-role="legacy-sede-selector"]');
      if (legacyWrap) legacyWrap.style.display = 'none';
    }
  } catch (err) {
    Logger.warn?.('[bootstrap] No se pudo montar sede-switcher:', err);
  }

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
      if (!u) {
        if (unsubArchivos) { unsubArchivos(); unsubArchivos = null; }
        if (unsubEstados) { unsubEstados(); unsubEstados = null; }
        dataStreamsStarted = false;
        return;
      }
      if (dataStreamsStarted) return;
      dataStreamsStarted = true;

      unsubArchivos = initArchivosSubscription(() => {
        if (state.currentBlockId) {
          showBlockView(state.currentBlockId, (blockId) => state.archivosNube?.filter(a => a.bloque === blockId) || []);
        }
      });
      unsubEstados = startEstadosBloquesSync();
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
      // Propagar al estado UI reactivo (reset bloque + emit sede-changed).
      try { setUiSede(nuevaSede); } catch { /* no-op */ }
      Logger.info(`🏛️ Sede cambiada a: ${nuevaSede}`);

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

      // En STAGING: al entrar a "Base de Datos" montamos el árbol canónico (PDF).
      if (panel === 'planoteca' && isStaging) {
        mountStagingStructureTreeLazy();
      }
    });
  });

  // Monta el árbol staging en el panel planoteca (reutilizando contenedores existentes).
  // Aparece ENCIMA de la vista global heredada para no romper el flujo de producción.
  async function mountStagingStructureTreeLazy() {
    if (!isStaging) return;
    const panel = document.getElementById('panel-planoteca');
    if (!panel) return;
    let host = panel.querySelector('#staging-tree-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'staging-tree-host';
      host.style.cssText = 'border-bottom:1px solid var(--border-subtle, #2a3240); margin-bottom:8px;';
      panel.insertBefore(host, panel.firstChild);
    }
    if (host.dataset.mounted === 'true') return;
    try {
      const [{ mountStructureTree, injectStructureTreeStyles }] = await Promise.all([
        import('./modules/structure-tree.js'),
      ]);
      injectStructureTreeStyles();
      await mountStructureTree(host, { sedeId: state?.currentSede || 'pamplona' });
      host.dataset.mounted = 'true';
    } catch (err) {
      Logger.error('❌ [staging] Error montando árbol canónico:', err);
    }
  }

  // Escuchar selección de ruta desde el árbol staging → pre-cargar upload.
  document.addEventListener('geovisor:structure-path-selected', (e) => {
    const { sedeId, path } = e.detail || {};
    Logger.info(`[staging] Ruta seleccionada en árbol: ${sedeId}/${path}`);
    // path es "bloqueId/disciplina/..." o "nivelSedeFolder/..."
    const parts = String(path).split('/');
    const [bloqueOrSede, ...rest] = parts;
    // Si el primer segmento es un bloque (existe en campusData.mapBlockId o en schema.bloques),
    // tratarlo como selección de bloque. Si no, informativo.
    if (state?.currentBlockId && rest.length >= 1) {
      // Pre-cargar campo carpeta y abrir modal si el usuario es admin
      const hidden = document.getElementById('up-folder');
      if (hidden) hidden.value = rest.join('/');
      const btn = document.getElementById('btn-open-upload');
      if (btn && state.userRole === 'admin') {
        const fm = getFileManager();
        fm?.showNotification(`Ruta pre-cargada: ${rest.join('/')}`, 'info');
      }
    } else {
      const fm = getFileManager();
      fm?.showNotification(`Selecciona primero un bloque en el mapa para subir aquí.`, 'warning');
    }
  });

  // Si estamos en staging y la pestaña inicial ya es Base de Datos, montar inmediatamente.
  if (isStaging) {
    const initialTab = document.querySelector('.panel-tab.active')?.dataset.panel;
    if (initialTab === 'planoteca') mountStagingStructureTreeLazy();
    // Al cambiar de sede (selector legacy o pill switcher), refrescar el árbol.
    const refreshTreeOnSede = () => {
      const host = document.getElementById('staging-tree-host');
      if (host) host.dataset.mounted = 'false';
      if (document.getElementById('panel-planoteca')?.classList.contains('active')) {
        mountStagingStructureTreeLazy();
      }
    };
    document.getElementById('top-nav-sede-selector')?.addEventListener('change', refreshTreeOnSede);
    document.addEventListener('geovisor:sede-changed', refreshTreeOnSede);
  }

  // Lazy load: Mantenimiento Module
  if (document.getElementById('btn-generate-pdf')) {
    try {
      await import('./mantenimiento.js');
      if (typeof window.initMantenimiento === 'function') {
        window.initMantenimiento();
      }
    } catch (e) {
      Logger.error('❌ Error cargando Módulo de Mantenimiento:', e);
    }
  }

  // Lazy load: Dashboard
  if (document.getElementById('dashboard-container')) {
    try {
      const { initDashboardPro } = await import('./dashboard.js?v=dashboard-pro-2');
      initDashboardPro();
    } catch (e) {
      Logger.error('❌ Error cargando Dashboard Pro:', e);
      const el = document.getElementById('dashboard-container');
      if (el) {
        el.textContent = '';
        const d = document.createElement('div');
        d.style.cssText = 'padding:16px;color:var(--text-muted);font-size:0.85rem;';
        d.textContent = 'No se pudo cargar el Dashboard.';
        el.appendChild(d);
      }
    }
  }

  // Lazy load: Auditoría Normativa (Fase 2 - Dashboard)
  try {
    const { initAuditoriaNormativa } = await import('./auditoria-normativa.js');
    initAuditoriaNormativa();
  } catch (e) {
    Logger.error('❌ Error cargando Módulo de Auditoría Normativa:', e);
  }

  // Lazy load: Report History module
  if (document.getElementById('report-history-container')) {
    try {
      const { initReportHistory } = await import('./modules/report-history.js');
      initReportHistory();
    } catch (e) {
      Logger.error('❌ Error cargando Módulo de Historial de Reportes:', e);
    }
  }

  // ═══════════════════════════════════════════════════════

  // ⌨️ GLOBAL ESC KEY — Closes whichever modal is open (priority order)
  // Visor modal Esc is already handled in visor.js; this covers the rest.
  // ═══════════════════════════════════════════════════════
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    // 1. Confirm delete modal (highest priority)
    const confirmModal = document.getElementById('confirm-delete-modal');
    if (confirmModal?.classList.contains('activo')) {
      document.getElementById('confirm-delete-cancel')?.click();
      return;
    }

    // 2. Upload modal
    const uploadModal = document.getElementById('upload-modal');
    if (uploadModal?.classList.contains('activo')) {
      document.getElementById('btn-cerrar-upload')?.click();
      return;
    }

    // 3. Block edit modal
    const blockEditModal = document.getElementById('block-edit-modal');
    if (blockEditModal?.classList.contains('activo')) {
      closeBlockEditModal();
      return;
    }

    // 4. Audit preview modal
    const auditPreview = document.getElementById('audit-preview-modal');
    if (auditPreview && auditPreview.style.display !== 'none') {
      document.getElementById('audit-modal-close')?.click();
      return;
    }
  });
}
