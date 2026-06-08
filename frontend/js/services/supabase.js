/**
 * Servicio Supabase — frontend (sin bundle, ESM desde CDN).
 * Proporciona auth, base de datos y storage para la migración.
 *
 * IMPORTANTE: Este módulo convive en paralelo con firebase.js.
 * Se activa cuando DB_PROVIDER === 'supabase' en config.js.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Configuración de Supabase (leída de config.js)
const SUPABASE_URL = 'https://scglhxbysycuqqzgqzxe.supabase.co';
// Clave anon/public de Supabase (acceso controlado por RLS en el lado servidor)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZ2xoeGJ5c3ljdXFxemdxenhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MjM3NjYsImV4cCI6MjA5NjM5OTc2Nn0.NqDjxhXnRXOWKeykQO8szLwe9vqgamb2Hwhu9_tRJ7o';

let _supabaseClient = null;

/**
 * Devuelve la instancia singleton del cliente Supabase.
 */
export function getSupabaseClient() {
  if (!_supabaseClient) {
    _supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'geovisor_iser_sb_auth',
      },
    });
  }
  return _supabaseClient;
}

// Alias conveniente
export const supabase = { get client() { return getSupabaseClient(); } };

// ═══════════════════════════════════════════════════════════════
// AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════════

/**
 * Inicia sesión con email y contraseña en Supabase Auth.
 */
