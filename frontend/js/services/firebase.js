/**
 * Servicio Firebase: inicialización de Auth, Firestore, Storage y App Check.
 *
 * Debug token de App Check: solo en localhost (desarrollo). En producción se usa
 * reCAPTCHA v3 sin token de depuración.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { initializeAppCheck, ReCaptchaV3Provider, getToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-check.js";
import { firebaseConfig } from '../core/config.js';
import { Logger } from '../core/logger.js';

const app = initializeApp(firebaseConfig);


// ⚠️ Reemplaza con tu clave real de ReCAPTCHA v3 (solo usada en producción).
// Cuando debug token está activo, Firebase ignora la clave de sitio.
// Obtenla en: https://www.google.com/recaptcha/admin
const RECAPTCHA_SITE_KEY = '6LdYAJMsAAAAAPhabJ2yXRSq_M-3WxfCiYJcypUe';

const host = typeof location !== 'undefined' ? location.hostname : '';
const isLocalDev =
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
if (isLocalDev) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  Logger.info('App Check: modo debug (localhost). En producción se usa reCAPTCHA sin token de depuración.');
}

let appCheckInstance = null;
try {
  appCheckInstance = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
  Logger.info('✅ Firebase App Check inicializado.');
} catch (e) {
  Logger.warn('⚠️ App Check no pudo inicializarse:', e.message);
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

