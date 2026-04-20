/**
 * UI del panel lateral: vista global, vista por bloque, árbol de carpetas.
 */
import { state } from './core/state.js';
import { on, EVENTS } from './core/events.js';
import { Logger } from './core/logger.js';
import { getCampusData } from './campus-data.js';
import { generarMenuPlanoteca } from './planoteca-structure.js';
import { getPathsForFilter, getFirstFileInPath, getFilesInPath, normalizeKey } from './services/fileMapper.js';
import { escapeHtml } from './core/safe-dom.js';

import { storage } from './services/firebase.js';
import { ref as storageRef, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

let blockPreviewDispose3D = null;
let blockPreviewWired = false;
let blockPreviewActiveTab = '3d';
let blockPreviewLastBlockId = null;
let _subcarpetaHandler = null;

// ─── Mini-visor navigation state ───
let miniVisorFiles = [];
let miniVisorIndex = -1;
let miniVisorCurrentTab = null;
let miniVisorCurrentPath = null;



async function resolveFileUrlForPreview(file) {
  if (!file) return null;
  if (file.url) return file.url;
  if (file.storagePath) {
    const r = storageRef(storage, file.storagePath);
    return await getDownloadURL(r);
  }
  return null;
}

function disposeBlock3DPreview() {
  if (!blockPreviewDispose3D) return;
  try { blockPreviewDispose3D(); } catch (e) { console.error('3D dispose error:', e); }
  blockPreviewDispose3D = null;
}

function ensureBlockPreviewUI() {
  // Preview container is now in the HTML (Visor tab), skip if it already exists
  if (document.getElementById('block-preview-container')) return;
  const blockInfo = document.getElementById('block-info');
  if (!blockInfo) return;

  const host = document.createElement('div');
  host.className = 'mt-4';
  host.innerHTML = `
    <div id="block-preview-container" class="w-100 border rounded-3 bg-light position-relative overflow-hidden" style="height: 240px;">
      <div class="position-absolute top-50 start-50 translate-middle text-secondary small" data-block-preview-empty>
        Selecciona una pestaña para previsualizar.
      </div>
    </div>

    <div class="mt-3">
      <ul class="nav nav-pills nav-fill" id="block-preview-tabs" role="tablist">
        <li class="nav-item" role="presentation">
          <button class="nav-link" type="button" data-block-preview-tab="3d">
            <i class="ph ph-cube"></i> 3D
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" type="button" data-block-preview-tab="pdf">
            <i class="ph ph-file-pdf"></i> Planos
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" type="button" data-block-preview-tab="img">
            <i class="ph ph-image"></i> Fotos
          </button>
        </li>
      </ul>
    </div>

    <div class="mt-3 d-grid">
      <button type="button" class="btn btn-primary" id="btn-go-planoteca">
        Ver en Planoteca Completa
      </button>
    </div>
  `.trim();

  blockInfo.appendChild(host);
}

function setBlockPreviewActive(tab) {
  blockPreviewActiveTab = tab;
  const tabs = document.getElementById('block-preview-tabs');
  if (!tabs) return;
  tabs.querySelectorAll('.nav-link').forEach(btn => {
    const t = btn.getAttribute('data-block-preview-tab');
    if (t === tab) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

function getBlockFilesForPreview(blockId) {
  const campusData = getCampusData();
  const nameRaw = campusData?.[blockId]?.name || blockId;
  const nameKey = normalizeKey(nameRaw);

  const files = Array.isArray(state.archivosNube) ? state.archivosNube : [];

  return files.filter(f => {
    if (!f) return false;
    if (String(f.bloque || '') === String(blockId)) return true;
    const n = normalizeKey(f.nombre);
    const p = normalizeKey(f.storagePath);
    const c = normalizeKey(f.carpeta);
    return (nameKey && (n.includes(nameKey) || p.includes(nameKey) || c.includes(nameKey)));
  });
}

function pickPreviewBuckets(files) {
  const models3d = [];
  const pdfs = [];
  const images = [];

  files.forEach(f => {
    const nombre = String(f?.nombre || '');
    const ext = (nombre.split('.').pop() || '').toLowerCase();
    const tipo = String(f?.tipo || '').toLowerCase();

    if (ext === 'glb' || ext === 'gltf' || tipo === 'glb' || tipo === 'gltf') {
      models3d.push(f);
      return;
    }

    if (ext === 'pdf' || tipo === 'pdf') {
      pdfs.push(f);
      return;
    }

    if (tipo === 'img' || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      images.push(f);
    }
  });

  return { models3d, pdfs, images };
}

// Get the inner content div (preserves arrow buttons which are siblings)
function getMiniVisorContentEl(container) {
  return document.getElementById('mini-visor-content') || container;
}

function renderBlockPreviewMessage(container, title, detail) {
  const el = getMiniVisorContentEl(container);
  el.innerHTML = `
    <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px;text-align:center;">
      <div style="font-weight:600;color:var(--text-secondary);">${escapeHtml(title || '')}</div>
      ${detail ? `<div style="font-size:0.82rem;color:var(--text-muted);margin-top:4px;">${escapeHtml(detail)}</div>` : ''}
    </div>
  `.trim();
}

async function renderBlock3DPreview(container, file) {
  disposeBlock3DPreview();
  const contentEl = getMiniVisorContentEl(container);
  contentEl.innerHTML = `
    <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
      <div style="text-align:center;">
        <div class="spinner-border text-primary" role="status" aria-hidden="true"></div>
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:8px;">Cargando modelo 3D...</div>
      </div>
    </div>
  `.trim();

  let url = null;
  try {
    url = await resolveFileUrlForPreview(file);
  } catch (e) {
    console.error('3D resolve URL error:', e);
  }

  if (!url) {
    renderBlockPreviewMessage(contentEl, 'No se pudo resolver el modelo 3D.', null);
    return;
  }

  const mount = document.createElement('div');
  mount.style.width = '100%';
  mount.style.height = '100%';
  mount.style.background = '#f8fafc';
  contentEl.innerHTML = '';
  contentEl.appendChild(mount);

  try {
    const { init3DViewer } = await import('./viewer3D.js');
    const instance = await init3DViewer({
      container: mount,
      url,
      onLoaded: () => { },
      onStart: () => { },
      onError: (err) => {
        console.error('3D block preview error:', err);
        const msg = err?.userMessage || 'No se pudo cargar el modelo 3D.';
        renderBlockPreviewMessage(contentEl, msg, 'Puedes abrirlo desde Planoteca para descargar/visualizar.');
      }
    });
    blockPreviewDispose3D = () => instance?.dispose?.();
  } catch (e) {
    console.error('3D block preview init error:', e);
    renderBlockPreviewMessage(contentEl, 'No se pudo inicializar el visor 3D.', null);
  }
}

async function renderBlockPdfPreview(container, file) {
  disposeBlock3DPreview();
  const contentEl = getMiniVisorContentEl(container);
  contentEl.innerHTML = `
    <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
      <div style="text-align:center;">
        <div class="spinner-border text-primary" role="status" aria-hidden="true"></div>
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:8px;">Cargando plano (PDF)...</div>
      </div>
    </div>
  `.trim();

  let url = null;
  try {
    url = await resolveFileUrlForPreview(file);
  } catch (e) {
    console.error('PDF resolve URL error:', e);
  }

  if (!url) {
    renderBlockPreviewMessage(contentEl, 'No se pudo resolver el PDF.', null);
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.loading = 'lazy';
  iframe.onload = () => { };

  contentEl.innerHTML = '';
  contentEl.appendChild(iframe);
  iframe.src = `https://drive.google.com/viewerng/viewer?embedded=true&url=${encodeURIComponent(url)}`;
}

async function renderBlockImagesPreview(container, files) {
  disposeBlock3DPreview();

  const contentEl = getMiniVisorContentEl(container);
  contentEl.innerHTML = `
    <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
      <div style="text-align:center;">
        <div class="spinner-border text-primary" role="status" aria-hidden="true"></div>
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:8px;">Cargando fotos...</div>
      </div>
    </div>
  `.trim();

  const resolved = [];
  for (const f of (files || []).slice(0, 10)) {
    try {
      const u = await resolveFileUrlForPreview(f);
      if (u) resolved.push({ url: u, nombre: f?.nombre || '' });
    } catch (e) {
      console.error('IMG resolve URL error:', e);
    }
  }

  if (!resolved.length) {
    renderBlockPreviewMessage(contentEl, 'No hay fotos disponibles para este bloque.', null);
    return;
  }

  const carouselId = 'block-preview-carousel';
  const outer = document.createElement('div');
  outer.className = 'carousel slide w-100 h-100';
  outer.id = carouselId;
  outer.setAttribute('data-bs-ride', 'carousel');

  const inner = document.createElement('div');
  inner.className = 'carousel-inner w-100 h-100 bg-dark';
  outer.appendChild(inner);

  resolved.forEach((item, idx) => {
    const it = document.createElement('div');
    it.className = `carousel-item w-100 h-100 ${idx === 0 ? 'active' : ''}`;
    it.innerHTML = `
      <img src="${item.url}" class="d-block w-100 h-100" style="object-fit:contain; background:#0b1220;" alt="${String(item.nombre).replace(/"/g, '&quot;')}">
    `.trim();
    inner.appendChild(it);
  });

  if (resolved.length > 1) {
    const prev = document.createElement('button');
    prev.className = 'carousel-control-prev';
    prev.type = 'button';
    prev.setAttribute('data-bs-target', `#${carouselId}`);
    prev.setAttribute('data-bs-slide', 'prev');
    prev.innerHTML = '<span class="carousel-control-prev-icon" aria-hidden="true"></span><span class="visually-hidden">Anterior</span>';
    outer.appendChild(prev);

    const next = document.createElement('button');
    next.className = 'carousel-control-next';
    next.type = 'button';
    next.setAttribute('data-bs-target', `#${carouselId}`);
    next.setAttribute('data-bs-slide', 'next');
    next.innerHTML = '<span class="carousel-control-next-icon" aria-hidden="true"></span><span class="visually-hidden">Siguiente</span>';
    outer.appendChild(next);
  }

  contentEl.innerHTML = '';
  contentEl.appendChild(outer);
}

async function renderBlockPreviewForTab(blockId, tab) {
  const container = document.getElementById('block-preview-container');
  const folderContainer = document.getElementById('visor-folder-routes');
  const folderList = document.getElementById('visor-folder-list');

  if (!container) return;

  // Ocultar chips de rutas si no hay tab seleccionado
  if (!tab) {
    if (folderContainer) folderContainer.style.display = 'none';
    return;
  }

  // Obtener rutas de carpeta para este tab (desde fileMapper.js)
  const paths = getPathsForFilter(tab, state.currentSede || '');

  if (paths.length === 0) {
    if (folderContainer) folderContainer.style.display = 'none';
    disposeBlock3DPreview();
    renderBlockPreviewMessage(container, 'No hay rutas configuradas para este tipo.', null);
    return;
  }

  // Si hay rutas, mostrar la subventana de carpetas
  if (folderContainer && folderList) {
    folderContainer.style.display = 'block';
    folderList.innerHTML = '';

    paths.forEach((p, idx) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'visor-folder-chip';
      // Inline styling para el chip, basándonos en glassmorphism y dark mode
      chip.style.cssText = 'padding: 6px 12px; border-radius: 16px; font-size: 0.75rem; font-weight: 600; border: 1px solid var(--border-active); background: var(--cyan-dim); color: var(--cyan); white-space: nowrap; cursor: pointer; transition: all 0.2s ease; flex-shrink: 0; outline: none; box-shadow: none;';
      chip.textContent = p.label;

      // Auto-cargar el primero por defecto o esperar click
      if (idx === 0) {
        chip.style.background = 'var(--cyan)';
        chip.style.color = '#fff';
        loadFirstFileFromPath(blockId, p.path, tab, container);
      }

      chip.onclick = () => {
        // Quitar activo a los demas
        Array.from(folderList.children).forEach(c => {
          c.style.background = 'var(--cyan-dim)';
          c.style.color = 'var(--cyan)';
        });
        // Poner activo
        chip.style.background = 'var(--cyan)';
        chip.style.color = '#fff';

        loadFirstFileFromPath(blockId, p.path, tab, container);
      };

      folderList.appendChild(chip);
    });
  }
}

// ─── Mini-visor navigation: update arrows/counter UI ───
function updateMiniVisorNavUI() {
  const prevBtn = document.getElementById('mini-visor-nav-prev');
  const nextBtn = document.getElementById('mini-visor-nav-next');
  const counterEl = document.getElementById('mini-visor-nav-counter');
  const hasMultiple = miniVisorFiles.length > 1;

  if (prevBtn) {
    if (hasMultiple) {
      prevBtn.classList.remove('hidden');
      prevBtn.disabled = miniVisorIndex <= 0;
    } else {
      prevBtn.classList.add('hidden');
    }
  }
  if (nextBtn) {
    if (hasMultiple) {
      nextBtn.classList.remove('hidden');
      nextBtn.disabled = miniVisorIndex >= miniVisorFiles.length - 1;
    } else {
      nextBtn.classList.add('hidden');
    }
  }
  if (counterEl) {
    if (hasMultiple) {
      counterEl.classList.remove('hidden');
      counterEl.textContent = `${miniVisorIndex + 1} / ${miniVisorFiles.length}`;
    } else {
      counterEl.classList.add('hidden');
    }
  }
}

function updateMiniVisorFileDetails(file) {
  const detailName = document.getElementById('visor-detail-name');
  const detailSize = document.getElementById('visor-detail-size');
  const detailDate = document.getElementById('visor-detail-date');
  const detailsBox = document.getElementById('visor-file-details');
  if (detailName) detailName.textContent = file.nombre || '--';
  if (detailSize) detailSize.textContent = file.size ? (file.size / 1024 / 1024).toFixed(2) + ' MB' : '--';
  if (detailDate) detailDate.textContent = file.fechaSubida ? new Date(file.fechaSubida).toLocaleDateString() : '--';
  if (detailsBox) detailsBox.style.display = 'block';
}

async function renderMiniVisorFileAtIndex(container, tab) {
  if (miniVisorIndex < 0 || miniVisorIndex >= miniVisorFiles.length) return;
  const file = miniVisorFiles[miniVisorIndex];
  if (!file) return;

  disposeBlock3DPreview();
  updateMiniVisorFileDetails(file);
  updateMiniVisorNavUI();

  if (tab === '3d') {
    await renderBlock3DPreview(container, file);
  } else if (tab === 'pdf') {
    await renderBlockPdfPreview(container, file);
  } else if (tab === 'img' || tab === 'renders') {
    await renderBlockImagesPreview(container, [file]);
  }
}

async function loadFirstFileFromPath(blockId, path, tab, container) {
  disposeBlock3DPreview();
  const contentEl = getMiniVisorContentEl(container);
  contentEl.innerHTML = `
    <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
      <div style="text-align:center;">
        <div class="spinner-border text-primary" role="status" aria-hidden="true" style="color:var(--cyan) !important;"></div>
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:8px;">Buscando archivo en la ruta...</div>
      </div>
    </div>
  `.trim();

  // Load ALL files from this path for navigation
  let allFiles = getFilesInPath(blockId, path);

  // 🛡️ Strict .glb filter for 3D tab — only render 3D models
  if (tab === '3d') {
    allFiles = allFiles.filter(f => {
      const name = String(f.nombre || f.name || '').toLowerCase();
      return name.endsWith('.glb') || name.endsWith('.gltf');
    });
  }

  miniVisorFiles = allFiles;
  miniVisorIndex = allFiles.length > 0 ? 0 : -1;
  miniVisorCurrentTab = tab;
  miniVisorCurrentPath = path;

  if (allFiles.length === 0) {
    renderBlockPreviewMessage(container, 'Carpeta Vacía', 'No hay archivos para la especialidad seleccionada.');
    const detailsBox = document.getElementById('visor-file-details');
    if (detailsBox) detailsBox.style.display = 'none';
    updateMiniVisorNavUI();
    return;
  }

  await renderMiniVisorFileAtIndex(container, tab);
}

function wireBlockPreviewEvents() {
  if (blockPreviewWired) return;
  blockPreviewWired = true;

  document.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('[data-block-preview-tab]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const tab = btn.getAttribute('data-block-preview-tab');
    if (!tab) return;
    setBlockPreviewActive(tab);
    // Reset navigation when switching tabs
    miniVisorFiles = [];
    miniVisorIndex = -1;
    updateMiniVisorNavUI();
    if (blockPreviewLastBlockId) renderBlockPreviewForTab(blockPreviewLastBlockId, tab);
  }, true);

  // ─── Mini-visor navigation arrows ───
  const miniPrev = document.getElementById('mini-visor-nav-prev');
  const miniNext = document.getElementById('mini-visor-nav-next');

  if (miniPrev) {
    miniPrev.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (miniVisorIndex <= 0) return;
      miniVisorIndex--;
      const container = document.getElementById('block-preview-container');
      if (container && miniVisorCurrentTab) {
        renderMiniVisorFileAtIndex(container, miniVisorCurrentTab);
      }
    });
  }

  if (miniNext) {
    miniNext.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (miniVisorIndex >= miniVisorFiles.length - 1) return;
      miniVisorIndex++;
      const container = document.getElementById('block-preview-container');
      if (container && miniVisorCurrentTab) {
        renderMiniVisorFileAtIndex(container, miniVisorCurrentTab);
      }
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('#btn-go-planoteca');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const planotecaTab = document.querySelector('[data-panel="planoteca"]');
    const dashboardTab = document.querySelector('[data-panel="dashboard"]');
    const panelPlanoteca = document.getElementById('panel-planoteca');
    const panelDashboard = document.getElementById('panel-dashboard');
    const viewGlobal = document.getElementById('view-global');
    const viewBlock = document.getElementById('view-block');

    if (planotecaTab && dashboardTab) {
      planotecaTab.classList.add('text-blue-600', 'border-b-2', 'border-blue-600', '-mb-px');
      planotecaTab.classList.remove('text-slate-500');
      dashboardTab.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600', '-mb-px');
      dashboardTab.classList.add('text-slate-500');
    }

    panelPlanoteca?.classList?.remove?.('hidden');
    panelDashboard?.classList?.add?.('hidden');

    viewGlobal?.classList?.add?.('hidden');
    viewBlock?.classList?.remove?.('hidden');

    const tree = document.getElementById('arbol-carpetas-iser');
    tree?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, true);
}

class DocPreviewModal {
  static instance = null;

  static getInstance() {
    if (!DocPreviewModal.instance) DocPreviewModal.instance = new DocPreviewModal();
    return DocPreviewModal.instance;
  }

  constructor() {
    this.modalEl = document.getElementById('doc-viewer-modal');
    this.titleEl = document.getElementById('doc-viewer-modal-title');
    this.bodyEl = document.getElementById('doc-viewer-modal-body');
    this.btnDownload = document.getElementById('doc-viewer-modal-download');
    this.btnFloatingFullscreen = null; // Se inicializa al abrir un doc
    this._bsModal = null;
    this._currentFile = null;
    this._currentUrl = null;
    this._dispose3D = null;
    this._wireOnce();
  }

  _wireOnce() {
    if (!this.modalEl) return;
    if (this.modalEl.dataset.wired === '1') return;
    this.modalEl.dataset.wired = '1';

    const modalBody = this.modalEl.querySelector?.('.modal-body');
    if (modalBody) modalBody.style.height = '80vh';

    this.modalEl.addEventListener('hidden.bs.modal', () => {
      if (this._dispose3D) {
        try { this._dispose3D(); } catch (e) { console.error('3D dispose error:', e); }
        this._dispose3D = null;
      }
      const iframe = this.bodyEl?.querySelector?.('iframe');
      if (iframe) iframe.src = 'about:blank';
      const embed = this.bodyEl?.querySelector?.('embed');
      if (embed) embed.src = '';
      if (this.bodyEl) this.bodyEl.innerHTML = '';
      if (this.titleEl) this.titleEl.textContent = 'Documento';
      this._currentFile = null;
      this._currentUrl = null;
    });

    this.btnDownload?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this._currentUrl) return;
      const a = document.createElement('a');
      a.href = this._currentUrl;
      a.rel = 'noopener';
      a.download = this._currentFile?.nombre || '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    // El botón flotante se maneja en open() porque se inyecta dinámicamente

    // Listener para cambios de fullscreen (incluye tecla ESC)
    document.addEventListener('fullscreenchange', () => {
      if (!this.btnFloatingFullscreen) return;
      const icon = this.btnFloatingFullscreen.querySelector('i');
      if (!icon) return;

      if (document.fullscreenElement) {
        icon.className = 'ph ph-corners-in';
        this.btnFloatingFullscreen.title = 'Salir de Pantalla Completa';
      } else {
        icon.className = 'ph ph-corners-out';
        this.btnFloatingFullscreen.title = 'Pantalla Completa';
      }
    });
  }

  _getModal() {
    const bootstrapNs = window.bootstrap;
    if (!bootstrapNs?.Modal || !this.modalEl) return null;
    if (!this._bsModal) this._bsModal = new bootstrapNs.Modal(this.modalEl, { focus: true });
    return this._bsModal;
  }

  _spinnerHtml() {
    return `
      <div data-doc-preview-root class="w-100 h-100 d-flex align-items-center justify-content-center">
        <div class="text-center">
          <div class="spinner-border text-primary" role="status" aria-hidden="true"></div>
          <div class="mt-2 text-secondary">Cargando documento...</div>
        </div>
      </div>
    `.trim();
  }

  _loadingShell() {
    return `
      <div data-doc-preview-root class="w-100 h-100 position-relative bg-dark">
        <!-- Botón Flotante Fullscreen -->
        <button class="btn-floating-fullscreen" title="Pantalla Completa">
          <i class="ph ph-corners-out"></i>
        </button>
        <div data-doc-preview-loading class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center bg-white" style="z-index: 2;">
          <div class="text-center">
            <div class="spinner-border text-primary" role="status" aria-hidden="true"></div>
            <div class="mt-2 text-secondary">Cargando documento...</div>
          </div>
        </div>
        <div data-doc-preview-content class="w-100 h-100" style="opacity:0;"></div>
      </div>
    `.trim();
  }

  _markLoaded() {
    const root = this.bodyEl?.querySelector?.('[data-doc-preview-root]');
    const loading = root?.querySelector?.('[data-doc-preview-loading]');
    const content = root?.querySelector?.('[data-doc-preview-content]');
    if (loading) loading.remove();
    if (content) content.style.opacity = '1';
  }

  async _resolveUrl(file) {
    if (file?.url) return file.url;
    if (file?.storagePath) {
      const r = storageRef(storage, file.storagePath);
      return await getDownloadURL(r);
    }
    return null;
  }

  async resolveUrl(file) {
    return await this._resolveUrl(file);
  }

  async open(file) {
    if (!this.modalEl || !this.bodyEl || !this.titleEl) return;

    this._currentFile = file || null;
    this.titleEl.textContent = file?.nombre || 'Documento';
    this.bodyEl.innerHTML = this._loadingShell();

    // 🚫 Mostrar/ocultar botón de descarga según rol
    if (this.btnDownload) {
      if (state.userRole === 'admin') {
        this.btnDownload.classList.remove('hidden');
      } else {
        this.btnDownload.classList.add('hidden');
      }
    }

    // Lógica del botón flotante de fullscreen
    this.btnFloatingFullscreen = this.bodyEl.querySelector('.btn-floating-fullscreen');
    if (this.btnFloatingFullscreen) {
      this.btnFloatingFullscreen.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const root = this.bodyEl.querySelector('[data-doc-preview-root]');
        if (!root) return;

        try {
          if (!document.fullscreenElement) {
            await root.requestFullscreen();
          } else {
            await document.exitFullscreen();
          }
        } catch (err) {
          console.error('Error toggling fullscreen:', err);
        }
      });
    }

    const modal = this._getModal();
    if (modal) modal.show();

    let url = null;
    try {
      url = await this._resolveUrl(file);
    } catch (err) {
      console.error('Error resolving file URL:', err);
    }
    this._currentUrl = url;

    if (!url) {
      this.bodyEl.innerHTML = '<div data-doc-preview-root class="w-100 h-100 d-flex align-items-center justify-content-center p-4 text-secondary">No se pudo resolver la URL del documento.</div>';
      return;
    }

    const nombre = String(file?.nombre || '');
    const ext = (nombre.split('.').pop() || '').toLowerCase();
    const tipo = String(file?.tipo || '').toLowerCase();

    if (ext === 'glb' || ext === 'gltf') {
      const content = this.bodyEl.querySelector('[data-doc-preview-content]');
      if (!content) return;

      const root = this.bodyEl.querySelector('[data-doc-preview-root]');
      const loading = root?.querySelector?.('[data-doc-preview-loading]');
      if (loading) {
        const label = loading.querySelector?.('.text-secondary');
        if (label) label.textContent = 'Cargando modelo 3D...';
      }

      const container = document.createElement('div');
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.background = '#f8fafc';
      content.appendChild(container);

      try {
        const { init3DViewer } = await import('./viewer3D.js');
        const instance = await init3DViewer({
          container,
          url,
          onStart: () => {
            const rootNow = this.bodyEl?.querySelector?.('[data-doc-preview-root]');
            const loadingNow = rootNow?.querySelector?.('[data-doc-preview-loading]');
            if (loadingNow) {
              const labelNow = loadingNow.querySelector?.('.text-secondary');
              if (labelNow) labelNow.textContent = 'Cargando modelo 3D...';
            }
          },
          onLoaded: () => this._markLoaded(),
          onError: (err) => {
            console.error('3D load error:', err);
            const msg = err?.userMessage || 'No se pudo cargar el modelo 3D.';
            const dlBtnHtml = state.userRole === 'admin' ? '<button type="button" class="btn btn-outline-primary" data-doc-download-now>Descargar archivo</button>' : '';
            this.bodyEl.innerHTML = `
              <div data-doc-preview-root class="w-100 h-100 d-flex flex-column align-items-center justify-content-center p-4 text-center">
                <div class="text-secondary mb-2">${escapeHtml(msg)}</div>
                ${dlBtnHtml}
              </div>
            `.trim();
            const dlBtn = this.bodyEl.querySelector('[data-doc-download-now]');
            dlBtn?.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              this.btnDownload?.click();
            }, { once: true });
          }
        });
        this._dispose3D = () => instance?.dispose?.();
      } catch (e) {
        console.error('3D init error:', e);
        const dlBtnHtml2 = state.userRole === 'admin' ? '<button type="button" class="btn btn-outline-primary" data-doc-download-now>Descargar archivo</button>' : '';
        this.bodyEl.innerHTML = `
          <div data-doc-preview-root class="w-100 h-100 d-flex flex-column align-items-center justify-content-center p-4 text-center">
            <div class="text-secondary mb-2">No se pudo inicializar el visor 3D.</div>
            ${dlBtnHtml2}
          </div>
        `.trim();
        const dlBtn = this.bodyEl.querySelector('[data-doc-download-now]');
        dlBtn?.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.btnDownload?.click();
        }, { once: true });
      }
      return;
    }

    if (tipo === 'pdf' || tipo === 'word' || tipo === 'ppt' || 
        ext === 'pdf' || ext === 'doc' || ext === 'docx' || ext === 'ppt' || ext === 'pptx') {
      const content = this.bodyEl.querySelector('[data-doc-preview-content]');
      if (!content) return;

      const iframe = document.createElement('iframe');
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = '0';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
      iframe.onload = () => this._markLoaded();
      content.appendChild(iframe);
      iframe.src = `https://docs.google.com/viewerng/viewer?embedded=true&url=${encodeURIComponent(url)}`;
      return;
    }

    if (tipo === 'img' || ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'gif') {
      const img = document.createElement('img');
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      img.style.objectFit = 'contain';
      img.onload = () => this._markLoaded();
      img.src = url;
      const content = this.bodyEl.querySelector('[data-doc-preview-content]');
      if (content) {
        content.classList.add('d-flex', 'align-items-center', 'justify-content-center', 'bg-dark');
        content.appendChild(img);
      }
      return;
    }

    if (tipo === 'excel' || tipo === 'csv' || ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      const content = this.bodyEl.querySelector('[data-doc-preview-content]');
      if (!content) return;
      
      const isCSV = ext === 'csv';
      
      fetch(url)
        .then(res => res.arrayBuffer())
        .then(arrayBuffer => {
          let workbook;
          if (isCSV) {
            const text = new TextDecoder('utf-8').decode(arrayBuffer);
            workbook = XLSX.read(text, { type: 'string' });
          } else {
            workbook = XLSX.read(arrayBuffer, { type: 'array' });
          }
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const htmlTable = XLSX.utils.sheet_to_html(firstSheet, { id: 'excel-table-visor' });

          const container = document.createElement('div');
          container.style.cssText = `
            width:100%;height:100%;overflow:auto;background:var(--midnight-mid);padding:12px;
            font-family:'Inter',sans-serif;
          `;
          container.innerHTML = `
            <style>
              #excel-table-visor { border-collapse: collapse; width: 100%; font-size: 0.78rem; color: var(--text-primary); }
              #excel-table-visor th, #excel-table-visor td { border: 1px solid var(--border-subtle); padding: 6px 10px; text-align: left; white-space: nowrap; }
              #excel-table-visor th, #excel-table-visor tr:first-child td { background: var(--cyan-dim); color: var(--cyan); font-weight: 700; text-transform: uppercase; font-size: 0.7rem; position: sticky; top: 0; z-index: 1; }
              #excel-table-visor tr:nth-child(even) { background: rgba(255,255,255,0.03); }
              #excel-table-visor tr:hover { background: var(--surface-hover); }
            </style>
            ${htmlTable}
          `;
          content.appendChild(container);
          this._markLoaded();
        })
        .catch(err => {
          console.error('Error renderizando Excel/CSV en preview:', err);
          content.innerHTML = `
            <div class="w-100 h-100 d-flex flex-column align-items-center justify-content-center p-4 text-center">
              <i class="ph ph-warning" style="font-size:3rem;margin-bottom:1rem;color:var(--amber);"></i>
              <div class="text-secondary mb-2">Error al renderizar el archivo. Descárguelo para verlo.</div>
            </div>`;
          this._markLoaded();
        });
      return;
    }

    const dlBtnNative = state.userRole === 'admin' ? '<button type="button" class="btn btn-primary" data-doc-download-now>Descargar archivo</button>' : '<div class="text-muted" style="font-size:0.8rem;margin-top:8px;">Contacte al administrador para obtener este archivo.</div>';
    this.bodyEl.innerHTML = `
      <div data-doc-preview-root class="w-100 h-100 d-flex flex-column align-items-center justify-content-center p-4 text-center bg-dark">
        <div class="text-secondary mb-2">Este tipo de archivo requiere descarga para abrirse en un visor nativo.</div>
        ${dlBtnNative}
      </div>
    `.trim();

    const dlBtn = this.bodyEl.querySelector('[data-doc-download-now]');
    dlBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.btnDownload?.click();
    }, { once: true });
  }
}

