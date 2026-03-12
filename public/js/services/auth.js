/**
 * Servicio de autenticación. Firebase Auth + Modo Visitante.
 * 🔐 Incluye guardia de rutas y verificación periódica de sesión.
 */
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { auth, db } from './firebase.js';
import { state, setUser } from '../core/state.js';
import { COLLECTIONS } from '../core/config.js';

// ═══════════════════════════════════════════════════════
// 🔐 AUTH GUARD — Fuerza la pantalla de login si no hay sesión válida
// ═══════════════════════════════════════════════════════
function enforceAuthGuard() {
  // Ocultar la app y mostrar login
  const appContainer = document.getElementById('app-container');
  const authScreen = document.getElementById('auth-screen');

  if (appContainer) appContainer.classList.remove('visible');
  if (authScreen) authScreen.classList.remove('hidden-auth');

  // Limpiar estado
  state.user = null;
  state.userProfile = null;
  state.userRole = null;

  // Ocultar elementos admin
  document.getElementById('btn-open-upload')?.classList.add('hidden');
  document.getElementById('visor-btn-eliminar')?.classList.add('hidden');
  document.getElementById('btn-logout')?.classList.add('hidden');
  document.getElementById('btn-exit-visitor')?.classList.add('hidden');

  console.log('🔐 Auth Guard: Sesión inválida — redirigido a Login.');
}

/**
 * Verifica si el usuario actual tiene un rol válido (admin con sesión o visitor).
 * Exportada para que otros módulos puedan consultar el estado.
 */
export function isAuthenticated() {
  return state.userRole === 'admin' && auth.currentUser != null;
}

export function isAdmin() {
  return state.userRole === 'admin' && auth.currentUser != null;
}

export function isVisitor() {
  return state.userRole === 'visitor';
}

