let THREE_NS = null;
let GLTFLoaderCls = null;
let OrbitControlsCls = null;
let DRACOLoaderCls = null;
let MeshoptDecoderMod = null;

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
  container.appendChild(renderer.domElement);

  let destroyed = false;
  let raf = 0;
  let modelRoot = null;

  const resize = () => {
    if (destroyed) return;
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
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
