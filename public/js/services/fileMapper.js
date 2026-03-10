import { state } from '../core/state.js';

/**
 * Normaliza strings para búsqueda ignorando tildes, mayúsculas y espacios
 */
export function normalizeKey(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_\-]/g, '')
        .toLowerCase();
}

/**
 * Obtiene las rutas de carpetas específicas para un tipo de filtro (3D, PDF, RENDERS, FOTOS)
 * @param {string} filterType - '3d' | 'pdf' | 'renders' | 'img'
 * @returns {Array<{path: string, label: string}>}
 */
export function getPathsForFilter(filterType) {
    switch (filterType) {
        case 'pdf':
            return [
                { path: '01_Arquitectonico/03_Entregables_PDF', label: 'Arquitectónico PDF' },
                { path: '02_Estructural/03_Entregables_PDF', label: 'Estructural PDF' },
                { path: '03_Electricos_y_Red_de_Datos/01_Electricos/02_Entregables_PDF', label: 'Eléctricos PDF' },
                { path: '03_Electricos_y_Red_de_Datos/02_Redes_de_Datos/02_Entregables_PDF', label: 'Redes Data PDF' },
                { path: '04_Hidrosanitarios_y_Gas/01_Gas/03_Entregables_PDF', label: 'Gas PDF' },
                { path: '04_Hidrosanitarios_y_Gas/02_Hidrosanitarios/03_Entregables_PDF', label: 'Hidrosanitario PDF' }
            ];
        case '3d':
            return [
                { path: '01_Arquitectonico/02_Modelo_3D_SketchUP', label: 'Arq 3D SketchUp (.glb)' },
                { path: '02_Estructural/02_Modelo_3D_SketchUP', label: 'Est 3D SketchUp' }
            ];
        case 'renders':
            return [
                { path: '05_Renders_y_Presentaciones/01_Renders', label: 'Renders 3D' }
            ];
        case 'img':
            return [
                { path: '08_Registro_Fotografico', label: 'Registro Fotográfico' },
                { path: '08_Registro_Fotografico/01_2025', label: 'Fotos 2025' },
                { path: '08_Registro_Fotografico/02_2026_1', label: 'Fotos 2026 P1' }
            ];
        case 'docs':
            return [
                { path: '07_Matriz_Accesibilidad_NTC_6047', label: 'Matriz Accesibilidad NTC 6047' }
            ];
        default:
            return [];
    }
}

/**
 * Centraliza búsqueda de archivos por bloque y ruta
 * @param {string} blockId
 * @param {string} filterPath (ruta de carpeta ej: '01_Arquitectonico/03_Entregables_PDF')
 * @returns {Array} List of matching files
 */
export function getFilesInPath(blockId, filterPath) {
    const files = Array.isArray(state.archivosNube) ? state.archivosNube : [];

    return files.filter(f => {
        if (!f) return false;

        // Comparación estricta de bloque
        if (String(f.bloque || '') !== String(blockId)) return false;

        // Validar si la ruta de carpeta coincide (usando startswith por si tiene subcarpetas adicionales o coincidencia exacta)
        const folderPath = String(f.carpeta || '');
        return folderPath === filterPath || folderPath.startsWith(filterPath + '/');
    });
}

/**
 * Obtiene el primer archivo en la ruta
 * @param {string} blockId
 * @param {string} filterPath 
 * @returns {Object|null} File object or null
 */
export function getFirstFileInPath(blockId, filterPath) {
    const matching = getFilesInPath(blockId, filterPath);
    return matching.length > 0 ? matching[0] : null;
}
