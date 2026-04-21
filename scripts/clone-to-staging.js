#!/usr/bin/env node
/**
 * clone-to-staging.js
 *
 * Copia colecciones Firestore y objetos Storage desde el namespace de PRODUCCIÓN
 * al namespace de STAGING dentro del MISMO proyecto Firebase `geovisor-iser`.
 *
 *   Firestore:  archivos_iser          →  staging_archivos_iser
 *               usuarios_iser          →  staging_usuarios_iser
 *               bloques_estado         →  staging_bloques_estado
 *               auditorias_bloques     →  staging_auditorias_bloques
 *               inventario_bloques     →  staging_inventario_bloques
 *               reportes_historial     →  staging_reportes_historial
 *               capas_sig              →  staging_capas_sig
 *               estadisticas           →  staging_estadisticas
 *
 *   Storage:    documentos_iser/**     →  staging/documentos_iser/**
 *               auditorias/**          →  staging/auditorias/**
 *               modelos_bim/**         →  staging/modelos_bim/**
 *               capas_sig/**           →  staging/capas_sig/**
 *
 * PRINCIPIOS DE SEGURIDAD:
 *   - Producción es SIEMPRE la fuente (solo lectura).
 *   - Staging es SIEMPRE el destino (escritura).
 *   - El script ABORTA si detecta que intentaría escribir en producción.
 *   - Modo DRY-RUN por defecto: muestra qué haría sin tocar nada.
 *
 * USO:
 *   # Dry-run (no escribe nada, recomendado primero):
 *   node scripts/clone-to-staging.js
 *
 *   # Ejecutar clonación real:
 *   node scripts/clone-to-staging.js --apply
 *
 *   # Solo Firestore o solo Storage:
 *   node scripts/clone-to-staging.js --apply --only=firestore
 *   node scripts/clone-to-staging.js --apply --only=storage
 *
 *   # Limitar colecciones / rutas:
 *   node scripts/clone-to-staging.js --apply --collections=archivos_iser,bloques_estado
 *   node scripts/clone-to-staging.js --apply --paths=documentos_iser
 *
 * REQUISITOS:
 *   - Tener instaladas credenciales de Firebase Admin (una de):
 *       a) Variable GOOGLE_APPLICATION_CREDENTIALS apuntando a un service-account.json
 *       b) `firebase login` + `firebase use geovisor-iser` y el script toma las creds por defecto
 *   - firebase-admin instalado (viene con functions/node_modules; el script lo reutiliza).
 */
'use strict';

const path = require('path');
const fs = require('fs');

// Reutiliza firebase-admin de functions/ para no duplicar dependencias
const adminPath = path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin');
if (!fs.existsSync(adminPath)) {
  console.error('❌ No se encontró firebase-admin en functions/node_modules.');
  console.error('   Ejecuta: cd functions && npm install');
  process.exit(1);
}
const admin = require(adminPath);

// ─── Configuración ─────────────────────────────────────────────────
const PROJECT_ID = 'geovisor-iser';
const STORAGE_BUCKET = 'geovisor-iser.firebasestorage.app';

const FIRESTORE_COLLECTIONS = [
  'archivos_iser',
  'usuarios_iser',
  'bloques_estado',
  'auditorias_bloques',
  'inventario_bloques',
  'reportes_historial',
  'capas_sig',
  'estadisticas',
];

const STORAGE_ROOT_PATHS = [
  'documentos_iser',
  'auditorias',
  'modelos_bim',
  'capas_sig',
];

// ─── CLI args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const onlyArg = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const collectionsArg = (args.find((a) => a.startsWith('--collections=')) || '').split('=')[1];
const pathsArg = (args.find((a) => a.startsWith('--paths=')) || '').split('=')[1];

const doFirestore = !onlyArg || onlyArg === 'firestore';
const doStorage = !onlyArg || onlyArg === 'storage';
const selectedCollections = collectionsArg
  ? collectionsArg.split(',').map((s) => s.trim()).filter(Boolean)
  : FIRESTORE_COLLECTIONS;
const selectedPaths = pathsArg
  ? pathsArg.split(',').map((s) => s.trim()).filter(Boolean)
  : STORAGE_ROOT_PATHS;

// ─── Guards ────────────────────────────────────────────────────────
function assertStagingTarget(name, prefix) {
  if (!name.startsWith(prefix)) {
    throw new Error(
      `GUARD: intento de escribir en "${name}" que NO empieza con "${prefix}". Abortando por seguridad.`
    );
  }
}

// ─── Init ──────────────────────────────────────────────────────────
try {
  admin.initializeApp({
    projectId: PROJECT_ID,
    storageBucket: STORAGE_BUCKET,
  });
} catch (e) {
  console.error('❌ No se pudo inicializar firebase-admin:', e.message);
  console.error('   Asegúrate de tener credenciales: export GOOGLE_APPLICATION_CREDENTIALS=...');
  process.exit(1);
}

