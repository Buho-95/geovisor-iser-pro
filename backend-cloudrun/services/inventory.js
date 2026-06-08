'use strict';

const { supabaseAdmin } = require('./supabase');

const STORAGE_BASE = 'documentos_iser';
const CANONICAL_BASE = 'sedes';
const PLACEHOLDER_KEEP = '.keep';
const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || 'documentos_iser';

function computeInventoryFingerprint(inventario) {
  const archivos = Array.isArray(inventario.archivos) ? inventario.archivos : [];
  const part = archivos
    .map((a) => `${a.nombre || ''}@${a.updated || a.timeUpdated || ''}`)
    .sort()
    .join('|');
  return `${inventario.totalArchivos || archivos.length}:${part}`;
}

function withStoragePath(env, pathStr) {
  const normalized = pathStr.replace(/^\/+/, '');
  return env === 'staging' ? `staging/${normalized}` : normalized;
}

/**
 * Escanea de forma recursiva un prefijo en un bucket de Supabase Storage.
 */
async function scanPrefix(prefix, blockId, blockName, sede, basePathLabel) {
  const archivos = [];
  const subcarpetas = new Set();
  
  // Limpiar el prefijo para evitar barras inclinadas dobles o iniciales que rompan la búsqueda
  const cleanPrefix = prefix.replace(/^\/+/, '').replace(/\/+$/, '') + '/';

  try {
    const filesList = [];
    const foldersToScan = [cleanPrefix];

    while (foldersToScan.length > 0) {
      const currentFolder = foldersToScan.shift();
      
      // Listar contenido del directorio actual
      const { data, error } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .list(currentFolder.replace(/\/$/, ''), {
          limit: 1000,
          sortBy: { column: 'name', order: 'asc' }
        });

      if (error) {
        console.error(`Error listando directorio "${currentFolder}" en Supabase Storage:`, error.message);
        continue;
      }

      if (data) {
        for (const item of data) {
          const fullPath = currentFolder + item.name;
          
          if (item.id === null || (item.metadata && !item.metadata.size && item.name.endsWith('/'))) {
            // Es una subcarpeta
            foldersToScan.push(fullPath + '/');
          } else {
            // Es un archivo
            const nombre = item.name;
            if (nombre === PLACEHOLDER_KEEP) continue;

            const relativePath = fullPath.startsWith(cleanPrefix) 
              ? fullPath.substring(cleanPrefix.length) 
              : fullPath;
            
            const segments = relativePath.split('/').filter(Boolean);
            segments.pop(); // quitar el nombre del archivo
            const carpeta = segments.length ? segments.join('/') : 'raíz';

            // Agregar subcarpetas intermedias
            for (let i = 0; i < segments.length; i++) {
              subcarpetas.add(segments.slice(0, i + 1).join('/'));
            }

            // Obtener URL pública
            const { data: { publicUrl } } = supabaseAdmin.storage
              .from(BUCKET_NAME)
              .getPublicUrl(fullPath);

            const size = item.metadata ? (item.metadata.size || item.metadata.contentLength || 0) : 0;
            const contentType = item.metadata ? (item.metadata.mimetype || '') : '';

            const extension = nombre.includes('.') ? nombre.split('.').pop().toLowerCase() : 'sin_extension';

            archivos.push({
              id: fullPath,
              bloque: blockId,
              nombre,
              extension,
              tipo: extension,
              carpeta,
              rutaCompleta: fullPath,
              storagePath: fullPath,
              url: publicUrl,
              size,
              contentType,
              timeCreated: item.created_at,
              updated: item.updated_at
            });
          }
        }
      }
    }

    const inventario = {
      blockId,
      blockName,
      sede: sede || 'pamplona',
      basePath: basePathLabel,
      archivos,
      subcarpetas: Array.from(subcarpetas),
      totalArchivos: archivos.length,
      scanTimestamp: new Date().toISOString()
    };
    inventario.archivoHash = computeInventoryFingerprint(inventario);
    return inventario;
  } catch (err) {
    console.error(`Error escaneando prefijo "${prefix}":`, err.message);
    throw err;
  }
}

