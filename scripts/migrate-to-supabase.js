/**
 * Script de Migración: Firebase a Supabase
 *
 * USO:
 *   node scripts/migrate-to-supabase.js             <- Modo DRY-RUN (por defecto, no escribe)
 *   node scripts/migrate-to-supabase.js --apply     <- Escribe en Supabase
 *
 * Requiere variables de entorno o credenciales de Firebase configuradas
 * y las credenciales de Supabase.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('../backend-cloudrun/node_modules/@supabase/supabase-js');

// 1. Cargar dependencias de firebase-admin del directorio functions para evitar reinstalar
const admin = require('../functions/node_modules/firebase-admin');

// Configuración de Supabase provista por el usuario
const SUPABASE_URL = 'https://scglhxbysycuqqzgzxhe.supabase.co';
const SUPABASE_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZ2xoeGJ5c3ljdXFxemdxenhlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgyMzc2NiwiZXhwIjoyMDk2Mzk5NzY2fQ.JFTNBI1dGSX62SehW7xJ6rKorxVq6OKRWJQwF0pwWGo';

const isDryRun = !process.argv.includes('--apply');

if (!admin.apps.length) {
  // Reutiliza credenciales locales ADC de Firebase CLI o service-account.json
  try {
    admin.initializeApp();
    console.log('✅ Firebase Admin inicializado correctamente.');
  } catch (e) {
    console.error('❌ Error inicializando Firebase Admin. Asegúrate de haber hecho "firebase login" o tener configurada la variable GOOGLE_APPLICATION_CREDENTIALS.', e.message);
    process.exit(1);
  }
}

const db = admin.firestore();
const storage = admin.storage();
const auth = admin.auth();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false }
});

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`🚀 INICIANDO MIGRACIÓN A SUPABASE - MODO: ${isDryRun ? 'DRY-RUN (Simulación)' : 'APLICAR (Escribir)'}`);
  console.log('═══════════════════════════════════════════════════════════════');

  try {
    // 1. Migración de Usuarios e Identidades
    const userMap = await migrarUsuarios();

    // 2. Migración de Estructura Base y Dinámica
    await migrarEstructura();

    // 3. Migración de Bloques y Auditorías
    await migrarBloquesYAuditorias();

    // 4. Migración de Archivos (Metadatos Firestore y Storage físico)
    await migrarArchivosYStorage();

    console.log('\n🎉 MIGRACIÓN COMPLETADA EXITOSAMENTE.');
  } catch (err) {
    console.error('\n❌ ERROR CRÍTICO DURANTE LA MIGRACIÓN:', err);
  }
}

/**
 * Valida si un string es un UUID válido.
 */
function isUUID(str) {
  const s = "" + str;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Migra los usuarios de Firebase Auth y sus perfiles de usuarios_iser.
 */
async function migrarUsuarios() {
  console.log('\n--- 1. Migrando Usuarios ---');
  const userMap = new Map(); // Maps Firebase UID -> Supabase UUID

  // Obtener usuarios de Firestore usuarios_iser
  const userSnap = await db.collection('usuarios_iser').get();
  console.log(`Encontrados ${userSnap.size} perfiles de usuarios en Firestore.`);

  for (const doc of userSnap.docs) {
    const data = doc.data();
    const fbUid = doc.id;
    const email = data.email || `${fbUid}@iser-pamplona.edu.co`; // Fallback email
    const role = data.role || 'viewer';

    console.log(`-> Procesando usuario: ${email} (${role})`);

    let sbUuid = fbUid;
    if (!isUUID(fbUid)) {
      // Supabase requiere UUID. Generamos uno determinista basado en el email para consistencia
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(email).digest('hex');
      sbUuid = `${hash.substring(0,8)}-${hash.substring(8,12)}-${hash.substring(12,16)}-${hash.substring(16,20)}-${hash.substring(20,32)}`;
      console.log(`   (UID legado "${fbUid}" convertido a UUID "${sbUuid}")`);
    }

    userMap.set(fbUid, sbUuid);

    if (isDryRun) {
      console.log(`   [DRY-RUN] Se crearía usuario en auth.users con UUID: ${sbUuid} y perfil en usuarios_iser con rol: ${role}`);
      continue;
    }

    // Comprobar si el usuario ya existe en Supabase Auth
    const { data: existingUser, error: getErr } = await supabase.auth.admin.getUserById(sbUuid);

    if (existingUser && existingUser.user) {
      console.log(`   Usuario ya existe en Supabase Auth. Actualizando perfil...`);
    } else {
      // Crear en Supabase Auth
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        id: sbUuid,
        email: email,
        password: 'TempPassword123!', // Contraseña temporal, requiere cambio
        email_confirm: true
      });

      if (createErr) {
        console.error(`   ❌ Error al crear usuario Auth para ${email}:`, createErr.message);
        continue;
      }
      console.log(`   Creado usuario Auth en Supabase.`);
    }

    // Crear/actualizar en tabla usuarios_iser
    const { error: profileErr } = await supabase
      .from('usuarios_iser')
      .upsert({
        uid: sbUuid,
        email: email,
        role: role
      });

    if (profileErr) {
      console.error(`   ❌ Error guardando perfil en usuarios_iser:`, profileErr.message);
    } else {
      console.log(`   Perfil de base de datos sincronizado.`);
    }
  }

  return userMap;
}

