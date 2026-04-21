/**
 * dynamic-folder-modal.js — Modal para crear una carpeta dinámica NN_Nombre.
 *
 *   const result = await openDynamicFolderModal({ sedeId, parentPath });
 *   if (result?.created) { ... }
 */
import { createDynamicFolder, suggestNextFolderNumber, listDynamicFolders } from '../core/dynamic-folders-store.js';
import { validateFolderName } from '../core/structure-validator.js';

export async function openDynamicFolderModal({ sedeId, parentPath }) {
  if (!sedeId || !parentPath) throw new Error('sedeId y parentPath requeridos.');

  // Pre-calcular siguiente número disponible
  const [nextNum, allDyn] = await Promise.all([
    suggestNextFolderNumber(sedeId, parentPath),
    listDynamicFolders(sedeId),
  ]);
  const siblings = allDyn.filter(d => d.parentPath === parentPath).map(d => d.nombre);

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'sdfm-backdrop';
    backdrop.innerHTML = `
      <div class="sdfm-dialog" role="dialog" aria-modal="true">
        <div class="sdfm-title">
          <i class="ph-fill ph-folder-plus" style="color:#ef4444;"></i>
          Nueva carpeta dinámica
        </div>
        <div class="sdfm-parent">
          <strong>Ubicación:</strong><br>
          <code>${escapeHtml(sedeId)} / ${escapeHtml(parentPath)}</code>
        </div>
        <div class="sdfm-row">
          <label>Número</label>
          <input class="sdfm-input" id="sdfm-num" maxlength="2" value="${escapeAttr(nextNum)}" />
          <div class="sdfm-hint">Auto-sugerido: <code>${escapeHtml(nextNum)}</code> (siguiente disponible)</div>
        </div>
        <div class="sdfm-row">
          <label>Nombre (sin espacios, sin acentos)</label>
          <input class="sdfm-input" id="sdfm-nom" placeholder="MiCarpeta" />
          <div class="sdfm-hint">Resultado final: <code id="sdfm-preview">${escapeHtml(nextNum)}_</code></div>
        </div>
        <div class="sdfm-error" id="sdfm-err"></div>
        <div class="sdfm-actions">
          <button class="sdfm-btn cancel" id="sdfm-cancel">Cancelar</button>
          <button class="sdfm-btn ok" id="sdfm-ok" disabled>Crear</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const numInp = backdrop.querySelector('#sdfm-num');
    const nomInp = backdrop.querySelector('#sdfm-nom');
    const preview = backdrop.querySelector('#sdfm-preview');
    const err = backdrop.querySelector('#sdfm-err');
    const okBtn = backdrop.querySelector('#sdfm-ok');

    function buildName() {
      const n = (numInp.value || '').padStart(2, '0');
      const name = (nomInp.value || '').trim();
      return name ? `${n}_${name}` : `${n}_`;
    }
    function revalidate() {
      const full = buildName();
      preview.textContent = full;
      if (!nomInp.value.trim()) {
        err.textContent = '';
        okBtn.disabled = true;
        return;
      }
      const r = validateFolderName(full);
      if (!r.ok) { err.textContent = r.error; okBtn.disabled = true; return; }
      if (siblings.includes(full)) {
        err.textContent = `Ya existe "${full}" en este nivel.`;
        okBtn.disabled = true;
        return;
      }
      err.textContent = '';
      okBtn.disabled = false;
    }
    numInp.addEventListener('input', () => {
      numInp.value = numInp.value.replace(/\D/g, '').slice(0, 2);
      revalidate();
    });
    nomInp.addEventListener('input', () => {
      nomInp.value = nomInp.value.replace(/[^A-Za-z0-9_]/g, '');
      revalidate();
    });
    nomInp.focus();

    function close(result) {
      document.body.removeChild(backdrop);
      resolve(result);
    }
    backdrop.querySelector('#sdfm-cancel').addEventListener('click', () => close({ created: false }));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close({ created: false }); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close({ created: false }); }
    });

    okBtn.addEventListener('click', async () => {
      const nombre = buildName();
      okBtn.disabled = true;
      okBtn.textContent = 'Creando…';
      try {
        const folder = await createDynamicFolder({
          sedeId, parentPath, nombre, existingSiblings: siblings,
        });
        close({ created: true, folder });
      } catch (e) {
        err.textContent = e.message || 'Error al crear.';
        okBtn.disabled = false;
        okBtn.textContent = 'Crear';
      }
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
