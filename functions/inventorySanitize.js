'use strict';

/**
 * Inventario completo para admin/viewer; para sesión anónima se omiten rutas
 * internas de Storage y el path completo en `id`, manteniendo url para el visor.
 */
function redactInventarioForAnonymous(inventario) {
  if (!inventario || typeof inventario !== 'object') return inventario;
  const archivos = (inventario.archivos || []).map((a, idx) => {
    const copy = { ...a };
    delete copy.rutaCompleta;
    delete copy.storagePath;
    copy.id = `anon-${idx}-${String(copy.nombre || 'file').slice(0, 64)}`;
    return copy;
  });
  return {
    ...inventario,
    basePath: undefined,
    archivos,
  };
}

module.exports = { redactInventarioForAnonymous };
