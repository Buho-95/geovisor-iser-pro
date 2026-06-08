/**
 * Módulo visor BIM IFC.
 * Usa web-ifc-viewer (Three.js + web-ifc) para renderizar modelos IFC en el navegador.
 * Carga lazy al abrir el primer archivo .ifc / .rvt.
 */
import { on, EVENTS } from '../../core/events.js';
import { Logger } from '../../core/logger.js';

const VIEWER_MODAL_ID = 'bim-viewer-modal';

// ── Crear modal la primera vez ──────────────────────────────────────────────
function ensureModal() {
  if (document.getElementById(VIEWER_MODAL_ID)) return;

  const modal = document.createElement('div');
  modal.id = VIEWER_MODAL_ID;
  modal.style.cssText = `
    display:none; position:fixed; inset:0; z-index:9100;
    background:rgba(0,0,0,0.92); flex-direction:column;
    align-items:center; justify-content:center;
  `;
  modal.innerHTML = `
    <div style="width:100%;max-width:1200px;height:90vh;display:flex;flex-direction:column;background:#1a1a2e;border-radius:12px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.6);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:#0d0d1f;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:10px;">
          <i class="ph ph-cube" style="font-size:1.3rem;color:#6ee7b7;"></i>
          <span id="bim-viewer-title" style="color:#e2e8f0;font-weight:600;font-size:0.95rem;">Visor BIM 3D</span>
        </div>
        <div style="display:flex;gap:8px;">
          <span id="bim-viewer-status" style="color:#94a3b8;font-size:0.75rem;padding:4px 10px;background:#1e293b;border-radius:20px;"></span>
          <button id="bim-viewer-close" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1.3rem;padding:4px 8px;" title="Cerrar">
            <i class="ph ph-x"></i>
          </button>
        </div>
      </div>
      <div id="bim-viewer-canvas-host" style="flex:1;position:relative;overflow:hidden;background:#0a0a1a;">
        <div id="bim-viewer-loading" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:#e2e8f0;">
          <div style="width:48px;height:48px;border:3px solid #1e293b;border-top-color:#6ee7b7;border-radius:50%;animation:bim-spin 0.8s linear infinite;"></div>
          <span style="font-size:0.9rem;">Cargando modelo IFC...</span>
          <span id="bim-progress-text" style="font-size:0.75rem;color:#64748b;"></span>
        </div>
        <canvas id="bim-viewer-canvas" style="width:100%;height:100%;display:block;"></canvas>
      </div>
      <div style="padding:8px 20px;background:#0d0d1f;flex-shrink:0;display:flex;gap:16px;align-items:center;">
        <button id="bim-btn-fit" style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:0.8rem;">
          <i class="ph ph-arrows-out"></i> Ajustar vista
        </button>
        <button id="bim-btn-wireframe" style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:0.8rem;">
          <i class="ph ph-polygon"></i> Wireframe
        </button>
        <span style="color:#475569;font-size:0.75rem;margin-left:auto;">Rueda: zoom · Click+arrastrar: orbitar · Click derecho: pan</span>
      </div>
    </div>
    <style>
      @keyframes bim-spin { to { transform: rotate(360deg); } }
    </style>
  `;
  document.body.appendChild(modal);

  document.getElementById('bim-viewer-close').addEventListener('click', closeBimViewer);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeBimViewer(); });
}

function closeBimViewer() {
  const modal = document.getElementById(VIEWER_MODAL_ID);
  if (modal) modal.style.display = 'none';
  // Liberar renderer Three.js
  if (window.__bimRenderer) {
    window.__bimRenderer.dispose();
    window.__bimRenderer = null;
  }
  if (window.__bimAnimFrame) {
    cancelAnimationFrame(window.__bimAnimFrame);
    window.__bimAnimFrame = null;
  }
}

