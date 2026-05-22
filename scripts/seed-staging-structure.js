#!/usr/bin/env node
/**
 * seed-staging-structure.js — Inicializa estructura canónica en staging.
 *
 *   Firestore: staging_estructura_base / staging_estructura_dinamica
 *   Storage:   staging/sedes/{sedeId}/.../.keep
 *
 * SEGURIDAD:
 *   - Dry-run por defecto. Usa --apply para escribir.
 *   - Escribe SOLO en prefijos staging_  y staging/ (nunca producción).
 *   - Con --clear borra primero TODO lo existente en staging_estructura_* y staging/sedes/**.
 *
 * USO:
 *   node scripts/seed-staging-structure.js                   # dry-run
 *   node scripts/seed-staging-structure.js --apply           # ejecuta
 *   node scripts/seed-staging-structure.js --apply --clear   # limpia staging y reseed completo
 *   node scripts/seed-staging-structure.js --apply --only=firestore
 *   node scripts/seed-staging-structure.js --apply --only=storage
 *   node scripts/seed-staging-structure.js --apply --sede=pamplona
 */
'use strict';

const path = require('path');
const fs = require('fs');

const adminPath = path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin');
if (!fs.existsSync(adminPath)) {
  console.error('[SEED] firebase-admin no encontrado. Ejecuta: cd functions && npm install');
  process.exit(1);
}
const admin = require(adminPath);

const PROJECT_ID    = 'geovisor-iser';
const BUCKET_NAME   = `${PROJECT_ID}.firebasestorage.app`;
const COL_BASE      = 'staging_estructura_base';
const COL_DINAMICA  = 'staging_estructura_dinamica';
const STORAGE_PREFIX= 'staging/sedes';

const args = process.argv.slice(2);
const DRY_RUN  = !args.includes('--apply');
const CLEAR    = args.includes('--clear');
const onlyArg  = args.find(a => a.startsWith('--only='));
const ONLY     = onlyArg ? onlyArg.split('=')[1] : 'all';
const sedeArg  = args.find(a => a.startsWith('--sede='));
const SEDE_FILTER = sedeArg ? sedeArg.split('=')[1] : null;

function safetyCheck() {
  if (!COL_BASE.startsWith('staging_') || !COL_DINAMICA.startsWith('staging_')) {
    throw new Error('SEGURIDAD: destino no empieza con staging_');
  }
  if (!STORAGE_PREFIX.startsWith('staging/')) {
    throw new Error('SEGURIDAD: STORAGE_PREFIX no empieza con staging/');
  }
}

function loadSchema() {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'shared', 'estructura-base.json'),
    'utf8'
  ));
}

let tempAdcPath = null;
function cleanupAdc() {
  if (tempAdcPath && fs.existsSync(tempAdcPath)) {
    try {
      fs.unlinkSync(tempAdcPath);
      console.log('   [auth] Credencial temporal limpia (.firebase/temp-adc.json)');
    } catch (e) {
      // Ignorar error al limpiar
    }
    tempAdcPath = null;
  }
}

// Registrar manejadores para asegurar la limpieza del archivo temporal
process.on('exit', cleanupAdc);
process.on('SIGINT', () => { cleanupAdc(); process.exit(130); });
process.on('SIGTERM', () => { cleanupAdc(); process.exit(143); });
process.on('uncaughtException', (err) => {
  console.error('[SEED] Excepción no controlada:', err);
  cleanupAdc();
  process.exit(1);
});

function initAdmin() {
  if (admin.apps.length) return;

  // 1) Si hay GOOGLE_APPLICATION_CREDENTIALS, firebase-admin la usará automáticamente.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('   [auth] Usando GOOGLE_APPLICATION_CREDENTIALS existente');
    admin.initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET_NAME });
    return;
  }

  // 2) Leer refresh token del Firebase CLI (firebase-tools.json)
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const configPath = path.join(home, '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(configPath)) {
    console.error('[SEED] No se encontraron credenciales.');
    console.error('       Opciones:');
    console.error('         1) firebase login (y reintentar)');
    console.error('         2) set GOOGLE_APPLICATION_CREDENTIALS=C:\\ruta\\service-account.json');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const refreshToken = config.tokens && config.tokens.refresh_token;
  if (!refreshToken) {
    console.error('[SEED] firebase-tools.json no contiene refresh_token. Ejecuta: firebase login --reauth');
    process.exit(1);
  }

  // Client ID/Secret públicos del Firebase CLI
  const FIREBASE_CLI_CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
  const FIREBASE_CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

  const adc = {
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET,
    refresh_token: refreshToken,
    type: 'authorized_user'
  };

  const dotFirebaseDir = path.join(__dirname, '..', '.firebase');
  if (!fs.existsSync(dotFirebaseDir)) {
    fs.mkdirSync(dotFirebaseDir, { recursive: true });
  }

  tempAdcPath = path.join(dotFirebaseDir, 'temp-adc.json');
  fs.writeFileSync(tempAdcPath, JSON.stringify(adc, null, 2));

  process.env.GOOGLE_APPLICATION_CREDENTIALS = tempAdcPath;
  console.log('   [auth] Generado ADC temporal a partir de Firebase CLI');
  admin.initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET_NAME });
}

