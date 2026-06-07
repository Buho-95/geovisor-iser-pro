/**
 * Servicio de autenticación.
 * Soporta Firebase Auth y Supabase Auth en paralelo controlado por DB_PROVIDER.
 * RBAC: rol real desde colección usuarios_iser (Firebase) o tabla usuarios_iser (Supabase).
 */
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { auth, db } from './firebase.js';
import { state, setUser } from '../core/state.js';
import { Logger } from '../core/logger.js';
import { COLLECTIONS, DB_PROVIDER } from '../core/config.js';

const TEMP_ADMIN_EMAILS = ['pedrojtrillos.arq@gmail.com'];

function enforceAuthGuard() {
  const appContainer = document.getElementById('app-container');
  const authScreen = document.getElementById('auth-screen');

  if (appContainer) appContainer.classList.remove('visible');
  if (authScreen) authScreen.classList.remove('hidden-auth');

  state.user = null;
  state.userProfile = null;
  state.userRole = null;

  document.getElementById('btn-open-upload')?.classList.add('hidden');
  document.getElementById('visor-btn-eliminar')?.classList.add('hidden');
  document.getElementById('btn-logout')?.classList.add('hidden');
  document.getElementById('btn-exit-visitor')?.classList.add('hidden');

  Logger.info('🔐 Auth Guard: Sesión inválida — redirigido a Login.');
}

/**
 * Aplica cabecera y visibilidad según rol (admin | viewer | visitor).
 */
function applyRoleUi(role, u) {
  const nameEl = document.getElementById('header-user-name');
  const roleEl = document.getElementById('header-user-role');
  const mantNavBtn = document.getElementById('nav-btn-mantenimiento');
  const btnExitVisitor = document.getElementById('btn-exit-visitor');

  if (role === 'visitor') {
    document.body.classList.add('visitor-mode');
    if (nameEl) nameEl.textContent = 'Visitante';
    if (roleEl) roleEl.textContent = 'Solo lectura';
    document.getElementById('btn-open-upload')?.classList.add('hidden');
    document.getElementById('visor-btn-eliminar')?.classList.add('hidden');
    document.getElementById('visor-btn-descargar')?.classList.add('hidden');
    document.getElementById('btn-logout')?.classList.add('hidden');
    if (btnExitVisitor) btnExitVisitor.classList.remove('hidden');
    if (mantNavBtn) mantNavBtn.style.display = 'none';
    return;
  }

  document.body.classList.remove('visitor-mode');

  if (role === 'admin') {
    if (nameEl) nameEl.textContent = state.userProfile?.nombre || u?.email?.split('@')[0] || 'Admin';
    if (roleEl) roleEl.textContent = 'Administrador';
    document.getElementById('btn-open-upload')?.classList.remove('hidden');
    document.getElementById('visor-btn-eliminar')?.classList.remove('hidden');
    document.getElementById('visor-btn-descargar')?.classList.remove('hidden');
    document.getElementById('btn-logout')?.classList.remove('hidden');
    if (mantNavBtn) mantNavBtn.style.display = '';
    if (btnExitVisitor) btnExitVisitor.classList.add('hidden');
    return;
  }

  // viewer
  if (nameEl) nameEl.textContent = state.userProfile?.nombre || u?.email?.split('@')[0] || 'Usuario';
  if (roleEl) roleEl.textContent = 'Consulta';
  document.getElementById('btn-open-upload')?.classList.add('hidden');
  document.getElementById('visor-btn-eliminar')?.classList.add('hidden');
  document.getElementById('visor-btn-descargar')?.classList.remove('hidden');
  document.getElementById('btn-logout')?.classList.remove('hidden');
  if (mantNavBtn) mantNavBtn.style.display = 'none';
  if (btnExitVisitor) btnExitVisitor.classList.add('hidden');
}

export function isAuthenticated() {
  if (DB_PROVIDER === 'supabase') {
    return state.user != null;
  }
  return auth.currentUser != null;
}

export function isAdmin() {
  if (DB_PROVIDER === 'supabase') {
    return state.userRole === 'admin' && state.user != null && !state.user?.is_anonymous;
  }
  return state.userRole === 'admin' && auth.currentUser != null && !auth.currentUser.isAnonymous;
}

export function isVisitor() {
  return state.userRole === 'visitor';
}

export function initAuth(callbacks = {}) {
  // ══ Ruta Supabase ══════════════════════════════════════════════════
  if (DB_PROVIDER === 'supabase') {
    return _initAuthSupabase(callbacks);
  }
  // ══ Ruta Firebase (original) ══════════════════════════════════════════
  return _initAuthFirebase(callbacks);
}

