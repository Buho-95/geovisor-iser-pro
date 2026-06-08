/**
 * env-banner.js — Indicadores visuales de entorno no productivo.
 *
 * Componentes:
 *   1. Banner superior (ancho completo) con label de entorno.
 *   2. Badge fijo en esquina inferior derecha (persistente).
 *
 * En producción NO hace nada.
 *
 * Paleta:
 *   - development → rojo #DC2626  · "MODO DESARROLLO LOCAL"
 *   - staging     → naranja #F97316 · "MODO STAGING (PRUEBAS REALES)"
 *   - production  → sin banner ni badge
 */
import { isProd, getEnvConfig, ENV, isStaging } from './env.js';
import { NS_INFO } from './paths.js';

export function mountEnvBanner() {
  if (isProd) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById('env-banner')) return;

  const cfg = getEnvConfig();

  // ─── Banner superior ────────────────────────────────────────────
  const banner = document.createElement('div');
  banner.id = 'env-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.style.cssText = [
    'position:fixed',
    'top:0', 'left:0', 'right:0',
    'z-index:100000',
    `background:${cfg.color}`,
    'color:#fff',
    'font-family:Inter,system-ui,sans-serif',
    'font-size:12px',
    'font-weight:700',
    'letter-spacing:0.08em',
    'text-transform:uppercase',
    'padding:6px 12px',
    'text-align:center',
    'box-shadow:0 2px 6px rgba(0,0,0,0.25)',
    'user-select:none',
  ].join(';');

  const extraMsg = isStaging
    ? 'Namespace: staging_*  ·  storage: staging/'
    : 'Conectado a emuladores locales';

  banner.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:8px;">
      <span aria-hidden="true" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 6px #fff;animation:envPulse 1.4s infinite;"></span>
      MODO ${cfg.label} · ${extraMsg}
    </span>
  `;

  // ─── Badge persistente esquina ──────────────────────────────────
  const badge = document.createElement('div');
  badge.id = 'env-badge';
  badge.title = `Entorno: ${cfg.label}\nSupabase tablas: ${NS_INFO.firestorePrefix || '(sin prefijo)'}\nStorage: ${NS_INFO.storagePrefix || '(sin prefijo)'}`;
  badge.style.cssText = [
    'position:fixed',
    'bottom:12px', 'right:12px',
    'z-index:99999',
    `background:${cfg.color}`,
    'color:#fff',
    'font-family:Inter,system-ui,sans-serif',
    'font-size:10px',
    'font-weight:800',
    'letter-spacing:0.1em',
    'padding:5px 10px',
    'border-radius:999px',
    'box-shadow:0 4px 12px rgba(0,0,0,0.35)',
    'user-select:none',
    'pointer-events:auto',
    'opacity:0.92',
  ].join(';');
  badge.textContent = cfg.shortLabel;

  // ─── Estilos globales ───────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @keyframes envPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
    body.env-nonprod { padding-top: 28px !important; }
    body.env-nonprod #loading-screen { top: 28px !important; }
    #env-badge:hover { opacity:1; transform:scale(1.05); transition:transform .15s; }
  `;
  document.head.appendChild(style);
  document.body.classList.add('env-nonprod');
  document.body.classList.add(`env-${ENV}`);
  document.body.appendChild(banner);
  document.body.appendChild(badge);

  const origTitle = document.title;
  if (!origTitle.startsWith('[')) {
    document.title = `[${cfg.shortLabel}] ${origTitle}`;
  }

  if (typeof window !== 'undefined' && window.console) {
    console.log(
      `%c ${cfg.label} %c  Supabase-tablas=${NS_INFO.firestorePrefix || '(none)'}  Storage=${NS_INFO.storagePrefix || '(none)'} `,
      `background:${cfg.color};color:#fff;font-weight:bold;padding:4px 8px;border-radius:3px 0 0 3px`,
      'background:#1e293b;color:#e2e8f0;padding:4px 8px;border-radius:0 3px 3px 0'
    );
  }
}
