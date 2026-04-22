/**
 * sede-switcher.js — Selector de sede como pill overlay sobre el mapa.
 *
 * Uso:
 *   import { mountSedeSwitcher } from './components/sede-switcher.js';
 *   mountSedeSwitcher(document.querySelector('.map-column'), { initial: 'pamplona' });
 *
 * Integra con core/ui-state.js: los clicks disparan `setSede()` que emite
 * `geovisor:sede-changed`. Además mantiene compatibilidad con el `<select>`
 * legacy `#top-nav-sede-selector` si existe (sincroniza .value y dispara change).
 */
import { setSede, getSedeActiva, onSedeChanged } from '../core/ui-state.js';

const SEDES = [
  { id: 'pamplona',  label: 'Pamplona',  icon: 'ph-buildings' },
  { id: 'rinconada', label: 'Rinconada', icon: 'ph-tree' },
  { id: 'caldera',   label: 'Caldera',   icon: 'ph-mountains' },
];

const STYLE_ID = 'sede-switcher-styles';

export function mountSedeSwitcher(parent, opts = {}) {
  if (!parent) return null;
  injectStyles();

  const initial = opts.initial || getSedeActiva() || 'pamplona';

  let root = parent.querySelector('.sede-switcher');
  if (!root) {
    root = document.createElement('div');
    root.className = 'sede-switcher';
    root.setAttribute('role', 'tablist');
    root.setAttribute('aria-label', 'Seleccionar sede');
    parent.appendChild(root);
  }

  root.innerHTML = SEDES.map(s => `
    <button type="button"
      class="sede-switcher-btn ${s.id === initial ? 'is-active' : ''}"
      data-sede="${s.id}"
      role="tab"
      aria-selected="${s.id === initial ? 'true' : 'false'}"
      title="Sede ${s.label}">
      <i class="ph ${s.icon}" aria-hidden="true"></i>
      <span>${s.label}</span>
    </button>
  `).join('');

  function setActive(sedeId, { emit = true } = {}) {
    root.querySelectorAll('.sede-switcher-btn').forEach(btn => {
      const active = btn.dataset.sede === sedeId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (emit) setSede(sedeId);
    // Compat: reflejar en selector legacy
    const legacy = document.getElementById('top-nav-sede-selector');
    if (legacy && legacy.value !== sedeId) {
      legacy.value = sedeId;
      legacy.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.sede-switcher-btn');
    if (!btn) return;
    const sedeId = btn.dataset.sede;
    if (!sedeId) return;
    if (btn.classList.contains('is-active')) return;
    setActive(sedeId);
  });

  // Sincronización bidireccional: si otro origen cambia la sede,
  // reflejarlo en los botones sin re-emitir.
  const unsub = onSedeChanged(({ sede }) => {
    if (!sede) return;
    root.querySelectorAll('.sede-switcher-btn').forEach(btn => {
      const active = btn.dataset.sede === sede;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  });

  return {
    root,
    setActive: (sedeId) => setActive(sedeId, { emit: true }),
    destroy: () => { unsub?.(); root.remove(); },
  };
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
    .sede-switcher {
      position: absolute;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 25;
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      border-radius: 999px;
      background: var(--glass-bg, rgba(15, 20, 30, 0.55));
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25);
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    .sede-switcher-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--text-secondary, #b9c2d0);
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease, transform 120ms ease;
      white-space: nowrap;
      line-height: 1;
    }
    .sede-switcher-btn i {
      font-size: 0.95rem;
      opacity: 0.85;
    }
    .sede-switcher-btn:hover {
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-primary, #f5f7fa);
    }
    .sede-switcher-btn:focus-visible {
      outline: 2px solid var(--cyan, #22d3ee);
      outline-offset: 2px;
    }
    .sede-switcher-btn.is-active {
      background: linear-gradient(135deg, rgba(34, 211, 238, 0.95), rgba(14, 116, 144, 0.95));
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(34, 211, 238, 0.35);
    }
    .sede-switcher-btn.is-active i { opacity: 1; }

    @media (max-width: 640px) {
      .sede-switcher { top: 12px; padding: 3px; gap: 2px; }
      .sede-switcher-btn { padding: 6px 10px; font-size: 0.72rem; }
      .sede-switcher-btn span { display: none; }
      .sede-switcher-btn i { font-size: 1.05rem; }
    }
  `;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}
