/**
 * env-banner.js — Indicador visual de entorno no productivo.
 *
 * Inyecta un banner superior rojo/naranja cuando la app NO corre en producción.
 * En producción NO hace nada (retorno temprano).
 */
import { isProd, getEnvConfig, ENV } from './env.js';

export function mountEnvBanner() {
  if (isProd) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById('env-banner')) return;

  const cfg = getEnvConfig();
  const banner = document.createElement('div');
  banner.id = 'env-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
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
    'pointer-events:auto',
    'user-select:none',
  ].join(';');
  banner.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:8px;">
      <span aria-hidden="true" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 6px #fff;animation:envPulse 1.4s infinite;"></span>
      MODO ${cfg.label} · ENV=${ENV} · Los cambios aquí NO afectan la página real
    </span>
  `;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes envPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
    body.env-nonprod { padding-top: 28px !important; }
    body.env-nonprod #loading-screen { top: 28px !important; }
  `;
  document.head.appendChild(style);
  document.body.classList.add('env-nonprod');
  document.body.appendChild(banner);

  const origTitle = document.title;
  if (!origTitle.startsWith('[')) {
    document.title = `[${cfg.label}] ${origTitle}`;
  }
}
