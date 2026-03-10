import { state } from './core/state.js';
import { emit, EVENTS } from './core/events.js';

// Instancias globales de los visores para limpieza de memoria
let cadViewerInstance = null;
let bimViewerInstance = null;
let currentViewerType = null;

// 🎯 Elementos del DOM del visor
const visorModal = document.getElementById('visor-modal');
const visorIframe = document.getElementById('visor-iframe');
const cadCanvas = document.getElementById('viewer-cad');
const bimContainer = document.getElementById('viewer-bim');
const mensajeEl = document.getElementById('visor-mensaje');
const tabIframe = document.getElementById('tab-iframe');
const tabCad = document.getElementById('tab-cad');
const tabBim = document.getElementById('tab-bim');
const viewerControls = document.getElementById('viewer-controls');
const viewerReset = document.getElementById('viewer-reset');
const viewerZoomIn = document.getElementById('viewer-zoom-in');
const viewerZoomOut = document.getElementById('viewer-zoom-out');

// ✅ Limpieza completa de memoria al cerrar el visor
function cleanupViewer() {
  // Limpiar iframe
  if (visorIframe) visorIframe.src = '';

  // Limpiar visor CAD
  if (cadViewerInstance) {
    cadViewerInstance.dispose();
    cadViewerInstance = null;
  }
  if (cadCanvas) cadCanvas.classList.add('hidden');

  // Limpiar visor BIM
  if (bimViewerInstance) {
    bimViewerInstance.dispose();
    bimViewerInstance = null;
  }
  if (bimContainer) bimContainer.classList.add('hidden');

  // Restablecer pestañas (si existen)
  if (tabIframe) {
    tabIframe.classList.remove('hidden', 'bg-blue-50', 'text-blue-700', 'active');
    tabIframe.classList.add('bg-slate-100', 'text-slate-700');
  }
  if (tabCad) tabCad.classList.add('hidden');
  if (tabBim) tabBim.classList.add('hidden');
  if (viewerControls) viewerControls.classList.add('hidden');

  // Limpiar mensaje
  if (mensajeEl) mensajeEl.classList.remove('hidden');

  // Limpiar estado global
  state.currentFileViewing = null;
  currentViewerType = null;
}

// ✅ Inicializar visor CAD 2D para DWF/DWG/DXF
async function initCadViewer(fileUrl) {
  await import('dxf-viewer');

  // Crear instancia del visor CAD
  cadViewerInstance = new DxfViewer.Viewer({
    canvas: cadCanvas,
    overrideDevicePixelRatio: window.devicePixelRatio
  });

  // Cargar el archivo DXF/DWG
  const response = await fetch(fileUrl);
  const blob = await response.blob();
  await cadViewerInstance.load(blob);

  // Ajustar vista automáticamente
  cadViewerInstance.fitViewport();
  currentViewerType = 'cad';

  // Agregar controles
  viewerControls.classList.remove('hidden');
  tabCad.classList.remove('hidden');
  tabIframe.classList.add('hidden');
  tabCad.classList.add('active', 'bg-blue-50', 'text-blue-700');
  tabBim.classList.add('hidden');
  mensajeEl.classList.add('hidden');
  cadCanvas.classList.remove('hidden');
}

// ✅ Inicializar visor BIM 3D para IFC
async function initBimViewer(fileUrl) {
  const { Components, IfcLoader, OrbitControls, RoomSerializer } = await import('@thatopen/components');

  // Crear instancia de componentes BIM
  bimViewerInstance = new Components();

  // Inicializar el canvas de Three.js
  const renderer = bimViewerInstance.get('Renderer');
  renderer.setSize(bimContainer.clientWidth, bimContainer.clientHeight);
  bimContainer.appendChild(renderer.domElement);

  // Agregar controles de órbita
  const orbitControls = new OrbitControls(bimViewerInstance);
  orbitControls.enabled = true;

  // Cargar el archivo IFC
  const ifcLoader = new IfcLoader(bimViewerInstance);
  const response = await fetch(fileUrl);
  const blob = await response.blob();
  const model = await ifcLoader.load(blob);

  // Ajustar vista automáticamente
  bimViewerInstance.fragmentManager.fitFragments();
  currentViewerType = 'bim';

  // Agregar controles
  viewerControls.classList.remove('hidden');
  tabBim.classList.remove('hidden');
  tabIframe.classList.add('hidden');
  tabBim.classList.add('active', 'bg-blue-50', 'text-blue-700');
  tabCad.classList.add('hidden');
  mensajeEl.classList.add('hidden');
  bimContainer.classList.remove('hidden');
}

