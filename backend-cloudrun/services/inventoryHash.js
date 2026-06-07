'use strict';

function computeInventoryFingerprint(inventario) {
  const archivos = Array.isArray(inventario.archivos) ? inventario.archivos : [];
  const part = archivos
    .map((a) => `${a.nombre || ''}@${a.updated || a.timeUpdated || ''}`)
    .sort()
    .join('|');
  return `${inventario.totalArchivos || archivos.length}:${part}`;
}

module.exports = { computeInventoryFingerprint };
