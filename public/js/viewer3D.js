let THREE_NS = null;
let GLTFLoaderCls = null;
let OrbitControlsCls = null;
let DRACOLoaderCls = null;
let MeshoptDecoderMod = null;

// Global references for dynamic relocation
export let globalRenderer = null;
export let globalCamera = null;

export function exportCanvasTo(targetContainerId) {
  const container = document.querySelector(targetContainerId);
  if (!container || !globalRenderer || !globalCamera) return;

  container.appendChild(globalRenderer.domElement);

  const w = container.clientWidth || 400;
  const h = container.clientHeight || 350;
  globalRenderer.setSize(w, h, false);
  globalCamera.aspect = w / h;
  globalCamera.updateProjectionMatrix();

  globalRenderer.domElement.style.display = 'block';
  globalRenderer.domElement.style.visibility = 'visible';
}

function detectBlockedByClient(err) {
  const msg = String(err?.message || err || '');
  return /ERR_BLOCKED_BY_CLIENT|blocked by client/i.test(msg);
}

function normalizeError(err) {
  if (detectBlockedByClient(err)) {
    const e = new Error('ERR_BLOCKED_BY_CLIENT');
    e.code = 'ERR_BLOCKED_BY_CLIENT';
    e.userMessage = 'Conexión bloqueada por el navegador. Por favor, desactiva tu AdBlocker para visualizar el modelo 3D.';
    return e;
  }
  return err instanceof Error ? err : new Error(String(err || 'Error desconocido'));
}

async function loadDeps() {
  if (THREE_NS && GLTFLoaderCls && OrbitControlsCls) return;
  try {
    const threeMod = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
    THREE_NS = threeMod;
    GLTFLoaderCls = GLTFLoader;
    OrbitControlsCls = OrbitControls;
    DRACOLoaderCls = DRACOLoader;
    MeshoptDecoderMod = MeshoptDecoder;
  } catch (e) {
    throw normalizeError(e);
  }
}

function disposeMaterial(mat) {
  if (!mat) return;
  const mats = Array.isArray(mat) ? mat : [mat];
  mats.forEach(m => {
    if (!m) return;
    Object.keys(m).forEach(k => {
      const v = m[k];
      if (v && typeof v === 'object' && v.isTexture) {
        try { v.dispose(); } catch { /* noop */ }
      }
    });
    try { m.dispose(); } catch { /* noop */ }
  });
}

function disposeObject3D(obj) {
  obj?.traverse?.(child => {
    if (child?.geometry) {
      try { child.geometry.dispose(); } catch { /* noop */ }
    }
    if (child?.material) disposeMaterial(child.material);
  });
}

function fitCameraToObject(THREE, camera, controls, object, margin = 1.25) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (camera.fov * Math.PI) / 180;
  let cameraZ = Math.abs((maxDim / 2) / Math.tan(fov / 2));
  cameraZ *= margin;

  camera.position.set(center.x + cameraZ, center.y + cameraZ * 0.35, center.z + cameraZ);
  camera.near = maxDim / 100;
  camera.far = maxDim * 200;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

/**
 * High-performance 3D viewer with DRACO & Meshopt decoder support.
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {string} opts.url
 * @param {function} [opts.onLoaded]
 * @param {function} [opts.onError]
 * @param {function} [opts.onStart]
 * @param {function} [opts.onProgress] - (percent: number) => void, 0-100
 */