// ✅ Función principal para abrir cualquier tipo de archivo
export async function openViewer(file) {
  state.currentFileViewing = file;
  document.getElementById('visor-titulo').innerText = file.nombre;
  document.getElementById('visor-btn-descargar').href = file.url;
  document.getElementById('visor-tipo-label').textContent = (file.tipo || 'doc').toUpperCase();

  // Show/hide delete button based on role
  const deleteBtn = document.getElementById('visor-btn-eliminar');
  if (deleteBtn) {
    if (state.userRole === 'admin') {
      deleteBtn.classList.remove('hidden');
    } else {
      deleteBtn.classList.add('hidden');
    }
  }

  // Restablecer estado inicial
  cleanupViewer();
  visorModal.classList.add('activo');

  // Configurar icono por tipo de archivo
  const iconEl = document.getElementById('visor-icono');
  const iframeEl = document.getElementById('visor-iframe');
  const msgEl = document.getElementById('visor-mensaje');

  switch (file.tipo) {
    case 'pdf':
      iconEl.className = 'ph-fill ph-file-pdf';
      iconEl.style.cssText = 'font-size:1.5rem;color:var(--pink);';
      if (iframeEl) {
        iframeEl.src = `https://docs.google.com/viewer?url=${encodeURIComponent(file.url)}&embedded=true`;
        iframeEl.style.display = 'block';
      }
      if (msgEl) msgEl.classList.add('hidden');
      break;
    case 'img':
      iconEl.className = 'ph-fill ph-image';
      iconEl.style.cssText = 'font-size:1.5rem;color:#ce93d8;';
      if (iframeEl) {
        iframeEl.style.display = 'none';
        iframeEl.parentElement.insertAdjacentHTML('beforeend',
          `<img src="${file.url}" style="width:100%;height:100%;object-fit:contain;background:var(--midnight-mid);" id="visor-img-direct">`
        );
      }
      if (msgEl) msgEl.classList.add('hidden');
      break;
    case 'excel':
      iconEl.className = 'ph-fill ph-file-xls';
      iconEl.style.cssText = 'font-size:1.5rem;color:var(--green);';
      if (iframeEl) {
        iframeEl.src = `https://docs.google.com/viewer?url=${encodeURIComponent(file.url)}&embedded=true`;
        iframeEl.style.display = 'block';
      }
      if (msgEl) msgEl.classList.add('hidden');
      break;
    default:
      iconEl.className = 'ph-fill ph-file';
      iconEl.style.cssText = 'font-size:1.5rem;color:var(--text-muted);';
      if (msgEl) msgEl.classList.remove('hidden');
      if (iframeEl) iframeEl.style.display = 'none';
  }
}

// ✅ Configurar botones del visor predeterminados
export function setupVisorButtons() {
  const cerrarBtn = document.getElementById('btn-cerrar-visor');
  if (cerrarBtn) {
    cerrarBtn.addEventListener('click', () => {
      visorModal.classList.remove('activo');
      cleanupViewer();
      // Remove any injected images
      const directImg = document.getElementById('visor-img-direct');
      if (directImg) directImg.remove();
    });
  }

  // Cerrar al hacer clic fuera del modal
  if (visorModal) {
    visorModal.addEventListener('click', (e) => {
      if (e.target === visorModal) {
        visorModal.classList.remove('activo');
        cleanupViewer();
        const directImg = document.getElementById('visor-img-direct');
        if (directImg) directImg.remove();
      }
    });
  }

  // Botón eliminar archivo (solo para admins)
  const eliminarBtn = document.getElementById('visor-btn-eliminar');
  if (eliminarBtn) {
    eliminarBtn.addEventListener('click', () => {
      if (confirm('¿Estás seguro de eliminar este archivo? Esta acción no se puede deshacer.')) {
        emit(EVENTS.FILE_DELETED, state.currentFileViewing);
        visorModal.classList.remove('activo');
        cleanupViewer();
      }
    });
  }
}

// Función global para integraciones externas
window.openGeovisorViewer = openViewer;

