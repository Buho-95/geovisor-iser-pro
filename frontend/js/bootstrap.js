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
  openBlockEditModal,
  closeBlockEditModal,
  saveBlockInfo
} from './ui.js';
import { setupVisorButtons } from './visor.js';
import { setupUpload } from './upload.js';
import { initFileManager, getFileManager } from './file-manager.js';
// estructuraPlanimetriaISER ya no se usa aquí — `dashboard.js` y `upload.js`
// la importan directamente cuando lo necesitan. La UI de planoteca legacy fue
// reemplazada por el explorador real (components/file-explorer.js).
import {
  setSede as setUiSede,
  setBloque as setUiBloque,
  hydrateFromLegacy as hydrateUiState,
} from './core/ui-state.js';
import { mountSedeSwitcher } from './components/sede-switcher.js';
import { mountSedeSwitcherFab } from './components/sede-switcher-fab.js';
import { mountFileExplorer } from './components/file-explorer.js';
import { mountBlockContentView } from './modules/block-content-view.js';
import { renderDashboard, invalidateRiskSnapshot } from './modules/dashboard-view.js';
import { clearAuditCache } from './modules/dashboard-engine.js';

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

  // ─── Sede Switcher (pill overlay sobre el mapa) + FAB de toggle ───
  // El top-nav ya no existe, así que el switcher pill + el FAB son la única UI de sede.
  try {
    await hydrateUiState();
    const mapColumn = document.querySelector('.map-column');
    if (mapColumn) {
      mountSedeSwitcher(mapColumn, { initial: state?.currentSede || 'pamplona' });
      mountSedeSwitcherFab(mapColumn);
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

  // Top-nav eliminado: la única navegación es .panel-tabs y el sede-switcher
  // del mapa (pill + FAB). El antiguo selector `#top-nav-sede-selector` ya no
  // existe en el DOM; los listeners con `?.` son no-op si alguien lo busca.
  // El botón "Volver" pertenecía a la planoteca legacy (oculta).
  document.getElementById('btn-volver')?.addEventListener('click', doInitGlobalView);

  // Reaccionar a cambios de sede vía ui-state (pill switcher) → sincronizar mapa + panel.
  document.addEventListener('geovisor:sede-changed', (e) => {
    const nuevaSede = e.detail?.sede;
    if (!nuevaSede) return;
    try { setSede(nuevaSede); } catch { /* no-op */ }
    Logger.info(`🏛️ Sede cambiada a: ${nuevaSede}`);
    try { switchSede(nuevaSede); } catch (err) { Logger.warn?.('switchSede falló:', err); }
    doInitGlobalView();
  });

  // ─── Puente UI → legacy: cuando un chip de bloque (o cualquier otro
  // emisor de ui-state) selecciona un bloque, propagamos al flujo legacy
  // (highlight mapa + showBlockView) sin crear loop: doSelectBlock llama
  // setUiBloque, pero ui-state hace no-op si el bloque ya es el actual.
  document.addEventListener('geovisor:bloque-selected', (e) => {
    const bloqueId = e.detail?.bloque;
    if (!bloqueId) return;
    if (state.currentBlockId === bloqueId) return; // ya sincronizado
    try { doSelectBlock(bloqueId); }
    catch (err) { Logger.warn?.('[bootstrap] doSelectBlock desde chip falló:', err); }
  });

  // El árbol legacy `#arbol-carpetas-iser` fue eliminado; las delegaciones
  // de visor/delete ahora viven en file-explorer.js.

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

  // ─── Dashboard Inteligente: monta el dashboard real (engine + view).
  //    Limpia el host y renderiza en `#dashboard-audit-root` interno.
  function mountDashboard() {
    const host = document.getElementById('dashboard-container');
    if (!host) return;
    const sedeId = state?.currentSede || window.currentSedeId || 'pamplona';
    try {
      renderDashboard({ sedeId, mountEl: host });
    } catch (err) {
      Logger.error('❌ Error montando Dashboard Inteligente:', err);
    }
  }

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

      // Al entrar a "Base de Datos" montamos el explorador real (árbol + archivos).
      if (panel === 'planoteca') {
        mountBaseDatosExplorerLazy();
      }
      // Al entrar a "Dashboard" corremos la auditoría real contra Storage.
      if (panel === 'dashboard') {
        mountDashboard();
      }
    });
  });

  // Monta el explorador de Base de Datos: árbol jerárquico (schema v3) + panel de archivos
  // que reacciona a la selección de carpeta.
  // Idempotente: re-mountea siempre el file-explorer (es barato y garantiza estilos);
  // el árbol sólo se reconstruye si falta o si cambió la sede.
  async function mountBaseDatosExplorerLazy({ force = false } = {}) {
    const panel = document.getElementById('panel-planoteca');
    if (!panel) return;
    const treeHost = panel.querySelector('#explorer-tree-host');
    const filesHost = panel.querySelector('#explorer-files-host');
    if (!treeHost || !filesHost) return;

    // 1) Garantizar el panel de archivos. Siempre se monta primero: engancha
    //    listeners globales (`geovisor:structure-path-selected`) sobre document
    //    pero NO toca el innerHTML del host si ya tiene contenido — por eso el
    //    block-content-view que pintamos a continuación sobrevive al montaje.
    try { mountFileExplorer(filesHost); }
    catch (err) { Logger.error('[explorer] Error montando file-explorer:', err); }

    // 2) Block content view: toma el host y pinta el estado actual
    //    ("Selecciona un bloque…" o la estructura del bloque seleccionado).
    //    Escucha BLOQUE_SELECTED / SEDE_CHANGED y sobrescribe el host
    //    exactamente cuando corresponde.
    try { mountBlockContentView(filesHost); }
    catch (err) { Logger.error('[explorer] Error montando block-content-view:', err); }

    // 3) Árbol izquierdo (nivel sede + chips de bloques): sólo se reconstruye
    //    si no está montado o se fuerza (cambio de sede).
    if (!force && treeHost.dataset.mounted === 'true') return;
    try {
      const { mountStructureTree, injectStructureTreeStyles } = await import('./modules/structure-tree.js');
      injectStructureTreeStyles();
      treeHost.innerHTML = ''; // limpiar antes de remount
      treeHost.dataset.uiListeners = ''; // permitir re-wire
      await mountStructureTree(treeHost, { sedeId: state?.currentSede || 'pamplona' });
      treeHost.dataset.mounted = 'true';
    } catch (err) {
      Logger.error('❌ Error montando explorador de Base de Datos:', err);
    }
  }

  // Si la pestaña inicial es Base de Datos, montar inmediatamente.
  const initialTab = document.querySelector('.panel-tab.active')?.dataset.panel;
  if (initialTab === 'planoteca') mountBaseDatosExplorerLazy();
  if (initialTab === 'dashboard') mountDashboard();

  // Refrescar árbol al cambiar de sede (sede-switcher → ui-state → evento global).
  document.addEventListener('geovisor:sede-changed', () => {
    const host = document.getElementById('explorer-tree-host');
    if (host) host.dataset.mounted = 'false';
    if (document.getElementById('panel-planoteca')?.classList.contains('active')) {
      mountBaseDatosExplorerLazy({ force: true });
    }
  });

  // ─── Dashboard: invalidar caché y re-auditar al cambiar de sede.
  //    La caché de listAll() por path vive en dashboard-engine; al cambiar
  //    de sede el universo de paths cambia, así que la vaciamos.
  document.addEventListener('geovisor:sede-changed', () => {
    clearAuditCache();
    invalidateRiskSnapshot(); // fuerza re-emisión de eventos de riesgo en la nueva sede
    if (document.getElementById('panel-dashboard')?.classList.contains('active')) {
      mountDashboard();
    }
  });

  // ─── Dashboard: invalidar caché cuando se sube o elimina un archivo.
  //    El dashboard refleja cambios sin recarga de página. Si la tab
  //    dashboard está activa, re-pinta; si no, la próxima vez que se
  //    abra tomará los datos frescos.
  const invalidateAndMaybeRemount = () => {
    clearAuditCache();
    invalidateRiskSnapshot(); // el snapshot puede no variar a nivel %, pero un
                              // upload puede desbloquear un bloque crítico.
    if (document.getElementById('panel-dashboard')?.classList.contains('active')) {
      mountDashboard();
    }
  };
  window.addEventListener('geovisor:file-uploaded', invalidateAndMaybeRemount);
  window.addEventListener('geovisor:file-deleted',  invalidateAndMaybeRemount);
  document.addEventListener('geovisor:file-uploaded', invalidateAndMaybeRemount);
  document.addEventListener('geovisor:file-deleted',  invalidateAndMaybeRemount);

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

  // Dashboard Pro legacy: desactivado. Reemplazado por el Dashboard
  // Inteligente (engine + view) que audita completitud real contra
  // Firebase Storage y se monta al activar la tab o al cambiar sede.
  // El módulo `dashboard.js` sigue disponible por si se quiere revertir;
  // sólo se quitó la llamada automática para evitar doble render en el
  // mismo `#dashboard-container`.

  // ─── Pre-carga del Dashboard Inteligente (acotada) ─────────────
  // Dos segundos después del arranque (el usuario todavía está leyendo el
  // mapa) lanzamos una auditoría PARCIAL en background para:
  //   • calentar la caché de listAll() del engine,
  //   • resolver lazy-imports / JIT del renderDashboard,
  //   • pre-cargar esBloqueConLaboratorio y el schema en memoria.
  //
  // Optimización: en vez de auditar toda la sede (N bloques), precargamos
  // sólo los primeros PRELOAD_TOP_N bloques del schema. Son los que el
  // usuario ve primero al abrir la pestaña (la grid respeta el orden).
  // Beneficio: mismo efecto UX, menos tráfico a Storage.
  //
  // El render usa un <div> desechable que nunca se adjunta al DOM,
  // así que no pinta nada. Cuando el usuario abre la tab, la auditoría
  // completa corre con listAll ya cacheado para los N primeros bloques.
  const PRELOAD_TOP_N = 3;
  let dashboardPreloaded = false;
  async function preloadDashboard() {
    if (dashboardPreloaded) return;
    dashboardPreloaded = true;
    const sedeId = state?.currentSede || window.currentSedeId || 'pamplona';
    try {
      const { buildSedeTree } = await import('./core/structure-schema.js');
      const tree = await buildSedeTree(sedeId);
      const bloquesTop = Array.isArray(tree?.bloques)
        ? tree.bloques
            .slice(0, PRELOAD_TOP_N)
            .map((b) => ({ name: b.name || b.path, path: b.path || b.name }))
        : undefined;
      const sink = document.createElement('div');
      await renderDashboard({
        sedeId,
        bloques: bloquesTop,
        mountEl: sink,
        silent: true, // no emite eventos de riesgo con un report parcial
      });
    } catch (err) {
      dashboardPreloaded = false; // permite reintentar en la apertura real
      Logger.debug?.('[dashboard] preload falló (no crítico):', err?.message);
    }
  }
  setTimeout(preloadDashboard, 2000);

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