/**
 * Migra estructura base y estructura dinámica
 */
async function migrarEstructura() {
  console.log('\n--- 2. Migrando Estructuras Canónicas y Dinámicas ---');

  // Estructura Base
  const baseSnap = await db.collection('estructura_base').get();
  console.log(`Encontrados ${baseSnap.size} registros de estructura base.`);
  for (const doc of baseSnap.docs) {
    const data = doc.data();
    if (isDryRun) {
      console.log(`   [DRY-RUN] Se migraría estructura base de sede: ${doc.id}`);
      continue;
    }
    const { error } = await supabase
      .from('estructura_base')
      .upsert({
        sede_id: doc.id,
        arbol: data
      });
    if (error) console.error(`   ❌ Error migrando estructura_base (${doc.id}):`, error.message);
    else console.log(`   Migrada estructura base de sede: ${doc.id}`);
  }

  // Estructura Dinámica
  const dinamicaSnap = await db.collection('estructura_dinamica').get();
  console.log(`Encontrados ${dinamicaSnap.size} registros de estructura dinámica.`);
  for (const doc of dinamicaSnap.docs) {
    const data = doc.data();
    if (isDryRun) {
      console.log(`   [DRY-RUN] Se migraría estructura dinámica: ${doc.id}`);
      continue;
    }
    const { error } = await supabase
      .from('estructura_dinamica')
      .upsert({
        id: doc.id,
        sede_id: data.sedeId || 'pamplona',
        bloque_id: data.bloqueId || '',
        disciplina_id: data.disciplinaId || '',
        nombre_carpeta: data.nombreCarpeta || ''
      });
    if (error) console.error(`   ❌ Error migrando estructura_dinamica (${doc.id}):`, error.message);
    else console.log(`   Migrada estructura dinámica: ${doc.id} (${data.nombreCarpeta})`);
  }
}

/**
 * Migra los bloques_estado y auditorias_bloques
 */
async function migrarBloquesYAuditorias() {
  console.log('\n--- 3. Migrando Estados de Bloques y Auditorías ---');

  // Estados
  const estadosSnap = await db.collection('bloques_estado').get();
  console.log(`Encontrados ${estadosSnap.size} registros de bloques_estado.`);
  for (const doc of estadosSnap.docs) {
    const data = doc.data();
    if (isDryRun) {
      console.log(`   [DRY-RUN] Se migraría estado de bloque: ${doc.id}`);
      continue;
    }
    const { error } = await supabase
      .from('bloques_estado')
      .upsert({
        block_id: doc.id,
        diagnostico_texto: data.diagnostico_texto || null,
        score_infraestructura: data.score_infraestructura || 0,
        color_sugerido: data.color_sugerido || '#EF4444',
        radar_scores: data.radar_scores || null,
        tareas_pendientes: data.tareas_pendientes || [],
        normas: data.normas || null
      });
    if (error) console.error(`   ❌ Error migrando bloques_estado (${doc.id}):`, error.message);
    else console.log(`   Migrado estado de bloque: ${doc.id}`);
  }

  // Auditorías
  const auditoriasSnap = await db.collection('auditorias_bloques').get();
  console.log(`Encontrados ${auditoriasSnap.size} registros de auditorias_bloques.`);
  for (const doc of auditoriasSnap.docs) {
    const data = doc.data();
    if (isDryRun) {
      console.log(`   [DRY-RUN] Se migraría auditoría de bloque: ${doc.id}`);
      continue;
    }
    const { error } = await supabase
      .from('auditorias_bloques')
      .upsert({
        block_id: doc.id,
        resumen_ejecutivo: data.resumen_ejecutivo || null,
        normas: data.normas || null,
        puntaje_global: data.puntaje_global || 0,
        tareas_pendientes: data.tareas_pendientes || [],
        archivo_hash: data.archivoHash || null,
        total_archivos_al_auditar: data.totalArchivosAlAuditar || 0,
        fecha_auditoria: data.fechaAuditoria ? new Date(data.fechaAuditoria) : null
      });
    if (error) console.error(`   ❌ Error migrando auditorias_bloques (${doc.id}):`, error.message);
    else console.log(`   Migrada auditoría de bloque: ${doc.id}`);
  }
}

