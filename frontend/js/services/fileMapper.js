import { state } from '../core/state.js';

/**
 * Normaliza strings de forma más agresiva para búsqueda robusta,
 * eliminando tildes, caracteres especiales, y colapsando espacios/guiones.
 */
export function normalizeKey(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Elimina acentos
        .replace(/[^a-zA-Z0-9]/g, '')    // Elimina espacios, guiones, guiones bajos... todo lo no alfanumérico
        .toLowerCase()
        .trim();
}

/**
 * Construye una ruta base dependiente del contexto.
 * @param {string} path - Ruta interna de la categoría.
 * @param {string} [sedePrefix=''] - Prefijo opcional de la sede.
 * @returns {string} Ruta completa.
 */
export function buildPath(path, sedePrefix = '') {
    return sedePrefix ? `${sedePrefix}/${path}` : path;
}

/**
 * Obtiene las rutas de carpetas específicas para un tipo de filtro (3D, PDF, RENDERS, FOTOS)
 * Preparado para soportar múltiples sedes dinámicamente mediante sedePrefix.
 * @param {string} filterType - '3d' | 'pdf' | 'renders' | 'img'
 * @param {string} [sedePrefix=''] - Prefijo de la sede.
 * @returns {Array<{path: string, label: string}>}
 */
export function getPathsForFilter(filterType, sedePrefix = '') {
    const build = (path, label) => ({ path: buildPath(path, sedePrefix), label });

    switch (filterType) {
        case 'pdf':
            return [
                build('01_Arquitectonico/03_Entregables_PDF', 'Arquitectónico PDF'),
                build('02_Estructural/03_Entregables_PDF', 'Estructural PDF'),
                build('03_Electricos_y_Red_de_Datos/01_Electricos/02_Entregables_PDF', 'Eléctricos PDF'),
                build('03_Electricos_y_Red_de_Datos/02_Redes_de_Datos/02_Entregables_PDF', 'Redes Data PDF'),
                build('04_Hidrosanitarios_y_Gas/01_Gas/03_Entregables_PDF', 'Gas PDF'),
                build('04_Hidrosanitarios_y_Gas/02_Hidrosanitarios/03_Entregables_PDF', 'Hidrosanitario PDF')
            ];
        case '3d':
            return [
                build('01_Arquitectonico/02_Modelo_3D_SketchUP', 'Arq 3D SketchUp (.glb)'),
                build('02_Estructural/02_Modelo_3D_SketchUP', 'Est 3D SketchUp'),
                build('01_Arquitectonico/02_Modelo_3D_Blender', 'Arq 3D Blender (.glb)')
            ];
        case 'renders':
            return [
                build('05_Renders_y_Presentaciones/01_Renders', 'Renders 3D')
            ];
        case 'img':
            return [
                build('08_Registro_Fotografico/01_2025', 'Fotos 2025'),
                build('08_Registro_Fotografico/02_2026_1', 'Fotos 2026 P1')
            ];
        case 'docs':
            return [
                build('07_Matriz_Accesibilidad_NTC_6047', 'Matriz Accesibilidad NTC 6047'),
                build('06_Documentos/Certificados', 'Certificados'),
                build('06_Documentos/Licencias', 'Licencias'),
                build('06_Documentos/Actas', 'Actas'),
                build('06_Documentos/Otros', 'Otros Documentos')
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

    // Build set of acceptable block identifiers (ID + display name variants)
    const validBlocks = new Set();
    validBlocks.add(String(blockId).toLowerCase());
    // Also resolve the block's display name from campus-data if available
    try {
        const campusData = window.__campusDataCache;
        if (campusData && campusData[blockId]) {
            const name = campusData[blockId].name;
            if (name) {
                validBlocks.add(name.toLowerCase());
                validBlocks.add(normalizeKey(name));
            }
        }
    } catch { /* noop */ }

    const results = files.filter(f => {
        if (!f) return false;

        // Match bloque by ID or display name
        const fBloque = String(f.bloque || '').toLowerCase();
        const fBloqueNorm = normalizeKey(f.bloque);
        const bloqueMatch = validBlocks.has(fBloque) || validBlocks.has(fBloqueNorm);
        if (!bloqueMatch) return false;

        // Validate folder path
        const folderPath = String(f.carpeta || '');
        return folderPath === filterPath || folderPath.startsWith(filterPath + '/');
    });

    // FAT-01 Fallback: Si no hay resultados y filterPath tiene un prefijo de sede ('pamplona/'), buscar en la raíz.
    if (results.length === 0 && filterPath.includes('/')) {
        const fallbackPath = filterPath.split('/').slice(1).join('/');
        return files.filter(f => {
            if (!f) return false;
            const fBloque = String(f.bloque || '').toLowerCase();
            const fBloqueNorm = normalizeKey(f.bloque);
            const bloqueMatch = validBlocks.has(fBloque) || validBlocks.has(fBloqueNorm);
            if (!bloqueMatch) return false;

            const folderPath = String(f.carpeta || '');
            return folderPath === fallbackPath || folderPath.startsWith(fallbackPath + '/');
        });
    }

    return results;
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
