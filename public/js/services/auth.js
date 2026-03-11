/**
 * Servicio de autenticación. Firebase Auth + Modo Visitante.
 */
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { auth, db } from './firebase.js';
import { state, setUser } from '../core/state.js';
import { COLLECTIONS } from '../core/config.js';

export function initAuth(callbacks = {}) {
  const { onLoginSuccess, onAuthChange } = callbacks;

  // Persistencia Local — mantiene sesión de Admin tras F5
  setPersistence(auth, browserLocalPersistence).catch(console.error);

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
      // ── Sin sesión: mostrar login ──
      state.userProfile = null;
      state.userRole = null;

      // Reveal auth-screen and hide loading
      const authScreen = document.getElementById('auth-screen');
      if (authScreen) authScreen.classList.remove('hidden-auth');
      if (loadingScreen) loadingScreen.classList.add('loading-hidden');
    }
    onAuthChange?.(u);
  });
}
