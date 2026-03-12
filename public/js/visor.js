import { state } from './core/state.js';
import { emit, EVENTS } from './core/events.js';
import { ref as storageRef, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { doc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { storage, db } from './services/firebase.js';
import { dbPath } from './core/config.js';
import { init3DViewer } from './viewer3D.js';

// Instancias globales de los visores para limpieza de memoria
let cadViewerInstance = null;
let bimViewerInstance = null;
let viewer3DInstance = null;
let currentViewerType = null;

// ─── Navigation state ───
let visorFileList = [];
let visorFileIndex = -1;

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

// Navigation arrow elements
const navPrev = document.getElementById('visor-nav-prev');
const navNext = document.getElementById('visor-nav-next');
const navCounter = document.getElementById('visor-nav-counter');

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

  // Limpiar visor 3D (GLB)
  if (viewer3DInstance) {
    viewer3DInstance.dispose();
    viewer3DInstance = null;
  }

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

  // Limpiar contenido inyectado (img, tablas Excel, contenedores 3D)
  const directImg = document.getElementById('visor-img-direct');
  if (directImg) directImg.remove();
  const excelContainer = document.getElementById('visor-excel-container');
  if (excelContainer) excelContainer.remove();
  const glbContainer = document.getElementById('visor-glb-container');
  if (glbContainer) glbContainer.remove();

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

// ✅ Renderizar Excel/CSV con SheetJS
async function renderExcelViewer(fileUrl, fileName) {
  const iframeEl = document.getElementById('visor-iframe');
  const msgEl = document.getElementById('visor-mensaje');

  if (iframeEl) iframeEl.style.display = 'none';
  if (msgEl) msgEl.classList.add('hidden');

  try {
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();

    // Detectar si es CSV por la extensión
    const isCSV = fileName.toLowerCase().endsWith('.csv');
    let workbook;
    if (isCSV) {
      const text = new TextDecoder('utf-8').decode(arrayBuffer);
      workbook = XLSX.read(text, { type: 'string' });
    } else {
      workbook = XLSX.read(arrayBuffer, { type: 'array' });
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const htmlTable = XLSX.utils.sheet_to_html(firstSheet, { id: 'excel-table-visor' });

    // Crear contenedor scrollable para la tabla
    const container = document.createElement('div');
    container.id = 'visor-excel-container';
    container.style.cssText = `
      width:100%;height:100%;overflow:auto;background:var(--midnight-mid);padding:12px;
      font-family:'Inter',sans-serif;
    `;
    container.innerHTML = `
      <style>
        #excel-table-visor {
          border-collapse: collapse;
          width: 100%;
          font-size: 0.78rem;
          color: var(--text-primary);
        }
        #excel-table-visor th,
        #excel-table-visor td {
          border: 1px solid var(--border-subtle);
          padding: 6px 10px;
          text-align: left;
          white-space: nowrap;
        }
        #excel-table-visor th,
        #excel-table-visor tr:first-child td {
          background: var(--cyan-dim);
          color: var(--cyan);
          font-weight: 700;
          text-transform: uppercase;
          font-size: 0.7rem;
          letter-spacing: 0.04em;
          position: sticky;
          top: 0;
          z-index: 1;
        }
        #excel-table-visor tr:nth-child(even) {
          background: rgba(255,255,255,0.03);
        }
        #excel-table-visor tr:hover {
          background: var(--surface-hover);
        }
      </style>
      ${htmlTable}
    `;

    // Insertar en el visor body
    const visorBody = document.querySelector('.visor-body');
    if (visorBody) visorBody.appendChild(container);

  } catch (error) {
    console.error('Error renderizando Excel/CSV:', error);
    if (msgEl) {
      msgEl.classList.remove('hidden');
      msgEl.innerHTML = `
        <i class="ph ph-warning" style="font-size:4rem;margin-bottom:1rem;color:var(--amber);"></i>
        <h4 style="font-size:1.2rem;font-weight:700;">Error al cargar la hoja de cálculo</h4>
        <p style="max-width:24rem;">No se pudo renderizar este archivo. Usa el botón "Descargar" para obtener el original.</p>
      `;
    }
  }
}

// ─── Navigation helpers ───
function updateNavUI() {
  const hasMultiple = visorFileList.length > 1;

  if (navPrev) {
    if (hasMultiple) {
      navPrev.classList.remove('hidden');
      navPrev.disabled = visorFileIndex <= 0;
    } else {
      navPrev.classList.add('hidden');
    }
  }

  if (navNext) {
    if (hasMultiple) {
      navNext.classList.remove('hidden');
      navNext.disabled = visorFileIndex >= visorFileList.length - 1;
    } else {
      navNext.classList.add('hidden');
    }
  }

  if (navCounter) {
    if (hasMultiple) {
      navCounter.classList.remove('hidden');
      navCounter.textContent = `${visorFileIndex + 1} / ${visorFileList.length}`;
    } else {
      navCounter.classList.add('hidden');
    }
  }
}

function navigateVisor(direction) {
  const newIndex = visorFileIndex + direction;
  if (newIndex < 0 || newIndex >= visorFileList.length) return;
  visorFileIndex = newIndex;
  const file = visorFileList[visorFileIndex];
  if (file) openViewer(file);
}

/**
 * Set the file list context for navigation arrows.
 * Call this BEFORE openViewer when you have sibling files available.
 * @param {Array} fileList - Array of file objects
 */
export function setVisorFileList(fileList) {
  visorFileList = Array.isArray(fileList) ? fileList : [];
  visorFileIndex = -1;
}

// ✅ Función principal para abrir cualquier tipo de archivo
export async function openViewer(file) {
  state.currentFileViewing = file;
  document.getElementById('visor-titulo').innerText = file.nombre;

  // 🚫 Botón de descarga: solo visible para admins
  const descargarBtn = document.getElementById('visor-btn-descargar');
  if (descargarBtn) {
    descargarBtn.href = file.url;
    if (state.userRole === 'admin') {
      descargarBtn.classList.remove('hidden');
    } else {
      descargarBtn.classList.add('hidden');
    }
  }

  // Fallback type detection from file extension (for files uploaded before type detection)
  let fileType = file.tipo || 'otro';
  if (fileType === 'otro' && file.nombre) {
    const name = file.nombre.toLowerCase();
    if (name.endsWith('.glb') || name.endsWith('.gltf')) fileType = 'glb';
    else if (name.endsWith('.xlsx') || name.endsWith('.xls')) fileType = 'excel';
    else if (name.endsWith('.csv')) fileType = 'csv';
    else if (name.endsWith('.pdf')) fileType = 'pdf';
    else if (name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.gif')) fileType = 'img';
  }

  document.getElementById('visor-tipo-label').textContent = fileType.toUpperCase();

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

  // ─── Compute navigation index ───
  if (visorFileList.length > 0) {
    const idx = visorFileList.findIndex(f =>
      (f.id && f.id === file.id) ||
      (f.nombre === file.nombre && f.url === file.url)
    );
    visorFileIndex = idx >= 0 ? idx : -1;
  }
  updateNavUI();

  // Configurar icono por tipo de archivo
  const iconEl = document.getElementById('visor-icono');
  const iframeEl = document.getElementById('visor-iframe');
  const msgEl = document.getElementById('visor-mensaje');

  switch (fileType) {
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
    case 'csv':
      iconEl.className = 'ph-fill ph-file-xls';
      iconEl.style.cssText = 'font-size:1.5rem;color:var(--green);';
      // Render with SheetJS instead of Google Docs iframe
      renderExcelViewer(file.url, file.nombre);
      break;
    case 'glb':
      iconEl.className = 'ph-fill ph-cube';
      iconEl.style.cssText = 'font-size:1.5rem;color:var(--cyan);';
      if (iframeEl) iframeEl.style.display = 'none';
      if (msgEl) msgEl.classList.add('hidden');

      // Create a 3D container inside visor-body
      const visorBody = document.querySelector('.visor-body');
      if (visorBody) {
        const glbContainer = document.createElement('div');
        glbContainer.id = 'visor-glb-container';
        glbContainer.style.cssText = 'width:100%;height:100%;background:var(--midnight-mid);';
        
        // Show loading spinner BEFORE init3DViewer (it will clear this when ready)
        glbContainer.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">
            <div class="loading-spinner"></div>
            <p style="margin-top:1rem;font-size:0.82rem;">Cargando modelo 3D...</p>
            <p id="visor-3d-progress" style="font-size:0.72rem;color:var(--cyan);margin-top:4px;"></p>
          </div>`;
        visorBody.appendChild(glbContainer);

        try {
          // NOTE: Do NOT use onStart — init3DViewer clears container.innerHTML
          // and appends the WebGL canvas. An onStart that sets innerHTML would destroy it.
          viewer3DInstance = await init3DViewer({
            container: glbContainer,
            url: file.url,
            onLoaded: () => {
              console.log('✅ Modelo 3D cargado exitosamente');
            },
            onProgress: (pct) => {
              const progressEl = document.getElementById('visor-3d-progress');
              if (progressEl) progressEl.textContent = `${pct}%`;
            },
            onError: (err) => {
              console.error('❌ Error cargando modelo 3D:', err);
              glbContainer.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">
                  <i class="ph ph-warning" style="font-size:3rem;margin-bottom:1rem;color:var(--amber);"></i>
                  <h4 style="font-size:1rem;font-weight:700;">Error al cargar el modelo 3D</h4>
                  <p style="font-size:0.82rem;max-width:20rem;text-align:center;">${err.userMessage || 'No se pudo renderizar el modelo. Usa "Descargar" para obtenerlo.'}</p>
                </div>`;
            }
          });
        } catch (err) {
          console.error('❌ Error inicializando visor 3D:', err);
          glbContainer.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">
              <i class="ph ph-warning" style="font-size:3rem;margin-bottom:1rem;color:var(--amber);"></i>
              <p style="font-size:0.82rem;">${err.userMessage || 'Error al inicializar el visor 3D.'}</p>
            </div>`;
        }
      }
      break;
    default:
      iconEl.className = 'ph-fill ph-file';
      iconEl.style.cssText = 'font-size:1.5rem;color:var(--text-muted);';
      if (msgEl) msgEl.classList.remove('hidden');
      if (iframeEl) iframeEl.style.display = 'none';
  }
}

// ✅ Custom Glassmorphism confirm modal (replaces native confirm())
export function showConfirmDelete(fileName) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-delete-modal');
    const filenameEl = document.getElementById('confirm-delete-filename');
    const btnOk = document.getElementById('confirm-delete-ok');
    const btnCancel = document.getElementById('confirm-delete-cancel');

    if (!modal || !btnOk || !btnCancel) {
      // Fallback to native if modal not found
      resolve(confirm('¿Está seguro de eliminar este archivo? Esta acción no se puede deshacer.'));
      return;
    }

    if (filenameEl) filenameEl.textContent = fileName || '';

    modal.classList.add('activo');

    function cleanup() {
      modal.classList.remove('activo');
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
    }

    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }
    function onBackdrop(e) {
      if (e.target === modal) { cleanup(); resolve(false); }
    }

    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
  });
}

// ✅ Configurar botones del visor predeterminados
export function setupVisorButtons() {
  const cerrarBtn = document.getElementById('btn-cerrar-visor');
  if (cerrarBtn) {
    cerrarBtn.addEventListener('click', () => {
      visorModal.classList.remove('activo');
      cleanupViewer();
      // Reset navigation state on close
      visorFileList = [];
      visorFileIndex = -1;
      updateNavUI();
    });
  }

  // Lógica del botón de Pantalla Completa
  const btnFullscreen = document.getElementById('visor-btn-fullscreen');
  const visorBody = document.querySelector('.visor-body');
  
  if (btnFullscreen && visorBody) {
    btnFullscreen.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        if (!document.fullscreenElement) {
          await visorBody.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch (err) {
        console.error('Error toggling fullscreen:', err);
      }
    });

    // Escuchar el evento nativo para sincronizar el ícono (ej. al salir con ESC)
    document.addEventListener('fullscreenchange', () => {
      const icon = btnFullscreen.querySelector('i');
      if (!icon) return;

      if (document.fullscreenElement) {
        icon.className = 'ph ph-corners-in';
        btnFullscreen.title = 'Salir de Pantalla Completa';
      } else {
        icon.className = 'ph ph-corners-out';
        btnFullscreen.title = 'Pantalla Completa';
      }
    });
  }

  // Cerrar al hacer clic fuera del modal
  if (visorModal) {
    visorModal.addEventListener('click', (e) => {
      if (e.target === visorModal) {
        visorModal.classList.remove('activo');
        cleanupViewer();
        visorFileList = [];
        visorFileIndex = -1;
        updateNavUI();
      }
    });
  }

  // ─── Navigation arrows ───
  if (navPrev) {
    navPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateVisor(-1);
    });
  }
  if (navNext) {
    navNext.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateVisor(1);
    });
  }

  // Keyboard navigation: left/right arrows
  document.addEventListener('keydown', (e) => {
    if (!visorModal?.classList.contains('activo')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigateVisor(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigateVisor(1); }
    if (e.key === 'Escape') {
      visorModal.classList.remove('activo');
      cleanupViewer();
      visorFileList = [];
      visorFileIndex = -1;
      updateNavUI();
    }
  });

  // Botón eliminar archivo (solo para admins) — Lógica REAL de eliminación
  const eliminarBtn = document.getElementById('visor-btn-eliminar');
  if (eliminarBtn) {
    eliminarBtn.addEventListener('click', async () => {
      const file = state.currentFileViewing;
      if (!file) return;

      const confirmed = await showConfirmDelete(file.nombre);
      if (!confirmed) return;

      // Disable button during deletion
      eliminarBtn.disabled = true;
      eliminarBtn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Eliminando...';

      try {
        // 1. Delete from Firebase Storage
        if (file.storagePath) {
          const fileRef = storageRef(storage, file.storagePath);
          await deleteObject(fileRef);
        }

        // 2. Delete Firestore document
        if (file.id) {
          const docRef = doc(db, dbPath, file.id);
          await deleteDoc(docRef);
        }

        // 3. Emit event for any listeners
        emit(EVENTS.FILE_DELETED, file);

        // 4. Close visor — Firestore onSnapshot will auto-refresh the file list
        visorModal.classList.remove('activo');
        cleanupViewer();

        console.log('✅ Archivo eliminado exitosamente:', file.nombre);
      } catch (error) {
        console.error('❌ Error eliminando archivo:', error);
        alert('Error al eliminar el archivo: ' + error.message);
      } finally {
        eliminarBtn.disabled = false;
        eliminarBtn.innerHTML = '<i class="ph ph-trash"></i> Eliminar';
      }
    });
  }
}

// Función global para integraciones externas
window.openGeovisorViewer = openViewer;
