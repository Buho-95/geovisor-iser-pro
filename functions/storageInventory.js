'use strict';

const admin = require('firebase-admin');
const { computeInventoryFingerprint } = require('./inventoryHash');

const STORAGE_BASE = 'documentos_iser';

/**
 * Lista recursiva vía Admin SDK (sin listAll en cliente).
 */
async function scanPrefix(prefix, blockId, blockName, sede, basePathLabel) {
  const bucket = admin.storage().bucket();
  const archivos = [];
  const subcarpetas = new Set();

  const [files] = await bucket.getFiles({ prefix, autoPaginate: true });

  for (const f of files) {
    const full = f.name;
    if (full.endsWith('/')) continue;

    const rel = full.startsWith(prefix) ? full.substring(prefix.length) : full;
    const segments = rel.split('/').filter(Boolean);
    const nombre = segments.pop() || full.split('/').pop();
    const folderParts = segments;
    const carpeta = folderParts.length ? folderParts.join('/') : 'raíz';

    for (let i = 0; i < folderParts.length; i++) {
      subcarpetas.add(folderParts.slice(0, i + 1).join('/'));
    }

    const meta = f.metadata || {};
    const metaExtra = {
      size: Number(meta.size) || 0,
      contentType: meta.contentType || '',
      timeCreated: meta.timeCreated,
      updated: meta.updated,
    };

    const extension = nombre.includes('.') ? nombre.split('.').pop().toLowerCase() : 'sin_extension';
    archivos.push({
      nombre,
      extension,
      carpeta,
      rutaCompleta: full,
      ...metaExtra,
    });
  }

  const inventario = {
    blockId,
    blockName,
    sede: sede || 'pamplona',
    basePath: basePathLabel,
    archivos,
    subcarpetas: Array.from(subcarpetas),
    totalArchivos: archivos.length,
    scanTimestamp: new Date().toISOString(),
  };
  inventario.archivoHash = computeInventoryFingerprint(inventario);
  return inventario;
}

/**
 * Intenta rutas conocidas (actual + legado) y devuelve el primer inventario no vacío.
 */
async function buildInventoryForBlock(blockId, blockName, sede) {
  const s = sede || 'pamplona';

  const attempts = [
    { prefix: `${STORAGE_BASE}/${blockId}/`, label: `${STORAGE_BASE}/${blockId}` },
    { prefix: `${STORAGE_BASE}/${s}/${blockId}/`, label: `${STORAGE_BASE}/${s}/${blockId}` },
  ];
  if (blockName && blockName !== blockId) {
    attempts.push({ prefix: `${STORAGE_BASE}/${blockName}/`, label: `${STORAGE_BASE}/${blockName}` });
  }

  let lastEmpty = null;
  for (const a of attempts) {
    const inv = await scanPrefix(a.prefix, blockId, blockName || blockId, s, a.label);
    if (inv.totalArchivos > 0) return inv;
    lastEmpty = inv;
  }
  return lastEmpty || {
    blockId,
    blockName: blockName || blockId,
    sede: s,
    basePath: `${STORAGE_BASE}/${blockId}`,
    archivos: [],
    subcarpetas: [],
    totalArchivos: 0,
    scanTimestamp: new Date().toISOString(),
    archivoHash: '0:',
  };
}

module.exports = { buildInventoryForBlock, STORAGE_BASE };
