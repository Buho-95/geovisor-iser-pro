/**
 * sede-switcher-fab.js — Botón flotante (esquina inferior izquierda del mapa)
 * que muestra/oculta el pill de selección de sede.
 *
 * El pill principal (`.sede-switcher`) sigue siendo el componente activo y
 * permanece visible por defecto. Este FAB sirve como atajo redundante (FASE 6
 * del plan) para abrir/colapsar la barra cuando el usuario quiere maximizar
 * el área del mapa.
 *
 * No introduce estado nuevo: solo togglea la clase `is-collapsed` sobre el pill.
 */

const FAB_ID = 'sede-switcher-fab';
const STYLE_ID = 'sede-switcher-fab-styles';

export function mountSedeSwitcherFab(parent) {
  if (!parent) return null;
  injectStyles();

  let fab = parent.querySelector(`#${FAB_ID}`);
  if (!fab) {
    fab = document.createElement('button');
    fab.type = 'button';
    fab.id = FAB_ID;
    fab.className = 'sede-fab';
    fab.title = 'Mostrar/ocultar selector de sedes';
    fab.setAttribute('aria-label', 'Mostrar/ocultar selector de sedes');
    fab.innerHTML = `<i class="ph ph-map-trifold"></i>`;
    parent.appendChild(fab);
  }

  fab.addEventListener('click', () => {
    const pill = parent.querySelector('.sede-switcher');
    if (!pill) return;
    pill.classList.toggle('is-collapsed');
    fab.classList.toggle('is-active', !pill.classList.contains('is-collapsed'));
  });

  // Estado inicial: pill visible, fab marcado como activo.
  fab.classList.add('is-active');
  return fab;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
    .sede-fab {
      position: absolute;
      left: 14px;
      bottom: 64px; /* por encima del coords-bar */
      z-index: 25;
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: rgba(15, 23, 42, 0.78);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(148, 163, 184, 0.30);
      color: #e5e7eb;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
      transition: transform .15s ease, color .15s ease, border-color .15s ease, background .15s ease;
    }
    .sede-fab:hover {
      transform: translateY(-1px);
      color: #67e8f9;
      border-color: rgba(34, 211, 238, 0.55);
    }
    .sede-fab.is-active {
      color: #22d3ee;
      border-color: rgba(34, 211, 238, 0.55);
      background: rgba(8, 47, 73, 0.78);
    }

    /* Soporte para colapsar el pill principal */
    .sede-switcher.is-collapsed {
      opacity: 0;
      transform: translate(-50%, -8px);
      pointer-events: none;
      transition: opacity .18s ease, transform .18s ease;
    }
  `;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}
