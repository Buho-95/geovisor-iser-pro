/**
 * Servicio Firebase: inicialización de Auth, Firestore, Storage y App Check.
 *
 * Debug token de App Check: solo en localhost (desarrollo). En producción se usa
 * reCAPTCHA v3 sin token de depuración.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { initializeAppCheck, ReCaptchaV3Provider, getToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-check.js";
import { firebaseConfig } from '../core/config.js';
import { shouldUseEmulators, EMULATOR_PORTS, ENV } from '../core/env.js';
import { Logger } from '../core/logger.js';

// ═══════════════════════════════════════════════════════════════
// APP CHECK — DEBUG TOKEN EN DESARROLLO (fix 403)
// ───────────────────────────────────────────────────────────────
// Firebase lee la flag `self.FIREBASE_APPCHECK_DEBUG_TOKEN` en el
// momento de inicializarse. POR ESO debe asignarse ANTES de cualquier
// llamada a initializeApp() / initializeAppCheck(). Si se hace después
// (como estaba antes), Firebase ya ha cacheado el modo producción y
// bloquea las requests con 403 en Storage/Firestore.
//
// Se activa sólo en hostnames locales (desarrollo). En producción
// (Hosting real) el flag NUNCA se asigna y App Check funciona con
// el token real de reCAPTCHA.
//
// Opción de escape: si en localhost App Check sigue bloqueando, se
// puede saltar totalmente con:
//   localStorage.setItem('geovisor:disable-appcheck','1'); location.reload();
// ═══════════════════════════════════════════════════════════════
const host = typeof location !== 'undefined' ? location.hostname : '';
const isLocalDev =
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

let skipAppCheck = false;
try {
  skipAppCheck = isLocalDev
    && localStorage.getItem('geovisor:disable-appcheck') === '1';
} catch { /* localStorage puede fallar en contextos restringidos */ }

if (isLocalDev) {
  // Debe estar asignado ANTES de initializeApp (línea siguiente).
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  // eslint-disable-next-line no-console
  console.log(
    '%c[Firebase] App Check debug activo',
    'background:#16a34a;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold',
    '(localhost) — registra el token que imprime Firebase en Console → App Check → Apps → Debug tokens.'
  );
}

const app = initializeApp(firebaseConfig);

// ⚠️ Reemplaza con tu clave real de ReCAPTCHA v3 (solo usada en producción).
// Cuando debug token está activo, Firebase ignora la clave de sitio.
// Obtenla en: https://www.google.com/recaptcha/admin
const RECAPTCHA_SITE_KEY = '6LdYAJMsAAAAAPhabJ2yXRSq_M-3WxfCiYJcypUe';

let appCheckInstance = null;
if (skipAppCheck) {
  Logger.warn('⚠️ App Check DESACTIVADO manualmente en desarrollo (flag localStorage).');
  // eslint-disable-next-line no-console
  console.warn('[Firebase] App Check omitido por flag geovisor:disable-appcheck=1');
} else if (!shouldUseEmulators) {
  try {
    appCheckInstance = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
    Logger.info('✅ Firebase App Check inicializado.');
  } catch (e) {
    Logger.warn('⚠️ App Check no pudo inicializarse:', e.message);
  }
} else {
  Logger.info('🧪 App Check omitido (modo emuladores).');
}

// ── Detección proactiva de fallos en App Check ──
if (appCheckInstance) {
  getToken(appCheckInstance, /* forceRefresh */ false)
    .then(() => Logger.info('✅ App Check token obtenido correctamente.'))
    .catch(err => {
      Logger.warn('⚠️ App Check token falló:', err.message);
      setTimeout(() => {
        if (document.body.classList.contains('visitor-mode')) return;
        const existing = document.getElementById('appcheck-warning-banner');
        if (existing) return;
        const banner = document.createElement('div');
        banner.id = 'appcheck-warning-banner';
        banner.style.cssText = `
          position:fixed;bottom:16px;right:16px;z-index:9999;
          padding:12px 20px;border-radius:8px;
          background:rgba(245,158,11,0.95);color:#1a1a2e;
          font-size:0.78rem;font-weight:600;font-family:'Inter',sans-serif;
          box-shadow:0 4px 20px rgba(0,0,0,0.3);
          display:flex;align-items:center;gap:8px;
          max-width:380px;line-height:1.4;
        `;
        banner.innerHTML = `
          <i class="ph ph-shield-warning" style="font-size:1.2rem;flex-shrink:0;"></i>
          <span>App Check: token no válido. Registra el Debug Token en Firebase Console.</span>
          <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#1a1a2e;cursor:pointer;font-size:1.1rem;padding:0 0 0 8px;flex-shrink:0;">✕</button>
        `;
        document.body.appendChild(banner);
        setTimeout(() => banner?.remove(), 20000);
      }, 2000);
    });
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// ═══════════════════════════════════════════════════════════════
// CONEXIÓN A EMULADORES (solo en desarrollo local)
// ───────────────────────────────────────────────────────────────
// En producción este bloque NO se ejecuta: shouldUseEmulators solo
// es true cuando la app corre en localhost/127.0.0.1/[::1].
// ═══════════════════════════════════════════════════════════════
if (shouldUseEmulators) {
  try {
    connectAuthEmulator(auth, `http://127.0.0.1:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', EMULATOR_PORTS.firestore);
    connectStorageEmulator(storage, '127.0.0.1', EMULATOR_PORTS.storage);
    Logger.info(`🧪 Conectado a emuladores Firebase (ENV=${ENV}).`);
    Logger.info(`   · Auth:      http://127.0.0.1:${EMULATOR_PORTS.auth}`);
    Logger.info(`   · Firestore: http://127.0.0.1:${EMULATOR_PORTS.firestore}`);
    Logger.info(`   · Storage:   http://127.0.0.1:${EMULATOR_PORTS.storage}`);
    Logger.info(`   · UI:        http://127.0.0.1:4000`);
  } catch (e) {
    Logger.error('❌ Error conectando a emuladores Firebase:', e.message);
  }
}