// ═══════════════════════════════════════════════════════════════
// SUPABASE AUTH
// ═══════════════════════════════════════════════════════════════
async function _initAuthSupabase(callbacks = {}) {
  const { onLoginSuccess, onAuthChange } = callbacks;
  const {
    signInWithEmail,
    signInAnonymousSupabase,
    signOutSupabase,
    onSupabaseAuthChange,
    getUserProfile,
  } = await import('./supabase.js');

  const form = document.getElementById('login-form');
  const btnVisitor = document.getElementById('btn-visitor');
  const btnExitVisitor = document.getElementById('btn-exit-visitor');

  if (btnVisitor) {
    btnVisitor.addEventListener('click', async () => {
      const originalText = btnVisitor.innerHTML;
      btnVisitor.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Ingresando...';
      btnVisitor.disabled = true;
      try {
        await signInAnonymousSupabase();
      } catch (error) {
        Logger.error('Error en Visitor Login (Supabase):', error);
        alert('No se pudo iniciar sesión como visitante.');
      } finally {
        btnVisitor.innerHTML = originalText;
        btnVisitor.disabled = false;
      }
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-login');
      btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Conectando...';
      btn.disabled = true;
      try {
        await signInWithEmail(
          document.getElementById('email').value,
          document.getElementById('password').value
        );
      } catch (error) {
        Logger.error('Error en login (Supabase):', error);
        const errEl = document.getElementById('login-error');
        if (errEl) {
          errEl.innerText = 'Credenciales inválidas o correo no registrado.';
          errEl.classList.remove('hidden');
        }
      } finally {
        btn.textContent = 'Iniciar Sesión';
        btn.disabled = false;
      }
    });
  }

  async function performLogoutSB() {
    const emailField = document.getElementById('email');
    const passField = document.getElementById('password');
    if (emailField) emailField.value = '';
    if (passField) passField.value = '';
    state.userRole = null;
    state.user = null;
    state.userProfile = null;
    state.currentBlockId = null;
    state.archivosNube = [];
    try { await signOutSupabase(); } catch (e) { Logger.error('Error cerrando sesión Supabase', e); }
    location.reload();
  }

  if (btnExitVisitor) btnExitVisitor.addEventListener('click', performLogoutSB);
  document.getElementById('btn-logout')?.addEventListener('click', performLogoutSB);

  // Escuchar cambios de sesión
  onSupabaseAuthChange(async (sbUser) => {
    Logger.debug('Supabase Auth change:', sbUser);
    state.user = sbUser;
    const loadingScreen = document.getElementById('loading-screen');

    if (sbUser && !sbUser.is_anonymous) {
      try {
        const profile = await getUserProfile(sbUser.id);
        state.userProfile = profile;
        const email = (sbUser.email || '').toLowerCase();
        const fallbackAdmin = TEMP_ADMIN_EMAILS.includes(email);
        state.userRole = profile?.role === 'admin' || fallbackAdmin ? 'admin' : 'viewer';
      } catch (err) {
        Logger.warn('No se pudo leer usuarios_iser (Supabase):', err);
        const email = (sbUser.email || '').toLowerCase();
        state.userRole = TEMP_ADMIN_EMAILS.includes(email) ? 'admin' : 'viewer';
      }

      setUser(sbUser);
      applyRoleUi(state.userRole, sbUser);
      document.getElementById('auth-screen')?.classList.add('hidden-auth');
      document.getElementById('app-container')?.classList.add('visible');
      if (loadingScreen) loadingScreen.classList.add('loading-hidden');
      onLoginSuccess?.();

    } else if (sbUser?.is_anonymous) {
      state.userProfile = null;
      state.userRole = 'visitor';
      setUser(sbUser);
      applyRoleUi('visitor', sbUser);
      document.getElementById('auth-screen')?.classList.add('hidden-auth');
      document.getElementById('app-container')?.classList.add('visible');
      if (loadingScreen) loadingScreen.classList.add('loading-hidden');
      onLoginSuccess?.();

    } else {
      enforceAuthGuard();
      document.getElementById('auth-screen')?.classList.remove('hidden-auth');
      if (loadingScreen) loadingScreen.classList.add('loading-hidden');
    }

    onAuthChange?.(sbUser);
  });
}