let docViewerDelegationWired = false;
function setupDocViewerDelegationOnce() {
  if (docViewerDelegationWired) return;
  docViewerDelegationWired = true;

  document.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('[data-doc-view]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const raw = btn.getAttribute('data-doc-view');
    if (!raw) return;
    let file = null;
    try {
      file = JSON.parse(decodeURIComponent(raw));
    } catch (err) {
      console.error('Error parsing data-doc-view:', err);
      return;
    }
    DocPreviewModal.getInstance().open(file);
  }, true);

  document.addEventListener('click', async (e) => {
    const btn = e.target?.closest?.('[data-doc-download]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    // 🚫 Bloquear descarga para visitantes
    if (state.userRole !== 'admin') {
      console.warn('🚫 Descarga bloqueada: modo visitante');
      return;
    }

    const raw = btn.getAttribute('data-doc-download');
    if (!raw) return;
    let file = null;
    try {
      file = JSON.parse(decodeURIComponent(raw));
    } catch (err) {
      console.error('Error parsing data-doc-download:', err);
      return;
    }

    const modal = DocPreviewModal.getInstance();
    let url = null;
    try {
      url = await modal.resolveUrl(file);
    } catch (err) {
      console.error('Error resolving download URL:', err);
      return;
    }

    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.download = file?.nombre || '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, true);
}

const esqueletoCarpetas = {
  "01_Arquitectonico": { "Entregables PDF": {}, "Modelo 3D - SketchUP": {}, "Modelo BIM - Revit": {}, "Modelos 2D - AutoCAD": {}, "Varios": {} },
  "02_Estructural y Topografia": { "Estructurales": {}, "Topografia": {} },
  "03_Electricos y Red de Datos": { "Electricos": {}, "Redes de Datos": {} },
  "04_Hidrosanitarios y Gas": { "Gas": {}, "Hidrosanitarios": {} },
  "Intervenciones y Varios": {},
  "Matriz de Accesibilidad NTC 6047 2013": {},
  "Registro Fotografico Reconocimiento - 2026-1": {},
  "Renders y Presentaciones": { "Presentaciones": {}, "Renders": {} }
};

/**
 * Muestra la vista "Directorio General" y deselecciona el bloque.
 * @param {function(string): void} onBlockSelect - Callback al hacer clic en un bloque (desde la lista)
 */
export function initGlobalView(onBlockSelect) {
  state.currentBlockId = null;
  document.getElementById('detail-title').innerText = 'Sede Principal Pamplona';
  document.getElementById('detail-badge').innerText = 'Directorio General';
  document.getElementById('btn-open-upload')?.classList.add('hidden');
  document.getElementById('view-block').classList.add('hidden');
  document.getElementById('view-global').classList.remove('hidden');

  const floatingBlock = document.getElementById('map-floating-block');
  if (floatingBlock) {
    floatingBlock.classList.add('hidden');
  }

  hideBlockInfo();

  const list = document.getElementById('global-folder-list');
  list.innerHTML = '';
  const campusData = getCampusData();
  for (const [id, data] of Object.entries(campusData)) {
    if (data.coords && data.coords.length > 0) {
      const li = document.createElement('li');
      li.innerHTML = `<div class="dot" style="background-color: ${data.color}"></div><span class="name">${escapeHtml(data.name)}</span>`;
      li.onclick = () => onBlockSelect(id);
      list.appendChild(li);
    }
  }
}

function construirArbolHTML(estructura, rutaActual) {
  let html = '<ul class="ml-4 pl-3 mt-1 border-l border-slate-200 space-y-1">';
  let tieneContenido = false;

  for (const [nombre, subEstructura] of Object.entries(estructura)) {
    if (nombre === '_archivos') continue;
    tieneContenido = true;
    html += `<li class="mt-1"><details class="group"><summary class="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-md cursor-pointer text-slate-700 text-sm font-semibold transition-colors"><i class="ph-bold ph-caret-right text-xs text-slate-400 group-open:rotate-90 transition-transform duration-200"></i><i class="ph-fill ph-folder text-lg text-blue-500 group-open:text-blue-600"></i><span>${escapeHtml(nombre)}</span></summary>`;
    html += construirArbolHTML(subEstructura, rutaActual + "/" + nombre);
    html += `</details></li>`;
  }

  if (estructura._archivos && estructura._archivos.length > 0) {
    tieneContenido = true;
    estructura._archivos.forEach(file => {
      let icono = "ph-file text-slate-400";
      let tColor = "text-slate-600";
      if (file.tipo === 'pdf') { icono = "ph-file-pdf text-red-500"; tColor = "text-red-700"; }
      else if (file.tipo === 'dwg') { icono = "ph-pencil-ruler text-blue-600"; tColor = "text-blue-800"; }
      else if (file.tipo === 'skp') { icono = "ph-cube text-violet-600"; tColor = "text-violet-800"; }
      else if (file.tipo === 'rvt') { icono = "ph-cube text-cyan-600"; tColor = "text-cyan-800"; }
      else if (file.tipo === 'ifc') { icono = "ph-cube text-amber-600"; tColor = "text-amber-800"; }
      else if (file.tipo === 'excel') { icono = "ph-file-xls text-emerald-600"; tColor = "text-emerald-800"; }
      else if (file.tipo === 'img') { icono = "ph-image text-purple-500"; tColor = "text-purple-700"; }
      const fileJson = encodeURIComponent(JSON.stringify(file));
      html += `<li><div data-open-viewer="${fileJson}" class="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-100 rounded-md cursor-pointer ${tColor} text-sm group border border-transparent hover:border-slate-200 shadow-sm bg-white"><i class="ph-fill ${icono} text-xl opacity-90 group-hover:scale-110 transition-transform"></i><span class="font-medium truncate">${escapeHtml(file.nombre)}</span></div></li>`;
    });
  }
  if (!tieneContenido) html += `<li><div class="px-2 py-1 text-xs text-slate-400 italic flex items-center gap-1"><i class="ph ph-folder-dashed"></i> Carpeta vacía</div></li>`;
  html += '</ul>';
  return html;
}

/**
 * Crea el HTML para un ítem de archivo individual
 * @param {Object} archivo - Datos del archivo
 * @returns {string} HTML del ítem
 */
function crearArchivoItem(archivo) {
  const icono = getIconoPorTipo(archivo.tipo);
  const color = getColorPorTipo(archivo.tipo);
  const fecha = new Date(archivo.fechaCreacion?.toDate?.() || archivo.fechaCreacion);
  const fechaFormateada = fecha.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  const tamaño = formatFileSize(archivo.tamaño || 0);
  const fileJson = encodeURIComponent(JSON.stringify(archivo));

  return `
    <li>
      <div data-open-viewer="${fileJson}" class="flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors group" style="background:var(--glass-bg); border:1px solid transparent;" onmouseover="this.style.borderColor='var(--border-active)'; this.style.background='var(--surface-active)';" onmouseout="this.style.borderColor='transparent'; this.style.background='var(--glass-bg)';">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <i class="ph-fill ${icono}" style="color:var(--${color === 'amber' ? 'amber' : color === 'red' ? 'pink' : color === 'emerald' ? 'green' : 'cyan'}); font-size:1.2rem;"></i>
          <span class="text-sm font-medium truncate" style="color:var(--text-primary);">${escapeHtml(archivo.nombre)}</span>
        </div>
        <div class="flex items-center gap-3 text-xs" style="color:var(--text-muted);">
          <span>${escapeHtml(tamaño)}</span>
          ${state.userRole === 'admin' ? `<button data-doc-download="${fileJson}" class="btn-visor-action" style="padding:4px; font-size:0.9rem; background:none; border:none; color:var(--text-secondary); cursor:pointer;" title="Descargar" onmouseover="this.style.color='var(--cyan)';" onmouseout="this.style.color='var(--text-secondary)';">
             <i class="ph ph-cloud-arrow-down"></i>
          </button>` : ''}
        </div>
      </div>
    </li>
  `;
}

/**
 * Genera el árbol de carpetas y archivos del bloque actual.
 * Mejorado con búsqueda inteligente, filtros y organización avanzada.
 */
export function generarArbolDirectorios(archivos, containerEl) {
  const arbolContainer = containerEl || document.getElementById('arbol-carpetas-iser');
  if (!arbolContainer) return;

  setupDocViewerDelegationOnce();

  // Agregar barra de búsqueda y filtros
  const searchAndFilterHTML = `
    <div class="mb-4">
      <!-- Barra de búsqueda -->
      <div class="search-bar mb-3">
        <i class="ph ph-magnifying-glass search-icon"></i>
        <input type="text" class="search-input" id="file-search" placeholder="Buscar archivos...">
      </div>
      
      <!-- Filtros rápidos -->
      <div class="filter-tags" id="filter-tags">
        <button class="filter-tag active" data-filter="all">Todos</button>
        <button class="filter-tag" data-filter="pdf">PDF</button>
        <button class="filter-tag" data-filter="dwg">AutoCAD</button>
        <button class="filter-tag" data-filter="skp">SketchUp</button>
        <button class="filter-tag" data-filter="rvt">Revit</button>
        <button class="filter-tag" data-filter="ifc">IFC</button>
        <button class="filter-tag" data-filter="excel">Excel</button>
        <button class="filter-tag" data-filter="img">Imágenes</button>
      </div>
    </div>
  `;

  // Agrupar archivos por carpetas
  const porCarpeta = {};
  archivos.forEach(archivo => {
    const carpeta = archivo.carpeta || 'Sin Categoría';
    if (!porCarpeta[carpeta]) porCarpeta[carpeta] = [];
    porCarpeta[carpeta].push(archivo);
  });

  // Ordenar carpetas alfabéticamente
  const carpetasOrdenadas = Object.keys(porCarpeta).sort();

  // Generar HTML del árbol
  let arbolHTML = searchAndFilterHTML;
  arbolHTML += '<ul class="tree space-y-2" id="files-tree">';

  carpetasOrdenadas.forEach(carpeta => {
    const archivosCarpeta = porCarpeta[carpeta];
    const archivosOrdenados = archivosCarpeta.sort((a, b) =>
      new Date(b.fechaCreacion?.toDate?.() || b.fechaCreacion) -
      new Date(a.fechaCreacion?.toDate?.() || a.fechaCreacion)
    );

    arbolHTML += `
      <li class="folder-node">
        <details>
          <summary class="flex items-center gap-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors outline-none" style="background:var(--midnight-mid); border: 1px solid var(--border-subtle); color:var(--text-primary);">
            <i class="ph-fill ph-folder" style="color:var(--cyan);"></i>
            <span class="font-medium" style="font-size:0.85rem;">${escapeHtml(carpeta)}</span>
            <span class="text-xs px-2 py-1 rounded-full" style="background:var(--cyan-dim); color:var(--cyan); margin-left:auto;">${archivosCarpeta.length}</span>
          </summary>
          <ul class="ml-4 mt-2 space-y-1 mb-2 pl-2" style="border-left: 1px solid var(--border-subtle);">
            ${archivosOrdenados.map(archivo => crearArchivoItem(archivo)).join('')}
          </ul>
        </details>
      </li>
    `;
  });

  arbolHTML += '</ul>';

  // Vista de grid opcional
  arbolHTML += `
    <div class="hidden" id="files-grid-view">
      <div class="file-grid">
        ${archivos.map(archivo => crearArchivoCard(archivo)).join('')}
      </div>
    </div>
  `;

  // Toggle entre vista de árbol y grid
  arbolHTML += `
    <div class="flex justify-end mt-4 gap-2">
      <button id="toggle-view-tree" class="px-3 py-1 bg-blue-100 text-blue-700 rounded-md text-sm font-medium">
        <i class="ph ph-list-bullets mr-1"></i>Árbol
      </button>
      <button id="toggle-view-grid" class="px-3 py-1 bg-slate-100 text-slate-700 rounded-md text-sm font-medium">
        <i class="ph ph-grid-four mr-1"></i>Grid
      </button>
    </div>
  `;

  arbolContainer.innerHTML = arbolHTML;

  // Configurar eventos de búsqueda y filtros
  setupSearchAndFilters(archivos);

  // Configurar toggle de vistas
  setupViewToggle();

  // Configurar delegación para abrir el visor (importante para que funcione el clic en archivos)
  setupViewerDelegation(arbolContainer, (file) => {
    // Importar dinámicamente para evitar circular dependencies
    import('./visor.js').then(({ openViewer }) => {
      openViewer(file);
    }).catch(err => {
      console.error('Error cargando visor:', err);
    });
  });
  setupDeleteDelegation(arbolContainer);
}

/**
 * Crea una tarjeta de archivo para la vista grid
 */
function crearArchivoCard(archivo) {
  const icono = getIconoPorTipo(archivo.tipo);
  const color = getColorPorTipo(archivo.tipo);
  const fecha = new Date(archivo.fechaCreacion?.toDate?.() || archivo.fechaCreacion);
  const fechaFormateada = fecha.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  const tamaño = formatFileSize(archivo.tamaño || 0);

  const safeId = escapeHtml(String(archivo.id ?? ''));
  const safeTipo = escapeHtml(String(archivo.tipo ?? ''));
  const safeNombre = escapeHtml(archivo.nombre);
  const urlJs = JSON.stringify(archivo.url || '');
  return `
    <div class="file-card" data-file-id="${safeId}" data-file-type="${safeTipo}">
      <div class="file-card-header">
        <div class="file-card-icon ${color}">
          <i class="ph ${icono}"></i>
        </div>
        <div class="file-card-title" title="${safeNombre}">${safeNombre}</div>
      </div>
      <div class="file-card-meta">
        <span>${escapeHtml(fechaFormateada)}</span>
        <span>${escapeHtml(tamaño)}</span>
      </div>
      <div class="file-card-actions">
        <button class="file-action-btn" title="Ver archivo" data-open-viewer='${encodeURIComponent(JSON.stringify(archivo))}'>
          <i class="ph ph-eye"></i>
        </button>
        ${state.userRole === 'admin' ? `<button class="file-action-btn" title="Descargar" onclick="window.open(${urlJs}, '_blank')">
          <i class="ph ph-download"></i>
        </button>` : ''}
      </div>
    </div>
  `;
}

function getIconoPorTipo(tipo) {
  if (tipo === 'pdf') return 'ph-file-pdf';
  if (tipo === 'dwg') return 'ph-pencil-ruler';
  if (tipo === 'skp') return 'ph-cube';
  if (tipo === 'rvt') return 'ph-cube';
  if (tipo === 'ifc') return 'ph-cube';
  if (tipo === 'excel') return 'ph-file-xls';
  if (tipo === 'img') return 'ph-image';
  return 'ph-file';
}

function getColorPorTipo(tipo) {
  if (tipo === 'pdf') return 'text-red-600 bg-red-50';
  if (tipo === 'dwg') return 'text-blue-700 bg-blue-50';
  if (tipo === 'skp') return 'text-violet-700 bg-violet-50';
  if (tipo === 'rvt') return 'text-cyan-700 bg-cyan-50';
  if (tipo === 'ifc') return 'text-amber-700 bg-amber-50';
  if (tipo === 'excel') return 'text-emerald-700 bg-emerald-50';
  if (tipo === 'img') return 'text-purple-700 bg-purple-50';
  return 'text-slate-600 bg-slate-50';
}

/**
 * Configura la búsqueda y filtros inteligentes
 */
function setupSearchAndFilters(archivos) {
  const searchInput = document.getElementById('file-search');
  const filterTags = document.getElementById('filter-tags');
  const filesTree = document.getElementById('files-tree');
  const filesGrid = document.getElementById('files-grid-view');

  if (!searchInput || !filterTags) return;

  let currentFilter = 'all';
  let searchTerm = '';

  // Evento de búsqueda
  searchInput.addEventListener('input', (e) => {
    searchTerm = e.target.value.toLowerCase();
    filterAndDisplayFiles();
  });

  // Eventos de filtros
  filterTags.addEventListener('click', (e) => {
    if (e.target.classList.contains('filter-tag')) {
      // Actualizar estado activo
      filterTags.querySelectorAll('.filter-tag').forEach(tag => {
        tag.classList.remove('active');
      });
      e.target.classList.add('active');

      currentFilter = e.target.dataset.filter;
      filterAndDisplayFiles();
    }
  });

  /**
   * Filtra y muestra archivos según búsqueda y filtros
   */
  function filterAndDisplayFiles() {
    const filteredFiles = archivos.filter(archivo => {
      const matchesSearch = !searchTerm ||
        archivo.nombre.toLowerCase().includes(searchTerm) ||
        (archivo.carpeta || '').toLowerCase().includes(searchTerm);

      const matchesFilter = currentFilter === 'all' || archivo.tipo === currentFilter;

      return matchesSearch && matchesFilter;
    });

    // Actualizar vista de árbol
    updateTreeView(filteredFiles);

    // Actualizar vista de grid
    updateGridView(filteredFiles);
  }

  /**
   * Actualiza la vista de árbol con archivos filtrados
   */
  function updateTreeView(filteredFiles) {
    if (!filesTree) return;

    // Agrupar archivos filtrados por carpetas
    const porCarpeta = {};
    filteredFiles.forEach(archivo => {
      const carpeta = archivo.carpeta || 'Sin Categoría';
      if (!porCarpeta[carpeta]) porCarpeta[carpeta] = [];
      porCarpeta[carpeta].push(archivo);
    });

    // Si no hay resultados
    if (filteredFiles.length === 0) {
      filesTree.innerHTML = `
        <li class="text-center py-8 text-slate-500">
          <i class="ph ph-magnifying-glass text-4xl mb-2"></i>
          <p>No se encontraron archivos</p>
        </li>
      `;
      return;
    }

    // Generar HTML del árbol filtrado
    let treeHTML = '';
    const carpetasOrdenadas = Object.keys(porCarpeta).sort();

    carpetasOrdenadas.forEach(carpeta => {
      const archivosCarpeta = porCarpeta[carpeta];
      const archivosOrdenados = archivosCarpeta.sort((a, b) =>
        new Date(b.fechaCreacion?.toDate?.() || b.fechaCreacion) -
        new Date(a.fechaCreacion?.toDate?.() || a.fechaCreacion)
      );

      treeHTML += `
        <li class="folder-node">
          <details open>
            <summary class="flex items-center gap-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors">
              <i class="ph ph-folder text-amber-500"></i>
              <span class="font-medium text-slate-700">${escapeHtml(carpeta)}</span>
              <span class="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">${archivosCarpeta.length}</span>
            </summary>
            <ul class="ml-4 mt-1 space-y-1">
              ${archivosOrdenados.map(archivo => crearArchivoItem(archivo)).join('')}
            </ul>
          </details>
        </li>
      `;
    });

    filesTree.innerHTML = treeHTML;

    // Re-configurar delegación del visor para los nuevos elementos
    setupViewerDelegation(filesTree, (file) => {
      import('./visor.js').then(({ openViewer }) => {
        openViewer(file);
      }).catch(err => {
        console.error('Error cargando visor:', err);
      });
    });
    setupDeleteDelegation(filesTree);
  }

  /**
   * Actualiza la vista de grid con archivos filtrados
   */
  function updateGridView(filteredFiles) {
    if (!filesGrid) return;

    if (filteredFiles.length === 0) {
      filesGrid.innerHTML = `
        <div class="text-center py-8 text-slate-500 col-span-full">
          <i class="ph ph-magnifying-glass text-4xl mb-2"></i>
          <p>No se encontraron archivos</p>
        </div>
      `;
      return;
    }

    const gridHTML = `
      <div class="file-grid">
        ${filteredFiles.map(archivo => crearArchivoCard(archivo)).join('')}
      </div>
    `;

    filesGrid.innerHTML = gridHTML;

    // Re-configurar delegación del visor para los nuevos elementos
    setupViewerDelegation(filesGrid, (file) => {
      import('./visor.js').then(({ openViewer }) => {
        openViewer(file);
      }).catch(err => {
        console.error('Error cargando visor:', err);
      });
    });
    setupDeleteDelegation(filesGrid);
  }
}

/**
 * Configura el toggle entre vista de árbol y grid
 */
function setupViewToggle() {
  const treeView = document.getElementById('files-tree');
  const gridView = document.getElementById('files-grid-view');
  const treeBtn = document.getElementById('toggle-view-tree');
  const gridBtn = document.getElementById('toggle-view-grid');

  if (!treeView || !gridView || !treeBtn || !gridBtn) return;

  treeBtn.addEventListener('click', () => {
    treeView.classList.remove('hidden');
    gridView.classList.add('hidden');

    treeBtn.classList.add('bg-blue-100', 'text-blue-700');
    treeBtn.classList.remove('bg-slate-100', 'text-slate-700');

    gridBtn.classList.add('bg-slate-100', 'text-slate-700');
    gridBtn.classList.remove('bg-blue-100', 'text-blue-700');
  });

  gridBtn.addEventListener('click', () => {
    treeView.classList.add('hidden');
    gridView.classList.remove('hidden');

    gridBtn.classList.add('bg-blue-100', 'text-blue-700');
    gridBtn.classList.remove('bg-slate-100', 'text-slate-700');

    treeBtn.classList.add('bg-slate-100', 'text-slate-700');
    treeBtn.classList.remove('bg-blue-100', 'text-blue-700');
  });
}

/**
 * Formatea el tamaño del archivo
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
/**
 * Muestra la vista de un bloque seleccionado (título, badge, árbol, información).
 * Mejorado con estructura profesional de planoteca ISER
 * @param {string} id - ID del bloque
 * @param {function(string): string} getArbolHTML - Función que devuelve el HTML del árbol para un bloqueId
 */
export function showBlockView(id, getArbolHTML) {
  const campusData = getCampusData();
  state.currentBlockId = id;
  document.getElementById('detail-title').innerText = campusData[id].name;
  document.getElementById('detail-badge').innerText = 'Bloque Seleccionado';

  const floatingBlock = document.getElementById('map-floating-block');
  if (floatingBlock) {
    floatingBlock.classList.remove('hidden');
    floatingBlock.querySelector('.title').innerText = campusData[id].name;
    floatingBlock.querySelector('.badge').innerText = 'Bloque Seleccionado';
  }

  // Only show upload button for admins
  if (state.userRole === 'admin') {
    document.getElementById('btn-open-upload')?.classList.remove('hidden');
  }

  document.getElementById('view-global').classList.add('hidden');
  document.getElementById('view-block').classList.remove('hidden');

  // Generar el menú profesional de planoteca para este bloque
  const arbolContainer = document.getElementById('arbol-carpetas-iser');
  arbolContainer.innerHTML = generarMenuPlanoteca(id);

  // Configurar evento para cuando se selecciona una subcarpeta
  // Fix: remover handler anterior para evitar leak de event listeners
  if (_subcarpetaHandler) {
    document.removeEventListener('subcarpetaSeleccionada', _subcarpetaHandler);
  }
  _subcarpetaHandler = handleSubcarpetaSeleccionada;
  document.addEventListener('subcarpetaSeleccionada', _subcarpetaHandler);



  showBlockInfo(id);
}

/**
 * Maneja la selección de una subcarpeta de la planoteca
 * @param {CustomEvent} event - Evento con la ruta y nombre de la subcarpeta
 */
function handleSubcarpetaSeleccionada(event) {
  const { ruta, nombre } = event.detail;

  Logger.debug('handleSubcarpetaSeleccionada llamado:', { ruta, nombre });

  // Actualizar el uploader jerárquico (L1/L2/L3) con la ruta seleccionada
  const parts = (ruta || '').split('/').filter(Boolean);
  const l1 = parts[0] || '';
  const l2 = parts[1] || '';
  const l3 = parts[2] || '';

  const selectL1 = document.getElementById('up-folder-l1');
  const selectL2 = document.getElementById('up-folder-l2');
  const selectL3 = document.getElementById('up-folder-l3');
  const hidden = document.getElementById('up-folder');

  if (selectL1) {
    selectL1.value = l1;
    selectL1.dispatchEvent(new Event('change'));
  }

  if (selectL2 && l2) {
    selectL2.value = l2;
    selectL2.dispatchEvent(new Event('change'));
  }

  if (selectL3 && l3) {
    selectL3.value = l3;
    selectL3.dispatchEvent(new Event('change'));
  }

  if (hidden) {
    hidden.value = ruta;
  }

  // Mostrar notificación
  const fileManager = window.getFileManager?.();
  if (fileManager) {
    fileManager.showNotification(`Carpeta seleccionada: ${nombre}`, 'info');
  }

  // Actualizar UI para mostrar que está seleccionada
  actualizarSubcarpetaActiva(ruta);

  Logger.debug('Estado actual:', {
    currentBlockId: state?.currentBlockId,
    archivosNubeCount: state?.archivosNube?.length || 0,
    archivosNube: state?.archivosNube?.slice(0, 3)
  });

  const viewBlock = document.getElementById('view-block');
  if (!viewBlock) {
    console.error('❌ No se encontró view-block');
    return;
  }

  // Find the exact subfolder container using the emitted path
  const safeId = ruta.replace(/\\/g, '/').replace(/[^a-zA-Z0-9]/g, '_');
  let containerId = `subcarpeta-container-${safeId}`;

  // If it's a direct route (like Matriz Accesibilidad), it matches the exact ID
  if (!ruta.includes('/')) {
    containerId = `subcarpeta-container-${ruta}`;
  }

  const inSituContainer = document.getElementById(containerId);
  if (!inSituContainer) {
    console.error(`❌ No se encontró el contenedor in-situ para ruta: ${ruta} (ID esperado: ${containerId})`);
    return;
  }

  // Limpiar contenedores anteriores activos
  document.querySelectorAll('[id^="subcarpeta-container-"]').forEach(el => {
    if (el.id !== containerId) {
      el.innerHTML = '';
    }
  });

  inSituContainer.innerHTML = `
    <div class="mt-2 mb-4 p-3 border border-slate-200 rounded-lg bg-white shadow-sm animate-fadeIn">
      <div class="flex items-center justify-between gap-3 mb-3 border-b border-slate-100 pb-2">
        <h4 class="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
          <i class="ph ph-files text-blue-500"></i>
          Archivos
        </h4>
        <span id="planoteca-ruta-badge-${safeId}" class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">Cargando...</span>
      </div>
      <div id="planoteca-ruta-lista-${safeId}" class="w-full"></div>
    </div>
  `;

  const listContainer = document.getElementById(`planoteca-ruta-lista-${safeId}`);
  const badgeContainer = document.getElementById(`planoteca-ruta-badge-${safeId}`);

  if (listContainer) {
    listContainer.innerHTML = '<div class="text-sm text-slate-500 italic p-4 text-center">Buscando documentos...</div>';

    const fileManager = window.getFileManager?.();
    if (fileManager) {
      setTimeout(() => {
        fileManager.renderFilesList(ruta, listContainer, badgeContainer);
        // Fix: wire viewer delegation for in-situ file list items (data-open-viewer)
        setupViewerDelegation(inSituContainer, (file) => {
          import('./visor.js').then(({ openViewer }) => openViewer(file))
            .catch(err => console.error('Error cargando visor:', err));
        });
        setupDeleteDelegation(inSituContainer);
      }, 50);
    } else {
      listContainer.innerHTML = '<div class="text-sm text-red-500 p-2">Error: FileManager no disponible</div>';
    }
  }
}

/**
 * Actualiza visualmente la subcarpeta activa
 * @param {string} ruta - Ruta de la subcarpeta activa
 */
function actualizarSubcarpetaActiva(ruta) {
  // Remover clases activas anteriores
  document.querySelectorAll('.subcarpeta-activa').forEach(el => {
    el.classList.remove('subcarpeta-activa', 'bg-blue-50', 'border-blue-300');
  });

  // Agregar clase activa a la selección actual
  const subcarpetaActiva = document.querySelector(`[onclick*="${ruta}"]`);
  if (subcarpetaActiva) {
    subcarpetaActiva.classList.add('subcarpeta-activa', 'bg-blue-50', 'border-blue-300');
  }
}

/**
 * Muestra la información detallada del bloque en la sección de información.
 * @param {string} id - ID del bloque
 */
export function showBlockInfo(id) {
  const campusData = getCampusData();
  const blockData = campusData[id];

  if (!blockData || !blockData.info) {
    console.warn('No hay información disponible para el bloque:', id);
    return;
  }

  // Mostrar sección de información
  document.getElementById('block-info').classList.remove('hidden');

  // Actualizar datos
  document.getElementById('block-area').textContent = `${blockData.info.area.toFixed(2)} m²`;
  document.getElementById('block-rooms').textContent = blockData.info.rooms;
  document.getElementById('block-construction').textContent = blockData.info.construction;
  document.getElementById('block-roof').textContent = blockData.info.roof;

  ensureBlockPreviewUI();
  wireBlockPreviewEvents();
  blockPreviewLastBlockId = id;
  setBlockPreviewActive(blockPreviewActiveTab);
  renderBlockPreviewForTab(id, blockPreviewActiveTab);
}

/**
 * Oculta la sección de información del bloque.
 */
export function hideBlockInfo() {
  disposeBlock3DPreview();
  document.getElementById('block-info').classList.add('hidden');
}

/**
 * Abre el modal para editar información del bloque.
 * @param {string} id - ID del bloque
 */
export function openBlockEditModal(id) {
  const campusData = getCampusData();
  const blockData = campusData[id];

  if (!blockData || !blockData.info) {
    console.warn('No hay información disponible para el bloque:', id);
    return;
  }

  // Guardar ID del bloque actual
  state.editingBlockId = id;

  // Llenar formulario con datos actuales
  document.getElementById('edit-block-name').value = blockData.name;
  document.getElementById('edit-block-area').value = blockData.info.area;
  document.getElementById('edit-block-rooms').value = blockData.info.rooms;
  document.getElementById('edit-block-construction').value = blockData.info.construction;
  document.getElementById('edit-block-roof').value = blockData.info.roof;

  // Mostrar modal
  document.getElementById('block-edit-modal').classList.add('activo');
}

/**
 * Cierra el modal de edición de bloque.
 */
export function closeBlockEditModal() {
  document.getElementById('block-edit-modal').classList.remove('activo');
  state.editingBlockId = null;
}

/**
 * Guarda los cambios del bloque editado.
 * @param {object} formData - Datos del formulario
 */
export function saveBlockInfo(formData) {
  const campusData = getCampusData();
  const blockId = state.editingBlockId;

  if (!blockId || !campusData[blockId]) {
    console.error('No se puede guardar: bloque no encontrado');
    return false;
  }

  // Actualizar datos en campusData
  campusData[blockId].info = {
    area: parseFloat(formData.area),
    rooms: parseInt(formData.rooms),
    construction: formData.construction,
    roof: formData.roof
  };

  // Actualizar vista
  showBlockInfo(blockId);

  Logger.debug('Información del bloque actualizada:', blockId, campusData[blockId].info);
  return true;
}

/**
 * Delegación de clics en el árbol para abrir el visor.
 * Automatically collects sibling files for navigation arrow support.
 * @param {HTMLElement} container - Contenedor del árbol (arbol-carpetas-iser)
 * @param {function(object): void} openViewer - Recibe el objeto archivo
 * @param {function(Array): void} [setFileList] - Optional: sets the file list for navigation arrows
 */
export function setupViewerDelegation(container, openViewer, setFileList) {
  container.addEventListener('click', (e) => {
    // Don't open viewer if user clicked delete or download buttons
    if (e.target.closest('[data-delete-file]') || e.target.closest('[data-doc-download]')) return;

    const cell = e.target.closest('[data-open-viewer]');
    if (!cell) return;
    const fileJson = cell.getAttribute('data-open-viewer');
    if (fileJson) {
      try {
        const file = JSON.parse(decodeURIComponent(fileJson));

        // Collect all sibling files from the same container for navigation
        const allCells = container.querySelectorAll('[data-open-viewer]');
        const siblingFiles = [];
        allCells.forEach(c => {
          try {
            const raw = c.getAttribute('data-open-viewer');
            if (raw) siblingFiles.push(JSON.parse(decodeURIComponent(raw)));
          } catch { /* skip malformed */ }
        });

        // Set file list context for navigation arrows (sync if available)
        if (setFileList) {
          setFileList(siblingFiles);
        } else {
          // Fallback: async import (may race, but best-effort)
          import('./visor.js').then(({ setVisorFileList }) => {
            if (setVisorFileList) setVisorFileList(siblingFiles);
          }).catch(() => { /* noop */ });
        }

        openViewer(file);
      } catch (err) {
        console.error('Error abriendo visor:', err);
      }
    }
  });
}

/**
 * Delegación de clics para eliminar archivos desde la lista de BD.
 * Usa Firebase Storage deleteObject + Firestore deleteDoc.
 * @param {HTMLElement} container - Contenedor del árbol
 */
export function setupDeleteDelegation(container) {
  container.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('[data-delete-file]');
    if (!deleteBtn) return;

    // Prevent the click from bubbling to data-open-viewer
    e.stopPropagation();
    e.preventDefault();

    const fileJson = deleteBtn.getAttribute('data-delete-file');
    if (!fileJson) return;

    let file;
    try {
      file = JSON.parse(decodeURIComponent(fileJson));
    } catch (err) {
      console.error('Error parsing file data:', err);
      return;
    }

    const { showConfirmDelete } = await import('./visor.js');
    const confirmed = await showConfirmDelete(file.nombre);
    if (!confirmed) return;

    // Disable button during deletion
    deleteBtn.disabled = true;
    deleteBtn.style.opacity = '0.3';

    try {
      // Dynamic import to avoid circular dependencies
      const { ref, deleteObject } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js");
      const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
      const { storage, db } = await import('./services/firebase.js');
      const { dbPath } = await import('./core/config.js');

      // 1. Delete from Firebase Storage
      if (file.storagePath) {
        const fileRef = ref(storage, file.storagePath);
        await deleteObject(fileRef);
      }

      // 2. Delete Firestore document
      if (file.id) {
        const docRef = doc(db, dbPath, file.id);
        await deleteDoc(docRef);
      }

      // 3. Firestore onSnapshot will auto-refresh the file list
      Logger.info('Archivo eliminado desde BD:', file.nombre);

      // Show notification
      const fileManager = window.getFileManager?.();
      if (fileManager) {
        fileManager.showNotification(`"${file.nombre}" eliminado exitosamente`, 'success');
      }

    } catch (error) {
      console.error('❌ Error eliminando archivo:', error);
      alert('Error al eliminar el archivo: ' + error.message);
      deleteBtn.disabled = false;
      deleteBtn.style.opacity = '1';
    }
  });
}
