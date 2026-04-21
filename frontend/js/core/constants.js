/**
 * Constantes de la aplicación: colecciones Firestore, rutas Storage, tipos de archivo.
 *
 * Esquema de nombres:
 *   - *_RAW            → nombre base histórico (producción y desarrollo local).
 *   - COLLECTIONS      → env-aware: prefijado con "staging_" cuando ENV=staging.
 *   - STORAGE_PATHS    → env-aware: prefijado con "staging/" cuando ENV=staging.
 *
 * Regla: NUNCA usar *_RAW directamente para leer/escribir en runtime.
 *        Usar SIEMPRE COLLECTIONS / STORAGE_PATHS o los helpers de paths.js.
 *        *_RAW solo existe para scripts de migración e introspección.
 */
import { getCollection, getStoragePath } from './paths.js';

export const COLLECTIONS_RAW = Object.freeze({
  ARCHIVOS: 'archivos_iser',
  USUARIOS: 'usuarios_iser',
  CAPAS_SIG: 'capas_sig',
  ESTADISTICAS: 'estadisticas',
  ESTADOS_BLOQUES: 'bloques_estado',
  AUDITORIAS_BLOQUES: 'auditorias_bloques',
  REPORTES_HISTORIAL: 'reportes_historial',
  INVENTARIO_BLOQUES: 'inventario_bloques',
  ESTRUCTURA_BASE:    'estructura_base',
  ESTRUCTURA_DINAMICA:'estructura_dinamica',
});

export const STORAGE_PATHS_RAW = Object.freeze({
  DOCUMENTOS: 'documentos_iser',
  MODELOS_BIM: 'modelos_bim',
  CAPAS: 'capas_sig',
  AUDITORIAS: 'auditorias',
});

export const COLLECTIONS = Object.freeze({
  ARCHIVOS:            getCollection(COLLECTIONS_RAW.ARCHIVOS),
  USUARIOS:            getCollection(COLLECTIONS_RAW.USUARIOS),
  CAPAS_SIG:           getCollection(COLLECTIONS_RAW.CAPAS_SIG),
  ESTADISTICAS:        getCollection(COLLECTIONS_RAW.ESTADISTICAS),
  ESTADOS_BLOQUES:     getCollection(COLLECTIONS_RAW.ESTADOS_BLOQUES),
  AUDITORIAS_BLOQUES:  getCollection(COLLECTIONS_RAW.AUDITORIAS_BLOQUES),
  REPORTES_HISTORIAL:  getCollection(COLLECTIONS_RAW.REPORTES_HISTORIAL),
  INVENTARIO_BLOQUES:  getCollection(COLLECTIONS_RAW.INVENTARIO_BLOQUES),
  ESTRUCTURA_BASE:     getCollection(COLLECTIONS_RAW.ESTRUCTURA_BASE),
  ESTRUCTURA_DINAMICA: getCollection(COLLECTIONS_RAW.ESTRUCTURA_DINAMICA),
});

export const STORAGE_PATHS = Object.freeze({
  DOCUMENTOS:   getStoragePath(STORAGE_PATHS_RAW.DOCUMENTOS),
  MODELOS_BIM:  getStoragePath(STORAGE_PATHS_RAW.MODELOS_BIM),
  CAPAS:        getStoragePath(STORAGE_PATHS_RAW.CAPAS),
  AUDITORIAS:   getStoragePath(STORAGE_PATHS_RAW.AUDITORIAS),
});

export const FILE_TYPES = {
  PDF: 'pdf',
  DWG: 'dwg',
  RVT: 'rvt',
  EXCEL: 'excel',
  IMG: 'img',
  IFC: 'ifc',
  OTRO: 'otro'
};

export const USER_ROLES = {
  VIEWER: 'viewer',
  EDITOR: 'editor',
  ADMIN: 'admin'
};