export async function init3DViewer({ container, url, onLoaded, onError, onStart, onProgress }) {
  if (!container) throw new Error('3D container missing');
  try {
    await loadDeps();
  } catch (e) {
    throw normalizeError(e);
  }

  const THREE = THREE_NS;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50000);

  globalRenderer = renderer;
  globalCamera = camera;

  const ambient = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(10, 16, 12);
  scene.add(dir);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(-8, 4, -10);
  scene.add(fillLight);

  const controls = new OrbitControlsCls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minDistance = 0.01;

  container.innerHTML = '';
  container.style.position = 'relative';
  container.style.zIndex = '10'; // Ensure it's above backgrounds
  
  const canvas = renderer.domElement;
  canvas.style.position = 'relative';
  canvas.style.zIndex = '10';
  container.appendChild(canvas);

  let destroyed = false;
  let raf = 0;
  let modelRoot = null;

  const resize = () => {
    if (destroyed) return;
    const w = container.clientWidth || 400;
    const h = container.clientHeight || 350;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();

  // ── DRACO + Meshopt decoders ──
  const loader = new GLTFLoaderCls();

  if (DRACOLoaderCls) {
    const dracoLoader = new DRACOLoaderCls();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    dracoLoader.setDecoderConfig({ type: 'js' });
    dracoLoader.preload();
    loader.setDRACOLoader(dracoLoader);
  }

  if (MeshoptDecoderMod) {
    try {
      loader.setMeshoptDecoder(MeshoptDecoderMod);
    } catch { /* noop — may not be supported in all Three.js versions */ }
  }

  try {
    loader.setCrossOrigin?.('anonymous');
  } catch { /* noop */ }

  const animate = () => {
    if (destroyed) return;
    raf = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };

  const safeError = (e) => {
    const ne = normalizeError(e);
    try { onError?.(ne); } catch { /* noop */ }
  };

  let started = false;
  const safeStart = () => {
    if (started) return;
    started = true;
    try { onStart?.(); } catch { /* noop */ }
  };

  // ── 3D Control Panel (Glassmorphism) ──
  function createControlPanel() {
    // Remove any existing panel
    container.querySelectorAll('.viewer3d-ctrl-toggle, .viewer3d-panel').forEach(el => el.remove());

    // Toggle button (gear icon)
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'viewer3d-ctrl-toggle';
    toggleBtn.innerHTML = '⚙';
    toggleBtn.title = 'Controles 3D';

    // Panel
    const panel = document.createElement('div');
    panel.className = 'viewer3d-panel hidden';
    panel.innerHTML = `
      <div class="viewer3d-panel-header">
        <span>⚙ Controles 3D</span>
        <button class="viewer3d-panel-close" title="Cerrar">✕</button>
      </div>

      <div class="viewer3d-ctrl-row">
        <label>Auto-Rotación</label>
        <label class="viewer3d-switch">
          <input type="checkbox" data-ctrl="autorotate">
          <span class="slider"></span>
        </label>
      </div>

      <div class="viewer3d-ctrl-row">
        <label>Wireframe</label>
        <label class="viewer3d-switch">
          <input type="checkbox" data-ctrl="wireframe">
          <span class="slider"></span>
        </label>
      </div>

      <div class="viewer3d-section">
        <div class="viewer3d-ctrl-row" style="margin-bottom:2px;">
          <label>Exposición</label>
          <span style="font-size:0.62rem;color:rgba(255,255,255,0.45);" data-exposure-val>1.0</span>
        </div>
        <input type="range" class="viewer3d-range" data-ctrl="exposure" min="0.2" max="3.0" step="0.1" value="1.0">
      </div>

      <div class="viewer3d-section">
        <div class="viewer3d-ctrl-row" style="margin-bottom:4px;">
          <label>Fondo</label>
        </div>
        <div class="viewer3d-bg-swatches">
          <div class="viewer3d-bg-swatch" data-bg="light" title="Claro"></div>
          <div class="viewer3d-bg-swatch active" data-bg="dark" title="Oscuro"></div>
          <div class="viewer3d-bg-swatch" data-bg="green" title="Verde Institucional"></div>
        </div>
      </div>
    `;

    container.appendChild(toggleBtn);
    container.appendChild(panel);

    // Toggle open/close
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.remove('hidden');
      toggleBtn.style.display = 'none';
    });
    panel.querySelector('.viewer3d-panel-close').addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.add('hidden');
      toggleBtn.style.display = '';
    });

    // Prevent orbit controls from reacting to panel interactions
    panel.addEventListener('pointerdown', e => e.stopPropagation());
    panel.addEventListener('mousedown', e => e.stopPropagation());
    panel.addEventListener('wheel', e => e.stopPropagation());

    // ── Auto-Rotation ──
    const autoRotateInput = panel.querySelector('[data-ctrl="autorotate"]');
    autoRotateInput.addEventListener('change', () => {
      controls.autoRotate = autoRotateInput.checked;
      controls.autoRotateSpeed = 2.0;
    });

    // ── Wireframe ──
    const wireframeInput = panel.querySelector('[data-ctrl="wireframe"]');
    wireframeInput.addEventListener('change', () => {
      const isWire = wireframeInput.checked;
      scene.traverse(child => {
        if (child.isMesh && child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => { if (m) m.wireframe = isWire; });
        }
      });
    });

    // ── Exposure slider ──
    const exposureInput = panel.querySelector('[data-ctrl="exposure"]');
    const exposureVal = panel.querySelector('[data-exposure-val]');
    exposureInput.addEventListener('input', () => {
      const val = parseFloat(exposureInput.value);
      renderer.toneMappingExposure = val;
      if (exposureVal) exposureVal.textContent = val.toFixed(1);
      // Also scale ambient light
      ambient.intensity = 0.75 * val;
      dir.intensity = 1.1 * val;
    });

    // ── Background color swatches ──
    const bgColors = {
      light: { color: 0xf0f0f0, alpha: 1 },
      dark:  { color: 0x1a1a2e, alpha: 1 },
      green: { color: 0x2E7D32, alpha: 1 }
    };
    panel.querySelectorAll('.viewer3d-bg-swatch').forEach(swatch => {
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        const bg = swatch.getAttribute('data-bg');
        const c = bgColors[bg];
        if (!c) return;
        renderer.setClearColor(c.color, c.alpha);
        // Update active state
        panel.querySelectorAll('.viewer3d-bg-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
      });
    });

    // Set initial dark background
    renderer.setClearColor(0x1a1a2e, 1);
  }

  try {
    safeStart();
    loader.load(
      url,
      (gltf) => {
        if (destroyed) return;
        modelRoot = gltf.scene || gltf.scenes?.[0];
        if (modelRoot) {
          scene.add(modelRoot);
          fitCameraToObject(THREE, camera, controls, modelRoot);
        }
        try { onLoaded?.(); } catch { /* noop */ }
        animate();
        // ── Inject control panel after model loads ──
        try { createControlPanel(); } catch (e) { console.warn('Control panel error:', e); }
      },
      (xhr) => {
        safeStart();
        if (xhr.lengthComputable && onProgress) {
          const pct = Math.round((xhr.loaded / xhr.total) * 100);
          try { onProgress(pct); } catch { /* noop */ }
        }
      },
      (err) => {
        if (destroyed) return;
        safeError(err);
      }
    );
  } catch (e) {
    safeError(e);
  }

  const dispose = () => {
    if (destroyed) return;
    destroyed = true;
    try { cancelAnimationFrame(raf); } catch { /* noop */ }
    try { ro.disconnect(); } catch { /* noop */ }
    try { controls.dispose(); } catch { /* noop */ }

    if (modelRoot) {
      try { scene.remove(modelRoot); } catch { /* noop */ }
      disposeObject3D(modelRoot);
      modelRoot = null;
    }

    try { renderer.dispose(); } catch { /* noop */ }
    try {
      const canvas = renderer.domElement;
      canvas?.parentNode?.removeChild(canvas);
    } catch { /* noop */ }

    try {
      const ctx = renderer.getContext();
      const lose = ctx?.getExtension?.('WEBGL_lose_context');
      lose?.loseContext?.();
    } catch { /* noop */ }

    try { container.innerHTML = ''; } catch { /* noop */ }
  };

  return { dispose, scene, camera, renderer, controls };
}
