/**
 * Servicio Firebase: inicialización de Auth, Firestore, Storage.
 * Incluye App Check con detección automática de fallos.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { initializeAppCheck, ReCaptchaV3Provider, getToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-check.js";
import { firebaseConfig } from '../core/config.js';
import { Logger } from '../core/logger.js';

const app = initializeApp(firebaseConfig);

// ── App Check: solo activa debug token en localhost ──
const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
if (isDev) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

let appCheckInstance = null;
try {
  appCheckInstance = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('CLAVE_PUBLICA_RECAPTCHA_V3'),
    isTokenAutoRefreshEnabled: true
  });
  Logger.info('Firebase App Check inicializado.');
} catch (e) {
  Logger.warn('App Check no pudo inicializarse:', e.message);
}

// ── Detección proactiva de fallos en App Check ──
// Intenta obtener un token; si falla (403/network), notifica discretamente al admin.
if (appCheckInstance) {
  getToken(appCheckInstance, /* forceRefresh */ false)
    .then(() => Logger.debug('App Check token obtenido correctamente.'))
    .catch(err => {
      Logger.warn('⚠️ App Check token falló:', err.message);
      // Mostrar aviso discreto al admin (no bloquea la app)
      setTimeout(() => {
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
          <span>App Check: token no válido. Algunas funciones de Firebase pueden estar restringidas.</span>
          <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#1a1a2e;cursor:pointer;font-size:1.1rem;padding:0 0 0 8px;flex-shrink:0;">✕</button>
        `;
        // Solo mostrar si estamos autenticados como admin
        if (document.body.classList.contains('visitor-mode') === false) {
          document.body.appendChild(banner);
          // Auto-dismiss after 15s
          setTimeout(() => banner.remove(), 15000);
        }
      }, 2000);
    });
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