export function initAuth(callbacks = {}) {
  const { onLoginSuccess, onAuthChange } = callbacks;

  // 🛡️ Persistencia de SESIÓN — al cerrar navegador/pestaña, la sesión expira
  setPersistence(auth, browserSessionPersistence)
    .then(() => console.log('🛡️ Persistencia configurada: SESSION (se destruye al cerrar pestaña/navegador)'))
    .catch(err => console.error('❌ Error configurando persistencia:', err));

  const form = document.getElementById('login-form');
  const btnVisitor = document.getElementById('btn-visitor');
  const btnExitVisitor = document.getElementById('btn-exit-visitor');

  // ─── Visitor Mode (acceso directo, sin Auth) ───
  if (btnVisitor) {
    btnVisitor.addEventListener('click', () => {
      state.userRole = 'visitor';
      state.user = null;
      state.userProfile = null;

      // Update UI for visitor
      const nameEl = document.getElementById('header-user-name');
      const roleEl = document.getElementById('header-user-role');
      if (nameEl) nameEl.textContent = 'Visitante';
      if (roleEl) roleEl.textContent = 'Solo Lectura';

      // Hide admin-only elements
      document.getElementById('btn-open-upload')?.classList.add('hidden');
      document.getElementById('visor-btn-eliminar')?.classList.add('hidden');
      document.getElementById('visor-btn-descargar')?.classList.add('hidden');
      document.getElementById('btn-logout')?.classList.add('hidden');
      if (btnExitVisitor) btnExitVisitor.classList.remove('hidden');

      // Transition to app
      document.getElementById('auth-screen').classList.add('hidden-auth');
      document.getElementById('app-container').classList.add('visible');

      onLoginSuccess?.();
      onAuthChange?.(null);
    });
  }

  // ─── Admin Login Form ───
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-login');
      const originalText = btn.textContent;
      btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Conectando...';
      btn.disabled = true;

      try {
        // Garantizar persistencia SESSION antes de login
        await setPersistence(auth, browserSessionPersistence);

        await signInWithEmailAndPassword(
          auth,
          document.getElementById('email').value,
          document.getElementById('password').value
        );
        state.userRole = 'admin';

        // Update UI for admin
        const nameEl = document.getElementById('header-user-name');
        const roleEl = document.getElementById('header-user-role');
        if (nameEl) nameEl.textContent = state.user?.email?.split('@')[0] || 'Admin';
        if (roleEl) roleEl.textContent = 'Administrador';

        // Show admin-only elements
        document.getElementById('btn-open-upload')?.classList.remove('hidden');
        document.getElementById('visor-btn-eliminar')?.classList.remove('hidden');
        document.getElementById('visor-btn-descargar')?.classList.remove('hidden');
        document.getElementById('btn-logout')?.classList.remove('hidden');
        if (btnExitVisitor) btnExitVisitor.classList.add('hidden');

        document.getElementById('auth-screen').classList.add('hidden-auth');
        document.getElementById('app-container').classList.add('visible');
        onLoginSuccess?.();
      } catch (error) {
        console.error(error);
        const errEl = document.getElementById('login-error');
        errEl.innerText = 'Credenciales inválidas o correo no registrado.';
        errEl.classList.remove('hidden');
      } finally {
        btn.textContent = 'Iniciar Sesión';
        btn.disabled = false;
      }
    });
  }

  // ─── Exit Visitor Mode ───
  if (btnExitVisitor) {
    btnExitVisitor.addEventListener('click', () => {
      state.userRole = null;
      location.reload();
    });
  }

  // ─── Logout ───
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (state.userRole === 'admin') {
        await signOut(auth);
      }
      location.reload();
    });
  }

  // ─── Auth State Observer (maneja persistencia de Admin en F5) ───
  onAuthStateChanged(auth, async (u) => {
    state.user = u;
    setUser(u);

    // Hide loading screen once Firebase has resolved auth state
    const loadingScreen = document.getElementById('loading-screen');

    if (u && !u.isAnonymous) {
      // ── Admin recuperado por persistencia ──
      state.userRole = 'admin';
      try {
        const profileRef = doc(db, COLLECTIONS.USUARIOS, u.uid);
        const snap = await getDoc(profileRef);
        state.userProfile = snap.exists() ? snap.data() : null;
      } catch {
        state.userProfile = null;
      }

      // Update header
      const nameEl = document.getElementById('header-user-name');
      const roleEl = document.getElementById('header-user-role');
      if (nameEl) nameEl.textContent = state.userProfile?.nombre || u.email?.split('@')[0] || 'Admin';
      if (roleEl) roleEl.textContent = 'Administrador';

      // Restaurar interfaz visual para Admin
      document.getElementById('btn-open-upload')?.classList.remove('hidden');
      document.getElementById('visor-btn-eliminar')?.classList.remove('hidden');
      document.getElementById('visor-btn-descargar')?.classList.remove('hidden');
      document.getElementById('btn-logout')?.classList.remove('hidden');
      const btnExitV = document.getElementById('btn-exit-visitor');
      if (btnExitV) btnExitV.classList.add('hidden');

      // Transicionar directo al app (sin mostrar login)
      const authScreen = document.getElementById('auth-screen');
      if (authScreen) authScreen.classList.add('hidden-auth');
      document.getElementById('app-container')?.classList.add('visible');

      // Hide loading screen with fade
      if (loadingScreen) loadingScreen.classList.add('loading-hidden');

      onLoginSuccess?.();
    } else if (!u) {
      // ── Sin sesión y no es visitor: forzar guardia ──
      if (state.userRole !== 'visitor') {
        enforceAuthGuard();
      }

      // Reveal auth-screen and hide loading
      const authScreen = document.getElementById('auth-screen');
      if (authScreen && state.userRole !== 'visitor') {
        authScreen.classList.remove('hidden-auth');
      }
      if (loadingScreen) loadingScreen.classList.add('loading-hidden');
    }
    onAuthChange?.(u);
  });

  // ═══════════════════════════════════════════════════════
  // 🔐 VERIFICACIÓN PERIÓDICA DE SESIÓN (cada 5 segundos)
  // Detecta si el estado de React dice "admin" pero Firebase ya no tiene sesión
  // ═══════════════════════════════════════════════════════
  setInterval(() => {
    if (state.userRole === 'admin' && !auth.currentUser) {
      console.warn('🔐 Verificación periódica: sesión admin inválida detectada');
      enforceAuthGuard();
    }
  }, 5000);
}