/* ═══════════════ Construcción árbol (mirror de structure-schema.js) ═══════════════ */

function makeNode(name, pathStr, kind, dynamic) {
  return { name, path: pathStr, kind, dynamic: !!dynamic, children: [] };
}
function normalizeSub(subList) {
  return (subList || []).map(x => typeof x === 'string' ? { nombre: x, dinamica: false } : x);
}
function buildSubRepNodes(sub, basePath) {
  return sub.map(sc => {
    const n = makeNode(sc.nombre, `${basePath}/${sc.nombre}`, 'subcarpeta', !!sc.dinamica);
    if (sc.dinamica) n.acceptsDynamic = true;
    return n;
  });
}
function buildBloqueTree(schema, bloqueId) {
  const esLab = Array.isArray(schema.bloquesConLaboratorio) && schema.bloquesConLaboratorio.includes(bloqueId);
  const sub = normalizeSub(schema.subestructuraRepetible);
  const defs = schema.disciplinaBloque;
  const out = [];
  for (const disc of schema.disciplinasBaseBloque) {
    const def = defs[disc]; if (!def) continue;
    const dpath = `${bloqueId}/${disc}`;
    const node = makeNode(disc, dpath, 'disciplina', false);

    if (def.tipo === 'subestructura_repetible') {
      node.children = buildSubRepNodes(sub, dpath);
    } else if (def.tipo === 'especialidades') {
      for (const [espId, espDef] of Object.entries(def.especialidades)) {
        const epath = `${dpath}/${espId}`;
        const enode = makeNode(espId, epath, 'especialidad', false);
        if (espDef.normal && espDef.laboratorio) {
          const v = esLab ? espDef.laboratorio : espDef.normal;
          if (v.tipo === 'subestructura_repetible') {
            enode.children = buildSubRepNodes(sub, epath);
          } else if (v.tipo === 'carpetas_con_subestructura_repetible') {
            // Regla verde v3: cada carpeta contiene subestructura repetible.
            enode.children = (v.carpetas || []).map(x => {
              const name = typeof x === 'string' ? x : x.nombre;
              const vn = makeNode(name, `${epath}/${name}`, 'subcarpeta_lab', false);
              vn.children = buildSubRepNodes(sub, vn.path);
              return vn;
            });
          } else if (v.tipo === 'variantes_hoja') {
            enode.children = (v.variantes || []).map(x => {
              const n = makeNode(x.nombre, `${epath}/${x.nombre}`, 'subcarpeta_lab', !!x.dinamica);
              if (x.dinamica) n.acceptsDynamic = true;
              return n;
            });
          }
        } else if (espDef.tipo === 'subestructura_repetible') {
          enode.children = buildSubRepNodes(sub, epath);
        } else if (espDef.tipo === 'directo') {
          enode.dynamic = !!espDef.dinamica;
          if (espDef.dinamica) enode.acceptsDynamic = true;
        } else if (espDef.tipo === 'fijas') {
          enode.children = (espDef.subcarpetas || []).map(sc => {
            const n = makeNode(sc.nombre, `${epath}/${sc.nombre}`, 'subcarpeta', !!sc.dinamica);
            if (sc.dinamica) n.acceptsDynamic = true;
            return n;
          });
        }
        node.children.push(enode);
      }
    } else if (def.tipo === 'fijas') {
      node.children = (def.subcarpetas || []).map(sc => {
        const n = makeNode(sc.nombre, `${dpath}/${sc.nombre}`, 'subcarpeta', !!sc.dinamica);
        if (sc.dinamica) n.acceptsDynamic = true;
        return n;
      });
    } else if (def.tipo === 'directo') {
      node.dynamic = !!def.dinamica;
      if (def.dinamica) node.acceptsDynamic = true;
    }
    out.push(node);
  }
  return out;
}