export async function signInWithEmail(email, password) {
  const sb = getSupabaseClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

/**
 * Inicia sesión como usuario anónimo (visitante).
 */
export async function signInAnonymousSupabase() {
  const sb = getSupabaseClient();
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  return data.user;
}

/**
 * Cierra la sesión actual.
 */
export async function signOutSupabase() {
  const sb = getSupabaseClient();
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

/**
 * Escucha cambios en el estado de autenticación.
 * @param {Function} callback - (user) => void
 * @returns {Function} función para cancelar la suscripción
 */
export function onSupabaseAuthChange(callback) {
  const sb = getSupabaseClient();
  const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => subscription.unsubscribe();
}

/**
 * Obtiene el usuario actualmente autenticado.
 */
export async function getCurrentSupabaseUser() {
  const sb = getSupabaseClient();
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

/**
 * Obtiene el token JWT (access_token) del usuario actual para enviarlo al backend.
 */
export async function getSupabaseToken(forceRefresh = false) {
  const sb = getSupabaseClient();
  if (forceRefresh) {
    const { data, error } = await sb.auth.refreshSession();
    if (error) throw error;
    return data.session?.access_token ?? null;
  }
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token ?? null;
}

// ═══════════════════════════════════════════════════════════════
// BASE DE DATOS (tablas Postgres via PostgREST)
// ═══════════════════════════════════════════════════════════════

/**
 * Obtiene el perfil del usuario de la tabla usuarios_iser.
 */
export async function getUserProfile(uid) {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('usuarios_iser')
    .select('*')
    .eq('uid', uid)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = row not found
  return data;
}

/**
 * Lee un bloque de bloques_estado por blockId.
 */
export async function getEstadoBloque(blockId) {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('bloques_estado')
    .select('*')
    .eq('block_id', blockId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/**
 * Lee todos los estados de bloques (equivale al onSnapshot de Firestore).
 */
export async function getAllEstadosBloques() {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('bloques_estado')
    .select('*');
  if (error) throw error;
  // Transformar a mapa { blockId: datos } igual que en Firestore
  const map = {};
  (data || []).forEach(row => { map[row.block_id] = row; });
  return map;
}

/**
 * Guarda / actualiza el estado de un bloque en bloques_estado.
 */
export async function guardarEstadoBloqueSupabase(blockId, datos) {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from('bloques_estado')
    .upsert({
      block_id: blockId,
      diagnostico_texto: datos.diagnostico_texto ?? null,
      score_infraestructura: datos.score_infraestructura ?? 0,
      color_sugerido: datos.color_sugerido ?? '#EF4444',
      radar_scores: datos.radar_scores ?? null,
      tareas_pendientes: datos.tareas_pendientes ?? [],
      normas: datos.normas ?? null,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
  return true;
}

/**
 * Lee la auditoría cacheada de un bloque.
 */
export async function getAuditoriaCachedSupabase(blockId) {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('auditorias_bloques')
    .select('*')
    .eq('block_id', blockId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  // Mapear snake_case de Postgres a camelCase del frontend
  if (!data) return null;
  return {
    resumen_ejecutivo: data.resumen_ejecutivo,
    normas: data.normas,
    puntaje_global: data.puntaje_global,
    tareas_pendientes: data.tareas_pendientes,
    archivoHash: data.archivo_hash,
    totalArchivosAlAuditar: data.total_archivos_al_auditar,
    fechaAuditoria: data.fecha_auditoria,
    blockId: data.block_id,
  };
}

/**
 * Guarda la auditoría generada en auditorias_bloques.
 */
export async function guardarAuditoriaSupabase(blockId, auditResult, inventario) {
  const { computeInventoryFingerprint } = await import('../core/inventoryHash.js');
  const archivoHash = computeInventoryFingerprint(inventario);
  const sb = getSupabaseClient();
  const { error } = await sb
    .from('auditorias_bloques')
    .upsert({
      block_id: blockId,
      resumen_ejecutivo: auditResult.resumen_ejecutivo,
      normas: auditResult.normas,
      puntaje_global: auditResult.puntaje_global ?? 0,
      tareas_pendientes: auditResult.tareas_pendientes ?? [],
      archivo_hash: archivoHash,
      total_archivos_al_auditar: inventario.totalArchivos,
      fecha_auditoria: new Date().toISOString(),
    });
  if (error) throw error;
  return true;
}

/**
 * Añade un registro de reporte al historial.
 */
export async function saveReportMetadataSupabase(blockId, blockName, downloadUrl, storagePath, userEmail) {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('reportes_historial')
    .insert({
      block_id: blockId,
      block_name: blockName,
      download_url: downloadUrl,
      storage_path: storagePath,
      user_email: userEmail,
      fecha: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Lee el historial de reportes (solo admin).
 */
export async function getReportHistorySupabase() {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('reportes_historial')
    .select('*')
    .order('fecha', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.id,
    blockId: r.block_id,
    blockName: r.block_name,
    downloadUrl: r.download_url,
    storagePath: r.storage_path,
    userEmail: r.user_email,
    fecha: r.fecha,
    createdAt: r.created_at,
  }));
}

/**
 * Elimina un reporte del historial y su archivo en Storage.
 */
export async function deleteReportSupabase(reportId, storagePath) {
  const sb = getSupabaseClient();
  if (storagePath) {
    const bucket = storagePath.startsWith('auditorias/') ? 'auditorias' : 'documentos_iser';
    const cleanPath = storagePath.replace(/^auditorias\//, '');
    const { error: storageErr } = await sb.storage
      .from(bucket)
      .remove([cleanPath]);
    if (storageErr) {
      console.warn('[Supabase Storage] No se pudo borrar el archivo:', storageErr.message);
    }
  }
  const { error } = await sb
    .from('reportes_historial')
    .delete()
    .eq('id', reportId);
  if (error) throw error;
}

// ═══════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════

/**
 * Resuelve el bucket de Supabase y la ruta interna a partir de un storagePath global.
 * @param {string} storagePath - Ejemplo: "sedes/pamplona/.../modelos_bim/archivo.rvt"
 * @returns {{ bucket: string, path: string }}
 */
export function resolveSupabaseBucketAndPath(storagePath) {
  let bucket = 'documentos_iser';
  if (storagePath.includes('modelos_bim/')) bucket = 'modelos_bim';
  else if (storagePath.includes('capas_sig/')) bucket = 'capas_sig';
  else if (storagePath.includes('auditorias/')) bucket = 'auditorias';

  // Limpiar el nombre del bucket de la ruta si el storagePath era estilo Firebase
  // (La migración guardó los archivos usando la ruta relativa sin el bucket en Supabase)
  let cleanPath = storagePath;
  const prefixes = ['documentos_iser/', 'modelos_bim/', 'capas_sig/', 'auditorias/'];
  for (const p of prefixes) {
    if (cleanPath.startsWith(p)) {
      cleanPath = cleanPath.substring(p.length);
      break;
    }
  }
  return { bucket, path: cleanPath };
}

/**
 * Lista archivos y subcarpetas en una ruta de Storage (imita el comportamiento de listAll de Firebase).
 * @param {string} storagePath - La ruta completa de Firebase Storage a listar.
 * @returns {Promise<{ items: Array, prefixes: Array }>}
 */
export async function listSupabaseStorage(storagePath) {
  const sb = getSupabaseClient();
  const { bucket, path } = resolveSupabaseBucketAndPath(storagePath);
  
  // Si la ruta no termina en '/', añadirla para buscar como directorio
  const searchPath = path === '' || path.endsWith('/') ? path : path + '/';
  
  const { data, error } = await sb.storage.from(bucket).list(searchPath, {
    limit: 1000,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  });

  if (error) {
    console.warn('[Supabase Storage] list failed for path:', searchPath, error);
    throw error;
  }

  const items = [];
  const prefixes = [];

  for (const item of data) {
    // Si id es nulo o metadata es null, Supabase lo considera una subcarpeta (placeholder .emptyFolderPlaceholder)
    // O si simplemente es un prefijo retornado por list
    if (item.id === null || !item.metadata) {
      prefixes.push({ name: item.name, fullPath: `${storagePath}/${item.name}`.replace(/\/\//g, '/') });
    } else {
      // Ignorar el archivo oculto .emptyFolderPlaceholder que Supabase usa para mantener carpetas
      if (item.name === '.emptyFolderPlaceholder') continue;
      
      const fullPath = `${storagePath}/${item.name}`.replace(/\/\//g, '/');
      const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(`${searchPath}${item.name}`);
      items.push({
        name: item.name,
        fullPath: fullPath,
        bucket: bucket,
        size: item.metadata?.size || 0,
        contentType: item.metadata?.mimetype || 'application/octet-stream',
        updated: item.updated_at,
        url: publicUrl
      });
    }
  }

  return { items, prefixes };
}

/**
 * Sube un archivo a Supabase Storage con progreso simulado.
 * Si se omite el bucket, se infiere automáticamente a partir del storagePath.
 */
export async function uploadToSupabaseStorage(bucketOrStoragePath, storagePathOrFile, fileOrProgress, onProgressObj) {
  let bucket, storagePath, file, onProgress;

  // Manejar sobrecarga de firma: (storagePath, file, onProgress) vs (bucket, storagePath, file, onProgress)
  if (typeof storagePathOrFile === 'string' && fileOrProgress instanceof File) {
    bucket = bucketOrStoragePath;
    storagePath = storagePathOrFile;
    file = fileOrProgress;
    onProgress = onProgressObj;
  } else {
    // Firma automatizada: (storagePath, file, onProgress)
    storagePath = bucketOrStoragePath;
    file = storagePathOrFile;
    onProgress = fileOrProgress;
    const resolved = resolveSupabaseBucketAndPath(storagePath);
    bucket = resolved.bucket;
    storagePath = resolved.path;
  }

  const sb = getSupabaseClient();
  const { data, error } = await sb.storage
    .from(bucket)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: true,
    });
  if (error) throw error;
  onProgress?.(100);
  const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(storagePath);
  return { url: publicUrl, storagePath: storagePath };
}

/**
 * Elimina un archivo de Supabase Storage.
 * Puede ser llamado con (bucket, storagePath) o solo con (storagePath).
 */
export async function deleteFromSupabaseStorage(bucketOrPath, storagePathOpt) {
  let bucket, storagePath;
  if (storagePathOpt) {
    bucket = bucketOrPath;
    storagePath = storagePathOpt;
  } else {
    const resolved = resolveSupabaseBucketAndPath(bucketOrPath);
    bucket = resolved.bucket;
    storagePath = resolved.path;
  }

  const sb = getSupabaseClient();
  const { error } = await sb.storage.from(bucket).remove([storagePath]);
  if (error) throw error;
}

/**
 * Obtiene la URL pública de un archivo en Supabase Storage.
 * Puede ser llamado con (bucket, storagePath) o solo con (storagePath).
 */
export function getSupabasePublicUrl(bucketOrPath, storagePathOpt) {
  let bucket, storagePath;
  if (storagePathOpt) {
    bucket = bucketOrPath;
    storagePath = storagePathOpt;
  } else {
    const resolved = resolveSupabaseBucketAndPath(bucketOrPath);
    bucket = resolved.bucket;
    storagePath = resolved.path;
  }

  const sb = getSupabaseClient();
  const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(storagePath);
  return publicUrl;
}
