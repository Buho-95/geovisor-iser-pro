/**
 * Servicio Firebase: inicialización de Auth, Firestore, Storage.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-check.js";
import { firebaseConfig } from '../core/config.js';

const app = initializeApp(firebaseConfig);

// Configurar logs de App Check para detectar si bloquea peticiones legítimas
self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
try {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider('CLAVE_PUBLICA_RECAPTCHA_V3'),
    isTokenAutoRefreshEnabled: true
  });
  console.log('Firebase App Check inicializado en modo debug.');
} catch (e) {
  console.warn('App Check module warning:', e);
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
