/**
 * Aplica el esquema SQL de Supabase usando la API de administración.
 * 
 * EJECUTAR DESDE TU MÁQUINA (requiere acceso a Internet):
 *   node scripts/apply-supabase-schema.js
 * 
 * Requiere: npm install @supabase/supabase-js  (ya instalado en backend-cloudrun)
 */

const path = require('path');
const fs = require('fs');

// Cargar @supabase/supabase-js desde node_modules del backend
const { createClient } = require('./backend-cloudrun/node_modules/@supabase/supabase-js');

const SUPABASE_URL = 'https://scglhxbysycuqqzgzxhe.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZ2xoeGJ5c3ljdXFxemdxenhlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgyMzc2NiwiZXhwIjoyMDk2Mzk5NzY2fQ.JFTNBI1dGSX62SehW7xJ6rKorxVq6OKRWJQwF0pwWGo';

const sql = fs.readFileSync(path.join(__dirname, 'scripts', 'supabase-schema.sql'), 'utf8');

async function main() {
  console.log('Aplicando schema SQL en Supabase...');
  console.log('URL:', SUPABASE_URL);

  // El endpoint correcto para ejecutar SQL libre en Supabase es:
  // POST /rest/v1/rpc/ — no disponible directamente para DDL.
  // Usamos la Management API de Supabase (requiere access_token del dashboard, no service_role).
  // 
  // ALTERNATIVA RECOMENDADA: Pegar el contenido de scripts/supabase-schema.sql
  // en el SQL Editor del Supabase Dashboard y ejecutarlo directamente.
  //
  // Procedimiento:
  // 1. Ve a https://supabase.com/dashboard/project/scglhxbysycuqqzgzxhe/editor
  // 2. Abre el archivo scripts/supabase-schema.sql
  // 3. Copia todo el contenido y pégalo en el SQL Editor
  // 4. Haz clic en "Run" o pulsa Ctrl+Enter

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ACCIÓN REQUERIDA: Ejecutar el schema en Supabase Dashboard');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  1. Abre: https://supabase.com/dashboard/project/scglhxbysycuqqzgzxhe/editor');
  console.log('  2. Copia el contenido de: scripts/supabase-schema.sql');
  console.log('  3. Pégalo en el editor SQL y ejecuta (Ctrl+Enter)');
  console.log('');

  // Verificar conexión
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });

  try {
    // Probar conexión simple con una tabla que sabemos que existe en Supabase
    const { data, error } = await sb.from('usuarios_iser').select('count').limit(1);
    if (error && error.code === '42P01') {
      console.log('✅ Conexión a Supabase OK — tablas aún no creadas (run schema SQL first)');
    } else if (error) {
      console.log('ℹ️  Supabase error:', error.message);
    } else {
      console.log('✅ Conexión a Supabase OK — tabla usuarios_iser ya existe!');
      console.log('   Datos:', data);
    }
  } catch (e) {
    console.error('❌ Error de conexión:', e.message);
  }

  // Crear también los buckets de Storage
  console.log('\nCreando buckets de Supabase Storage...');
  const buckets = ['documentos_iser', 'modelos_bim', 'capas_sig', 'auditorias'];
  
  for (const bucket of buckets) {
    const { data, error } = await sb.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: 52428800, // 50MB
    });
    if (error) {
      if (error.message.includes('already exists')) {
        console.log(`  ✅ Bucket "${bucket}" ya existe`);
      } else {
        console.log(`  ❌ Error creando bucket "${bucket}":`, error.message);
      }
    } else {
      console.log(`  ✅ Bucket "${bucket}" creado`);
    }
  }

  console.log('\n¡Listo! Próximo paso: ejecutar el schema SQL en el Dashboard de Supabase.');
}

main().catch(console.error);