/**
 * Escanea rutas de Supabase Storage para construir el inventario del bloque.
 */
async function buildInventoryForBlock(blockId, blockName, sede, env) {
  const s = sede || 'pamplona';
  const nsEnv = env || 'production';
  const legacyBase = withStoragePath(nsEnv, STORAGE_BASE);
  const canonicalBase = withStoragePath(nsEnv, CANONICAL_BASE);

  // 1. Escanear ruta canónica (sedes/{sede}/{blockId}/)
  const canonicalPrefix = `${canonicalBase}/${s}/${blockId}/`;
  const canonicalInv = await scanPrefix(
    canonicalPrefix, blockId, blockName || blockId, s,
    `${canonicalBase}/${s}/${blockId}`
  );

  // 2. Escanear rutas legadas.
  // Los archivos actuales viven en la raíz del bucket: {blockId}/
  // (sin prefijo de sede ni de bucket). Se intenta primero esa ruta.
  const legacyAttempts = [
    { prefix: `${blockId}/`, label: blockId },
    { prefix: `${s}/${blockId}/`, label: `${s}/${blockId}` },
    { prefix: `${legacyBase}/${blockId}/`, label: `${legacyBase}/${blockId}` },
    { prefix: `${legacyBase}/${s}/${blockId}/`, label: `${legacyBase}/${s}/${blockId}` },
  ];
  if (blockName && blockName !== blockId) {
    legacyAttempts.push(
      { prefix: `${blockName}/`, label: blockName },
      { prefix: `${legacyBase}/${blockName}/`, label: `${legacyBase}/${blockName}` }
    );
  }

  let legacyInv = null;
  for (const a of legacyAttempts) {
    try {
      const inv = await scanPrefix(a.prefix, blockId, blockName || blockId, s, a.label);
      inv.env = nsEnv;
      if (inv.totalArchivos > 0) { 
        legacyInv = inv; 
        break; 
      }
    } catch (e) {
      console.warn(`Intento de escaneo legado fallido para prefix "${a.prefix}":`, e.message);
    }
  }

  // 3. Fusionar resultados
  const hasCanonical = canonicalInv.totalArchivos > 0;
  const hasLegacy = legacyInv && legacyInv.totalArchivos > 0;

  if (hasCanonical && hasLegacy) {
    return mergeInventories([canonicalInv, legacyInv], blockId, blockName, s, nsEnv);
  }
  if (hasCanonical) { canonicalInv.env = nsEnv; return canonicalInv; }
  if (hasLegacy)    { legacyInv.env = nsEnv; return legacyInv; }

  // Vacío: no se encontraron archivos
  return {
    blockId,
    blockName: blockName || blockId,
    sede: s,
    env: nsEnv,
    basePath: `${canonicalBase}/${s}/${blockId}`,
    archivos: [],
    subcarpetas: [],
    totalArchivos: 0,
    scanTimestamp: new Date().toISOString(),
    archivoHash: '0:',
  };
}

/**
 * Fusiona inventarios duplicados.
 */
function mergeInventories(inventories, blockId, blockName, sede, env) {
  const seen = new Map();
  const allSubcarpetas = new Set();

  for (const inv of inventories) {
    for (const f of (inv.archivos || [])) {
      const key = `${f.carpeta || ''}/${f.nombre}`;
      if (!seen.has(key)) {
        seen.set(key, f);
      }
    }
    for (const sc of (inv.subcarpetas || [])) {
      allSubcarpetas.add(sc);
    }
  }

  const archivos = Array.from(seen.values());
  const merged = {
    blockId,
    blockName: blockName || blockId,
    sede,
    env,
    basePath: inventories[0].basePath,
    archivos,
    subcarpetas: Array.from(allSubcarpetas),
    totalArchivos: archivos.length,
    scanTimestamp: new Date().toISOString(),
  };
  merged.archivoHash = computeInventoryFingerprint(merged);
  return merged;
}

module.exports = { buildInventoryForBlock };