// ═══════════════════════════════════════════════════════════════
// FIREBASE AUTH (original, sin cambios)
// ═══════════════════════════════════════════════════════════════
function _initAuthFirebase(callbacks = {}) {
  const { onLoginSuccess, onAuthChange } = callbacks;

  setPersistence(auth, browserSessionPersistence)
    .then(() => Logger.info('🛡️ Persistencia configurada: SESSION'))
    .catch(err => Logger.error('❌ Error configurando persistencia:', err));

  const form = document.getElementById('login-form');
  const btnVisitor = document.getElementById('btn-visitor');
  const btnExitVisitor = document.getElementById('btn-exit-visitor');

  if (btnVisitor) {
    btnVisitor.addEventListener('click', async () => {
      const originalText = btnVisitor.innerHTML;
      btnVisitor.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Ingresando...';
      btnVisitor.disabled = true;

      try {
        await signInAnonymously(auth);
      } catch (error) {
        Logger.error('Error en Visitor Login:', error);
        alert('No se pudo iniciar sesión como visitante. Por favor, intenta de nuevo.');
      } finally {
        btnVisitor.innerHTML = originalText;
        btnVisitor.disabled = false;
      }
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-login');
      btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Conectando...';
      btn.disabled = true;

      try {
        await setPersistence(auth, browserSessionPersistence);
        await signInWithEmailAndPassword(
          auth,
          document.getElementById('email').value,
          document.getElementById('password').value
        );
      } catch (error) {
        Logger.error('Error en login admin:', error);
        const errEl = document.getElementById('login-error');
        errEl.innerText = 'Credenciales inválidas o correo no registrado.';
        errEl.classList.remove('hidden');
      } finally {
        btn.textContent = 'Iniciar Sesión';
        btn.disabled = false;
      }
    });
  }

  async function performLogout() {
    const emailField = document.getElementById('email');
    const passField = document.getElementById('password');
    if (emailField) emailField.value = '';
    if (passField) passField.value = '';

    state.userRole = null;
    state.user = null;
    state.userProfile = null;
    state.currentBlockId = null;
    state.archivosNube = [];

    try {
      await signOut(auth);
    } catch (e) { Logger.error('Error signing out', e); }

    location.reload();
  }

  if (btnExitVisitor) {
    btnExitVisitor.addEventListener('click', performLogout);
  }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', performLogout);
  }

  onAuthStateChanged(auth, async (u) => {
    Logger.debug('Estado de Auth:', u);
    if (u) {
      console.log('AUTH READY:', u.uid);
    }
    state.user = u;

    const loadingScreen = document.getElementById('loading-screen');

    if (u && !u.isAnonymous) {
      try {
        const profileRef = doc(db, COLLECTIONS.USUARIOS, u.uid);
        const snap = await getDoc(profileRef);
        state.userProfile = snap.exists() ? snap.data() : null;
        const email = (u.email || '').toLowerCase();
        const fallbackAdmin = TEMP_ADMIN_EMAILS.includes(email);
        state.userRole = state.userProfile?.role === 'admin' || fallbackAdmin ? 'admin' : 'viewer';
        if (!snap.exists() && fallbackAdmin) {
          Logger.warn(
            'RBAC fallback: admin por lista temporal de email. Migrar a usuarios_iser.role=admin o custom claims (admin: true).'
          );
        }
      } catch (err) {
        Logger.warn('No se pudo leer usuarios_iser:', err);
        state.userProfile = null;
        const email = (u.email || '').toLowerCase();
        state.userRole = TEMP_ADMIN_EMAILS.includes(email) ? 'admin' : 'viewer';
      }

      setUser(u);
      applyRoleUi(state.userRole, u);

      const authScreen = document.getElementById('auth-screen');
      if (authScreen) authScreen.classList.add('hidden-auth');
      document.getElementById('app-container')?.classList.add('visible');
      if (loadingScreen) loadingScreen.classList.add('loading-hidden');

      onLoginSuccess?.();
    } else if (u && u.isAnonymous) {
      state.userProfile = null;
      state.userRole = 'visitor';
      setUser(u);
      applyRoleUi('visitor', u);

      const authScreen = document.getElementById('auth-screen');
      if (authScreen) authScreen.classList.add('hidden-auth');
      document.getElementById('app-container')?.classList.add('visible');
      if (loadingScreen) loadingScreen.classList.add('loading-hidden');

      onLoginSuccess?.();
    } else if (!u) {
      if (state.userRole !== 'visitor') {
        enforceAuthGuard();
      }
      const authScreen = document.getElementById('auth-screen');
      if (authScreen && state.userRole !== 'visitor') {
        authScreen.classList.remove('hidden-auth');
      }
      if (loadingScreen) loadingScreen.classList.add('loading-hidden');
    }

    onAuthChange?.(u);
  });

  const sessionCheckId = setInterval(() => {
    if (state.userRole === 'admin' && !auth.currentUser) {
      Logger.warn('🔐 Verificación periódica: sesión admin inválida detectada');
      clearInterval(sessionCheckId);
      enforceAuthGuard();
    } else if (!state.userRole) {
      clearInterval(sessionCheckId);
    }
  }, 5000);
}
