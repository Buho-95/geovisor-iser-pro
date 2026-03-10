/**
 * Constantes de la aplicación: colecciones Firestore, rutas Storage, tipos de archivo.
 */
export const COLLECTIONS = {
  ARCHIVOS: 'archivos_iser',
  USUARIOS: 'usuarios_iser',
  CAPAS_SIG: 'capas_sig',
  ESTADISTICAS: 'estadisticas'
};

export const STORAGE_PATHS = {
  DOCUMENTOS: 'documentos_iser',
  MODELOS_BIM: 'modelos_bim',
  CAPAS: 'capas_sig'
};

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
