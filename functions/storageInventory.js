'use strict';

const admin = require('firebase-admin');
const { computeInventoryFingerprint } = require('./inventoryHash');
const { withStoragePath } = require('./envNamespace');

const STORAGE_BASE = 'documentos_iser';
const CANONICAL_BASE = 'sedes';
const PLACEHOLDER_KEEP = '.keep';

/**
 * Lista recursiva vía Admin SDK (sin listAll en cliente).
 * Filtra archivos .keep placeholder usados por los scripts de seeding.
 */
async function scanPrefix(prefix, blockId, blockName, sede, basePathLabel) {
  const bucket = admin.storage().bucket();
  const bucketName = bucket.name;
  const archivos = [];
  const subcarpetas = new Set();

  const [files] = await bucket.getFiles({ prefix, autoPaginate: true });

  for (const f of files) {
    const full = f.name;
    if (full.endsWith('/')) continue;

    const rel = full.startsWith(prefix) ? full.substring(prefix.length) : full;
    const segments = rel.split('/').filter(Boolean);
    const nombre = segments.pop() || full.split('/').pop();

    // Skip .keep placeholder files created by seed scripts
    if (nombre === PLACEHOLDER_KEEP) continue;

    const folderParts = segments;
    const carpeta = folderParts.length ? folderParts.join('/') : 'raíz';

    for (let i = 0; i < folderParts.length; i++) {
      subcarpetas.add(folderParts.slice(0, i + 1).join('/'));
    }

    const meta = f.metadata || {};
    const tokenRaw = (meta.metadata && meta.metadata.firebaseStorageDownloadTokens) || '';
    const token = tokenRaw.split(',')[0] || '';
    const encodedPath = encodeURIComponent(full);
    const downloadUrl = token
      ? `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${token}`
      : '';
    const metaExtra = {
      size: Number(meta.size) || 0,
      contentType: meta.contentType || '',
      timeCreated: meta.timeCreated,
      updated: meta.updated,
    };

    const extension = nombre.includes('.') ? nombre.split('.').pop().toLowerCase() : 'sin_extension';
    archivos.push({
      id: full,
      bloque: blockId,
      nombre,
      extension,
      tipo: extension,
      carpeta,
      rutaCompleta: full,
      storagePath: full,
      url: downloadUrl,
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
 * Escanea AMBAS rutas (canónica sedes/ y legado documentos_iser/) y devuelve
 * un inventario fusionado y deduplicado.
 *
 * Prioridad: archivos en la ruta canónica prevalecen sobre los legados
 * cuando existe colisión por carpeta/nombre.
 *
 * @param {string} blockId
 * @param {string} blockName
 * @param {string} sede
 * @param {string} [env='production']  namespace a consultar ("staging" | "production")
 */
async function buildInventoryForBlock(blockId, blockName, sede, env) {
  const s = sede || 'pamplona';
  const nsEnv = env || 'production';
  const legacyBase = withStoragePath(nsEnv, STORAGE_BASE);
  const canonicalBase = withStoragePath(nsEnv, CANONICAL_BASE);

  // 1. Scan canonical path (sedes/{sede}/{blockId}/)
  const canonicalPrefix = `${canonicalBase}/${s}/${blockId}/`;
  const canonicalInv = await scanPrefix(
    canonicalPrefix, blockId, blockName || blockId, s,
    `${canonicalBase}/${s}/${blockId}`
  );

  // 2. Scan legacy paths (documentos_iser/{blockId}/, etc.)
  const legacyAttempts = [
    { prefix: `${legacyBase}/${blockId}/`, label: `${legacyBase}/${blockId}` },
    { prefix: `${legacyBase}/${s}/${blockId}/`, label: `${legacyBase}/${s}/${blockId}` },
  ];
  if (blockName && blockName !== blockId) {
    legacyAttempts.push({
      prefix: `${legacyBase}/${blockName}/`,
      label: `${legacyBase}/${blockName}`,
    });
  }

  let legacyInv = null;
  for (const a of legacyAttempts) {
    const inv = await scanPrefix(a.prefix, blockId, blockName || blockId, s, a.label);
    inv.env = nsEnv;
    if (inv.totalArchivos > 0) { legacyInv = inv; break; }
  }

  // 3. Merge results
  const hasCanonical = canonicalInv.totalArchivos > 0;
  const hasLegacy = legacyInv && legacyInv.totalArchivos > 0;

  if (hasCanonical && hasLegacy) {
    return mergeInventories([canonicalInv, legacyInv], blockId, blockName, s, nsEnv);
  }
  if (hasCanonical) { canonicalInv.env = nsEnv; return canonicalInv; }
  if (hasLegacy)    { legacyInv.env = nsEnv; return legacyInv; }

  // Empty: no files found in either path
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
 * Fusiona múltiples inventarios deduplicando por carpeta/nombre.
 * El primer inventario (canónico) tiene prioridad en caso de colisión.
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

module.exports = { buildInventoryForBlock, STORAGE_BASE };