const fs_db = admin.firestore();
const bucket = admin.storage().bucket(STORAGE_BUCKET);

// ─── Clonación Firestore ───────────────────────────────────────────
async function cloneFirestoreCollection(sourceName) {
  const targetName = `staging_${sourceName}`;
  assertStagingTarget(targetName, 'staging_');

  console.log(`\n📚 Firestore · ${sourceName} → ${targetName}`);
  const snap = await fs_db.collection(sourceName).get();
  const total = snap.size;
  console.log(`   docs en fuente: ${total}`);

  if (total === 0) return { collection: sourceName, copied: 0, skipped: 0 };

  if (!APPLY) {
    console.log(`   [DRY-RUN] copiaría ${total} documentos`);
    return { collection: sourceName, copied: 0, skipped: total };
  }

  // Batch writes en chunks de 400
  const target = fs_db.collection(targetName);
  let copied = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = fs_db.batch();
    for (const d of chunk) {
      const data = d.data();
      data.__clonedFrom = sourceName;
      data.__clonedAt = admin.firestore.FieldValue.serverTimestamp();
      batch.set(target.doc(d.id), data, { merge: false });
    }
    await batch.commit();
    copied += chunk.length;
    process.stdout.write(`   · copiados: ${copied}/${total}\r`);
  }
  console.log(`   ✓ copiados: ${copied}/${total}                `);
  return { collection: sourceName, copied, skipped: 0 };
}

// ─── Clonación Storage ─────────────────────────────────────────────
async function cloneStoragePrefix(rootPath) {
  const sourcePrefix = `${rootPath}/`;
  const targetPrefix = `staging/${rootPath}/`;
  assertStagingTarget(targetPrefix, 'staging/');

  console.log(`\n📦 Storage · ${sourcePrefix}** → ${targetPrefix}**`);
  const [files] = await bucket.getFiles({ prefix: sourcePrefix });
  const real = files.filter((f) => !f.name.endsWith('/'));
  console.log(`   archivos en fuente: ${real.length}`);

  if (real.length === 0) return { path: rootPath, copied: 0, skipped: 0 };

  if (!APPLY) {
    console.log(`   [DRY-RUN] copiaría ${real.length} archivos`);
    real.slice(0, 5).forEach((f) => console.log(`     · ${f.name} → staging/${f.name}`));
    if (real.length > 5) console.log(`     ... y ${real.length - 5} más`);
    return { path: rootPath, copied: 0, skipped: real.length };
  }

  let copied = 0;
  for (const f of real) {
    const dest = `staging/${f.name}`;
    assertStagingTarget(dest, 'staging/');
    await f.copy(bucket.file(dest));
    copied++;
    if (copied % 25 === 0) process.stdout.write(`   · copiados: ${copied}/${real.length}\r`);
  }
  console.log(`   ✓ copiados: ${copied}/${real.length}                `);
  return { path: rootPath, copied, skipped: 0 };
}

// ─── Main ──────────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CLONE PRODUCCIÓN → STAGING');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Proyecto     : ${PROJECT_ID}`);
  console.log(`  Modo         : ${APPLY ? 'APPLY (escritura real)' : 'DRY-RUN (solo lectura)'}`);
  console.log(`  Firestore    : ${doFirestore ? 'sí' : 'no'}`);
  console.log(`  Storage      : ${doStorage ? 'sí' : 'no'}`);
  console.log(`  Colecciones  : ${selectedCollections.join(', ')}`);
  console.log(`  Paths        : ${selectedPaths.join(', ')}`);
  console.log('───────────────────────────────────────────────────────────────');

  const results = { firestore: [], storage: [] };

  try {
    if (doFirestore) {
      for (const c of selectedCollections) {
        results.firestore.push(await cloneFirestoreCollection(c));
      }
    }
    if (doStorage) {
      for (const p of selectedPaths) {
        results.storage.push(await cloneStoragePrefix(p));
      }
    }
  } catch (e) {
    console.error('\n❌ ERROR:', e.message);
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  RESUMEN');
  console.log('═══════════════════════════════════════════════════════════════');
  if (results.firestore.length) {
    console.log('  Firestore:');
    results.firestore.forEach((r) =>
      console.log(`    · ${r.collection.padEnd(24)} copied=${r.copied}  (pendientes=${r.skipped})`)
    );
  }
  if (results.storage.length) {
    console.log('  Storage:');
    results.storage.forEach((r) =>
      console.log(`    · ${r.path.padEnd(24)} copied=${r.copied}  (pendientes=${r.skipped})`)
    );
  }
  if (!APPLY) {
    console.log('\n  ⚠ Esto fue un DRY-RUN. Para aplicar cambios: añade --apply');
  } else {
    console.log('\n  ✓ Clonación completada. Producción permanece intacta.');
  }
  process.exit(0);
})();
