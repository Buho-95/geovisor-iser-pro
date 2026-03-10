/**
 * Módulo visor BIM IFC.
 * Placeholder: preparado para integrar web-ifc-viewer o similar.
 * Por ahora redirige a descarga para archivos .ifc y .rvt.
 */
import { on, emit, EVENTS } from '../../core/events.js';

/**
 * Inicializa el listener para abrir archivos BIM.
 * Cuando se abra un archivo IFC, se cargará el visor (lazy).
 */
export function init() {
  on(EVENTS.VIEWER_OPEN, (file) => {
    if (file.tipo === 'ifc') {
      emit(EVENTS.BIM_VIEWER_OPEN, file);
      // TODO: dynamic import de web-ifc-viewer
      // import('https://cdn.jsdelivr.net/npm/web-ifc-viewer@...').then(...)
    }
  });
}

/**
 * Abre el visor BIM con un archivo IFC (placeholder).
 * @param {object} file - { url, nombre }
 */
export async function openBimViewer(file) {
  // Placeholder: por ahora se usa el visor de documentos estándar
  // La integración real requerirá: npm/web-ifc-viewer o three.js + web-ifc
  console.info('[BIM Viewer] Preparado para:', file?.nombre);
  return null;
}