/**
 * Migra los registros de archivos_iser de Firestore y transfiere
 * físicamente los archivos de Firebase Storage a Supabase Storage.
 */
async function migrarArchivosYStorage() {
  console.log('\n--- 4. Migrando Archivos y Storage ---');

  const archivosSnap = await db.collection('archivos_iser').get();
  console.log(`Encontrados ${archivosSnap.size} registros de archivos en Firestore.`);

  const bucket = storage.bucket();

  for (const doc of archivosSnap.docs) {
    const data = doc.data();
    const docId = doc.id;
    const storagePath = data.storagePath;
    const urlLegada = data.url;

    console.log(`-> Procesando archivo: ${data.nombre} (${storagePath})`);

    // 1. Decidir en qué bucket de Supabase colocarlo
    let bucketName = 'documentos_iser';
    if (storagePath.includes('modelos_bim/')) bucketName = 'modelos_bim';
    else if (storagePath.includes('capas_sig/')) bucketName = 'capas_sig';
    else if (storagePath.includes('auditorias/')) bucketName = 'auditorias';

    const cleanStoragePath = storagePath.replace(/^(documentos_iser\/|modelos_bim\/|capas_sig\/|auditorias\/)/, '');

    if (isDryRun) {
      console.log(`   [DRY-RUN] Se transferiría el archivo de Firebase Storage [${storagePath}] a Supabase Bucket [${bucketName}] ruta [${cleanStoragePath}]`);
      console.log(`   [DRY-RUN] Se guardaría el metadato en archivos_iser id: ${docId}`);
      continue;
    }

    try {
      // 2. Transferencia física
      console.log(`   Descargando de Firebase Storage...`);
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();

      if (!exists) {
        console.warn(`   ⚠️ Archivo no encontrado en Firebase Storage físico. Se omite subida.`);
        continue;
      }

      const [buffer] = await file.download();

      console.log(`   Subiendo a Supabase Storage [${bucketName}]...`);
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from(bucketName)
        .upload(cleanStoragePath, buffer, {
          contentType: data.tipoMime || 'application/octet-stream',
          upsert: true
        });

      if (uploadErr) {
        console.error(`   ❌ Error subiendo a Supabase Storage:`, uploadErr.message);
        continue;
      }

      // Obtener URL pública de Supabase
      const { data: { publicUrl } } = supabase.storage
        .from(bucketName)
        .getPublicUrl(cleanStoragePath);

      console.log(`   Subido con éxito. URL: ${publicUrl}`);

      // 3. Escribir metadato en Postgres
      const { error: dbErr } = await supabase
        .from('archivos_iser')
        .upsert({
          id: docId,
          bloque: data.bloque,
          sede: data.sede || 'pamplona',
          nombre: data.nombre,
          tipo: data.tipo,
          carpeta: data.carpeta,
          url: publicUrl, // Actualizada con la URL de Supabase
          storage_path: storagePath,
          fecha_creacion: data.fechaCreacion ? (data.fechaCreacion.toDate ? data.fechaCreacion.toDate() : new Date(data.fechaCreacion)) : new Date(),
          subido_por: data.subidoPor || 'desconocido',
          tamanio: data.tamaño || data.tamanio || buffer.length,
          tipo_mime: data.tipoMime || null,
          ia: data.ia || null
        });

      if (dbErr) {
        console.error(`   ❌ Error insertando metadato en la BD:`, dbErr.message);
      } else {
        console.log(`   Metadato del archivo registrado.`);
      }

    } catch (err) {
      console.error(`   ❌ Error procesando transferencia de archivo:`, err.message || err);
    }
  }
}

main();
