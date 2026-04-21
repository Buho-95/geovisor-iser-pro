/**
 * env-validate.js — Validación de aislamiento de namespaces al arrancar.
 *
 * Comprueba que en staging todas las colecciones y rutas resuelven al prefijo
 * correcto. Si detecta inconsistencia, emite errores claros en consola y un
 * banner visual. No detiene la app (el usuario puede seguir) pero deja señal.
 *
 * En producción y development, simplemente registra información de contexto.
 */
import { ENV_MODE, isStaging, isProd } from './env.js';
import { COLLECTIONS, STORAGE_PATHS, COLLECTIONS_RAW, STORAGE_PATHS_RAW } from './constants.js';

export function validateEnvIsolation() {
  const issues = [];

  if (isStaging) {
    for (const [key, value] of Object.entries(COLLECTIONS)) {
      if (!value.startsWith('staging_')) {
        issues.push(`Firestore: COLLECTIONS.${key}="${value}" NO tiene prefijo staging_`);
      }
    }
    for (const [key, value] of Object.entries(STORAGE_PATHS)) {
      if (!value.startsWith('staging/')) {
        issues.push(`Storage: STORAGE_PATHS.${key}="${value}" NO tiene prefijo staging/`);
      }
    }
  } else {
    // En prod/dev, nada debe tener prefijo staging
    for (const [key, value] of Object.entries(COLLECTIONS)) {
      if (value.startsWith('staging_')) {
        issues.push(`Firestore: COLLECTIONS.${key}="${value}" tiene prefijo staging_ en ENV=${ENV_MODE}`);
      }
    }
    for (const [key, value] of Object.entries(STORAGE_PATHS)) {
      if (value.startsWith('staging/')) {
        issues.push(`Storage: STORAGE_PATHS.${key}="${value}" tiene prefijo staging/ en ENV=${ENV_MODE}`);
      }
    }
  }

  if (issues.length > 0) {
    console.error('❌ [env-validate] Inconsistencias de namespace detectadas:');
    issues.forEach((i) => console.error('   · ' + i));
    showInconsistencyBanner(issues);
    return { ok: false, issues };
  }

  console.log(
    `%c ✓ Namespace isolation OK %c ENV=${ENV_MODE}`,
    'background:#10B981;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px',
    'color:#64748b;padding:2px 6px'
  );
  console.table({
    Entorno: ENV_MODE,
    'archivos (raw)': COLLECTIONS_RAW.ARCHIVOS,
    'archivos (env)': COLLECTIONS.ARCHIVOS,
    'storage (raw)': STORAGE_PATHS_RAW.DOCUMENTOS,
    'storage (env)': STORAGE_PATHS.DOCUMENTOS,
  });

  if (!isProd) {
    console.log(
      '%c 💡 Para forzar otro entorno: ?env=staging en URL, o localStorage["__geovisor_env_override__"]="staging"',
      'color:#94a3b8;font-style:italic'
    );
  }

  return { ok: true, issues: [] };
}

function showInconsistencyBanner(issues) {
  if (typeof document === 'undefined') return;
  if (document.getElementById('env-inconsistency')) return;

  const el = document.createElement('div');
  el.id = 'env-inconsistency';
  el.style.cssText = [
    'position:fixed',
    'top:34px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:100001',
    'background:#7f1d1d',
    'color:#fff',
    'font-family:Inter,system-ui,sans-serif',
    'font-size:12px',
    'padding:10px 16px',
    'border-radius:6px',
    'box-shadow:0 6px 24px rgba(0,0,0,0.4)',
    'max-width:80vw',
  ].join(';');
  el.innerHTML = `
    <b>⚠ Inconsistencia de namespace (${issues.length})</b>
    <div style="margin-top:4px;font-weight:400;font-size:11px;opacity:0.9;">
      Revisa la consola para detalles. Las operaciones podrían tocar el entorno equivocado.
    </div>
  `;
  document.body.appendChild(el);
}