function buildNivelSedeFromDef(def, basePath, sub) {
  if (!def || typeof def !== 'object') return [];
  if (def.tipo === 'directo') return [];
  if (def.tipo === 'subestructura_repetible') return buildSubRepNodes(sub, basePath);
  if (def.tipo === 'carpetas_explicitas') {
    const carpetas = def.carpetas && typeof def.carpetas === 'object' ? def.carpetas : {};
    return Object.entries(carpetas).map(([name, childDef]) => {
      const childPath = `${basePath}/${name}`;
      const acceptsDyn = childDef?.tipo === 'directo' && !!childDef?.dinamica;
      const n = makeNode(name, childPath, 'subcarpeta_sede', acceptsDyn);
      if (acceptsDyn) n.acceptsDynamic = true;
      n.children = buildNivelSedeFromDef(childDef, childPath, sub);
      return n;
    });
  }
  return [];
}

function buildSedeLevelTree(schema, sede) {
  const roles = schema.nivelSedeRoles && typeof schema.nivelSedeRoles === 'object' ? schema.nivelSedeRoles : {};
  const sub = normalizeSub(schema.subestructuraRepetible);
  const folders = Array.isArray(sede.nivelSede) ? sede.nivelSede : [];
  const out = [];
  for (const raw of folders) {
    let folderId = null;
    let rol = null;
    if (typeof raw === 'string') folderId = raw;
    else if (raw && typeof raw === 'object') {
      folderId = raw.id || raw.nombre || raw.name;
      rol = raw.rol || raw.role || null;
    }
    if (!folderId) continue;
    if (folderId === '11_Historicos') continue; // v3: ya no va en sede
    const def = rol && roles[rol] ? roles[rol] : null;
    const acceptsDyn = def?.tipo === 'directo' && !!def?.dinamica;
    const n = makeNode(folderId, folderId, 'nivel_sede', acceptsDyn);
    if (acceptsDyn) n.acceptsDynamic = true;
    n.children = def ? buildNivelSedeFromDef(def, folderId, sub) : [];
    out.push(n);
  }
  return out;
}

/* ═══════════════ Clear ═══════════════ */