// ── Carga Three.js + web-ifc y renderiza ────────────────────────────────────
async function loadAndRender(url, nombre) {
  const statusEl = document.getElementById('bim-viewer-status');
  const loadingEl = document.getElementById('bim-viewer-loading');
  const progressEl = document.getElementById('bim-progress-text');
  const canvas = document.getElementById('bim-viewer-canvas');
  const host = document.getElementById('bim-viewer-canvas-host');

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
    if (progressEl) progressEl.textContent = msg;
  }

  try {
    setStatus('Cargando Three.js...');

    // Importar Three.js (ya disponible en el import map del HTML)
    const THREE = await import('three');
    const { OrbitControls } = await import('https://cdn.jsdelivr.net/npm/three@0.135.0/examples/jsm/controls/OrbitControls.js');

    setStatus('Descargando modelo...');

    // Descargar el archivo IFC como ArrayBuffer
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();

    setStatus('Procesando IFC...');

    // Cargar web-ifc para parsear el modelo
    const { IfcAPI } = await import('https://cdn.jsdelivr.net/npm/web-ifc@0.0.76/web-ifc-api.js');
    const ifcApi = new IfcAPI();
    ifcApi.SetWasmPath('https://cdn.jsdelivr.net/npm/web-ifc@0.0.76/');
    await ifcApi.Init();

    const data = new Uint8Array(buffer);
    const modelID = ifcApi.OpenModel(data);

    setStatus('Construyendo geometría...');

    // ── Setup Three.js Scene ─────────────────────────────────────────────
    const W = host.clientWidth || 800;
    const H = host.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a1a);
    window.__bimRenderer = renderer;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 1000);
    camera.position.set(10, 10, 10);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // ── Extraer geometría del modelo IFC ──────────────────────────────
    const geometry = ifcApi.LoadAllGeometry(modelID);
    const meshGroup = new THREE.Group();
    let hasMeshes = false;

    for (let i = 0; i < geometry.size(); i++) {
      const placedGeom = geometry.get(i);
      const mesh = placedGeom.geometries;

      for (let j = 0; j < mesh.size(); j++) {
        const geomData = mesh.get(j);
        const threeGeom = new THREE.BufferGeometry();

        const vertices = geomData.GetVertexData();
        const indices = geomData.GetIndexData();

        threeGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices.buffer, vertices.byteOffset, vertices.length), 3));
        threeGeom.setIndex(new THREE.BufferAttribute(new Uint32Array(indices.buffer, indices.byteOffset, indices.length), 1));
        threeGeom.computeVertexNormals();

        const color = geomData.color;
        const material = new THREE.MeshPhongMaterial({
          color: new THREE.Color(color.x, color.y, color.z),
          opacity: color.w,
          transparent: color.w < 1,
          side: THREE.DoubleSide,
        });

        const matrix = placedGeom.flatTransformation;
        const threeMesh = new THREE.Mesh(threeGeom, material);
        threeMesh.matrix.fromArray(matrix.data);
        threeMesh.matrixAutoUpdate = false;
        meshGroup.add(threeMesh);
        hasMeshes = true;
      }
    }

    ifcApi.CloseModel(modelID);

    if (!hasMeshes) {
      setStatus('⚠️ Modelo sin geometría visible');
    } else {
      scene.add(meshGroup);

      // Centrar cámara al modelo
      const box = new THREE.Box3().setFromObject(meshGroup);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      camera.position.copy(center).add(new THREE.Vector3(size, size, size));
      controls.target.copy(center);
      controls.update();

      setStatus(`✓ ${nombre}`);
    }

    // Ocultar loading
    if (loadingEl) loadingEl.style.display = 'none';

    // ── Render loop ───────────────────────────────────────────────────
    function animate() {
      window.__bimAnimFrame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    const resizeObserver = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(host);

    // ── Botones de control ────────────────────────────────────────────
    document.getElementById('bim-btn-fit')?.addEventListener('click', () => {
      const box2 = new THREE.Box3().setFromObject(meshGroup);
      const c = box2.getCenter(new THREE.Vector3());
      const s = box2.getSize(new THREE.Vector3()).length();
      camera.position.copy(c).add(new THREE.Vector3(s, s, s));
      controls.target.copy(c);
      controls.update();
    });

    let wireframe = false;
    document.getElementById('bim-btn-wireframe')?.addEventListener('click', () => {
      wireframe = !wireframe;
      meshGroup.traverse(obj => {
        if (obj.isMesh) obj.material.wireframe = wireframe;
      });
    });

  } catch (err) {
    Logger.error('[BIM Viewer] Error cargando modelo:', err);
    if (loadingEl) {
      loadingEl.innerHTML = `
        <i class="ph ph-warning" style="font-size:2rem;color:#f97316;"></i>
        <span style="color:#f97316;font-weight:600;">Error al cargar el modelo IFC</span>
        <span style="color:#64748b;font-size:0.8rem;">${err.message}</span>
        <span style="color:#475569;font-size:0.75rem;max-width:400px;text-align:center;">
          Los modelos IFC requieren CORS habilitado en el bucket de Supabase Storage.
        </span>
      `;
    }
    setStatus('Error');
  }
}

// ── API Pública ──────────────────────────────────────────────────────────────

export function init() {
  on(EVENTS.VIEWER_OPEN, (file) => {
    if (file?.tipo === 'ifc' || file?.nombre?.toLowerCase().endsWith('.ifc')) {
      openBimViewer(file);
    }
  });
}

export async function openBimViewer(file) {
  if (!file?.url) {
    Logger.warn('[BIM Viewer] No se proporcionó URL del archivo');
    return;
  }

  ensureModal();
  const modal = document.getElementById(VIEWER_MODAL_ID);
  const titleEl = document.getElementById('bim-viewer-title');
  const loadingEl = document.getElementById('bim-viewer-loading');
  const canvas = document.getElementById('bim-viewer-canvas');

  // Reset estado
  if (titleEl) titleEl.textContent = file.nombre || 'Modelo IFC';
  if (loadingEl) {
    loadingEl.style.display = 'flex';
    loadingEl.innerHTML = `
      <div style="width:48px;height:48px;border:3px solid #1e293b;border-top-color:#6ee7b7;border-radius:50%;animation:bim-spin 0.8s linear infinite;"></div>
      <span style="font-size:0.9rem;color:#e2e8f0;">Cargando modelo IFC...</span>
      <span id="bim-progress-text" style="font-size:0.75rem;color:#64748b;"></span>
    `;
  }

  // Limpiar render anterior
  if (window.__bimRenderer) {
    window.__bimRenderer.dispose();
    window.__bimRenderer = null;
  }
  if (window.__bimAnimFrame) {
    cancelAnimationFrame(window.__bimAnimFrame);
    window.__bimAnimFrame = null;
  }
  if (canvas) {
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (ctx) ctx.clear(ctx.COLOR_BUFFER_BIT | ctx.DEPTH_BUFFER_BIT);
  }

  modal.style.display = 'flex';

  await loadAndRender(file.url, file.nombre || 'modelo.ifc');
}