async function clearStaging() {
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  // Firestore
  for (const col of [COL_BASE, COL_DINAMICA]) {
    const snap = await db.collection(col).get();
    let deleted = 0;
    let batch = db.batch();
    for (const d of snap.docs) {
      if (!d.ref.path.startsWith(`${col}/`)) {
        throw new Error(`SEGURIDAD: ruta inesperada al borrar: ${d.ref.path}`);
      }
      batch.delete(d.ref);
      deleted++;
      if (deleted % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    if (deleted % 400 !== 0) await batch.commit();
    console.log(`   [clear] Firestore: ${col} → ${deleted} doc(s) eliminados`);
  }

  // Storage
  const prefix = `${STORAGE_PREFIX}/`;
  if (!prefix.startsWith('staging/')) throw new Error('SEGURIDAD: prefix storage');
  const [files] = await bucket.getFiles({ prefix });
  let del = 0;
  for (const f of files) {
    if (!f.name.startsWith('staging/')) {
      throw new Error(`SEGURIDAD: archivo fuera de staging/: ${f.name}`);
    }
    await f.delete({ ignoreNotFound: true });
    del++;
  }
  console.log(`   [clear] Storage: ${prefix}** → ${del} archivo(s) eliminados`);
}

/* ═══════════════ Seed ═══════════════ */

async function seedFirestore(schema) {
  const db = admin.firestore();
  let count = 0;
  for (const [sedeId, sede] of Object.entries(schema.sedes)) {
    if (SEDE_FILTER && sedeId !== SEDE_FILTER) continue;
    const nivelSede = buildSedeLevelTree(schema, sede);
    const bloques = {};
    for (const [bloqueId] of Object.entries(sede.bloques || {})) {
      const esLab = Array.isArray(schema.bloquesConLaboratorio) && schema.bloquesConLaboratorio.includes(bloqueId);
      bloques[bloqueId] = {
        tipo: esLab ? 'laboratorio' : 'normal',
        mapBlockId: sede.bloques[bloqueId].mapBlockId || null,
        tree: buildBloqueTree(schema, bloqueId),
      };
    }
    const doc = {
      sedeId,
      nombreCanonico: sede.nombreCanonico,
      nombreMostrar:  sede.nombreMostrar,
      schemaVersion:  schema.version,
      bloquesConLaboratorio: schema.bloquesConLaboratorio || [],
      nivelSede,
      bloques,
      generadoEn: admin.firestore.FieldValue.serverTimestamp(),
      origen: 'seed-staging-structure',
    };
    const ref = db.collection(COL_BASE).doc(sedeId);
    if (!ref.path.startsWith(`${COL_BASE}/`)) throw new Error(`SEGURIDAD: ${ref.path}`);
    if (DRY_RUN) {
      console.log(`   [dry] Firestore: ${ref.path}`);
    } else {
      await ref.set(doc, { merge: true });
      console.log(`   [ok]  Firestore: ${ref.path}`);
    }
    count++;
  }
  console.log(`   → ${count} doc(s) sede en ${COL_BASE}`);
}

function collectLeafPaths(nodes, acc = []) {
  for (const n of nodes) {
    if (!n.children || n.children.length === 0) acc.push(n.path);
    else collectLeafPaths(n.children, acc);
  }
  return acc;
}

async function seedStorage(schema) {
  const bucket = admin.storage().bucket();
  let created = 0, existing = 0;
  for (const [sedeId, sede] of Object.entries(schema.sedes)) {
    if (SEDE_FILTER && sedeId !== SEDE_FILTER) continue;
    const nivelSede = buildSedeLevelTree(schema, sede);
    const allPaths = [...collectLeafPaths(nivelSede)];
    for (const [bloqueId] of Object.entries(sede.bloques || {})) {
      allPaths.push(...collectLeafPaths(buildBloqueTree(schema, bloqueId)));
    }
    for (const leaf of allPaths) {
      const full = `${STORAGE_PREFIX}/${sedeId}/${leaf}/.keep`;
      if (!full.startsWith('staging/')) throw new Error(`SEGURIDAD: ${full}`);
      if (DRY_RUN) { console.log(`   [dry] Storage: ${full}`); continue; }
      const file = bucket.file(full);
      const [exists] = await file.exists();
      if (exists) { existing++; continue; }
      await file.save(
        `# Placeholder estructura canónica\n# Sede: ${sedeId}\n# Ruta: ${leaf}\n`,
        { contentType: 'text/plain; charset=utf-8', resumable: false, metadata: {
          metadata: { placeholder: 'true', sedeId, generadoPor: 'seed-staging-structure' }
        }}
      );
      created++;
    }
  }
  console.log(`   → Storage: ${created} placeholder(s) creado(s), ${existing} ya existían.`);
}

/* ═══════════════ Main ═══════════════ */

(async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Seed Estructura Canónica → STAGING (schema v3)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` Proyecto:     ${PROJECT_ID}`);
  console.log(` Modo:         ${DRY_RUN ? 'DRY-RUN (sin escribir)' : 'APPLY (escribe)'}${CLEAR ? '  [+CLEAR]' : ''}`);
  console.log(` Ámbito:       ${ONLY}`);
  if (SEDE_FILTER) console.log(` Sede filtro:  ${SEDE_FILTER}`);
  console.log('');

  safetyCheck();
  initAdmin();
  const schema = loadSchema();
  console.log(` Schema v${schema.version} cargado. Sedes: ${Object.keys(schema.sedes).join(', ')}`);
  console.log(` Bloques con laboratorio: ${(schema.bloquesConLaboratorio || []).join(', ') || '(ninguno)'}`);
  console.log('');

  if (CLEAR) {
    console.log('── Clear staging ──────────────────────────────────');
    if (DRY_RUN) {
      console.log('   [dry] Se borrarían docs de staging_estructura_base, staging_estructura_dinamica y storage/staging/sedes/**');
    } else {
      await clearStaging();
    }
    console.log('');
  }

  if (ONLY === 'all' || ONLY === 'firestore') {
    console.log('── Firestore (staging_estructura_base) ────────────');
    await seedFirestore(schema);
    console.log('');
  }
  if (ONLY === 'all' || ONLY === 'storage') {
    console.log('── Storage (staging/sedes/**/.keep) ───────────────');
    await seedStorage(schema);
    console.log('');
  }

  console.log(DRY_RUN
    ? '[OK] Dry-run finalizado. Ejecuta con --apply para escribir.'
    : '[OK] Seed completado.');
  process.exit(0);
})().catch(err => {
  console.error('[SEED] ERROR:', err && err.message ? err.message : err);
  process.exit(1);
});
