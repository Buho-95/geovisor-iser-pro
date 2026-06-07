-- Geovisor ISER — Supabase PostgreSQL Schema
-- Este script define la estructura relacional para migrar desde Firestore.
-- Soporta RLS (Row Level Security) y triggers automáticos de creación de perfiles.

-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════
-- TABLAS PRINCIPALES
-- ═══════════════════════════════════════════════════════════════

-- 1. Usuarios ISER (Perfiles vinculados a auth.users de Supabase)
CREATE TABLE IF NOT EXISTS public.usuarios_iser (
    uid uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text UNIQUE NOT NULL,
    role text NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')) DEFAULT 'viewer',
    created_at timestamptz DEFAULT now()
);

-- 2. Archivos ISER (Metadatos de planos y documentos)
CREATE TABLE IF NOT EXISTS public.archivos_iser (
    id text PRIMARY KEY, -- Usamos text para mantener consistencia con IDs generados por Firestore o nombres de archivo
    bloque text NOT NULL,
    sede text NOT NULL DEFAULT 'pamplona',
    nombre text NOT NULL,
    tipo text NOT NULL,
    carpeta text NOT NULL,
    url text NOT NULL,
    storage_path text NOT NULL,
    fecha_creacion timestamptz DEFAULT now(),
    subido_por text NOT NULL,
    tamanio bigint NOT NULL,
    tipo_mime text,
    ia jsonb, -- Metadata enriquecida de auditoría IA
    created_at timestamptz DEFAULT now()
);

-- 3. Bloques Estado (Configuración y colores en el mapa)
CREATE TABLE IF NOT EXISTS public.bloques_estado (
    block_id text PRIMARY KEY,
    diagnostico_texto text,
    score_infraestructura numeric DEFAULT 0,
    color_sugerido text DEFAULT '#EF4444',
    radar_scores jsonb,
    tareas_pendientes jsonb DEFAULT '[]'::jsonb,
    normas jsonb,
    updated_at timestamptz DEFAULT now()
);

-- 4. Auditorías Bloques (Caché de resultados de auditorías de planoteca por IA)
CREATE TABLE IF NOT EXISTS public.auditorias_bloques (
    block_id text PRIMARY KEY,
    resumen_ejecutivo text,
    normas jsonb,
    puntaje_global numeric DEFAULT 0,
    tareas_pendientes jsonb DEFAULT '[]'::jsonb,
    archivo_hash text,
    total_archivos_al_auditar integer DEFAULT 0,
    fecha_auditoria timestamptz DEFAULT now()
);

-- 5. Inventario Bloques (Inventario indexado por el backend server-side)
CREATE TABLE IF NOT EXISTS public.inventario_bloques (
    block_id text PRIMARY KEY,
    block_name text,
    sede text NOT NULL DEFAULT 'pamplona',
    base_path text,
    archivos jsonb DEFAULT '[]'::jsonb,
    subcarpetas jsonb DEFAULT '[]'::jsonb,
    total_archivos integer DEFAULT 0,
    scan_timestamp timestamptz DEFAULT now(),
    archivo_hash text,
    env text NOT NULL DEFAULT 'production',
    indexed_at timestamptz DEFAULT now(),
    indexed_by_uid text
);

-- 6. Historial de Reportes (Metadatos de PDFs oficiales exportados)
CREATE TABLE IF NOT EXISTS public.reportes_historial (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id text NOT NULL,
    block_name text NOT NULL,
    download_url text NOT NULL,
    storage_path text NOT NULL,
    user_email text NOT NULL,
    fecha timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now()
);

-- 7. Capas SIG (Archivos espaciales del visor)
CREATE TABLE IF NOT EXISTS public.capas_sig (
    id text PRIMARY KEY,
    nombre text NOT NULL,
    tipo text NOT NULL,
    url text NOT NULL,
    geojson jsonb,
    activo boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

-- 8. Estadísticas (Históricos de cumplimiento e indicadores)
CREATE TABLE IF NOT EXISTS public.estadisticas (
    id text PRIMARY KEY,
    datos jsonb,
    created_at timestamptz DEFAULT now()
);

-- 9. Estructura Base (Configuración canónica del árbol de carpetas)
CREATE TABLE IF NOT EXISTS public.estructura_base (
    sede_id text PRIMARY KEY,
    arbol jsonb NOT NULL, -- El árbol jerárquico completo (sede + bloques)
    created_at timestamptz DEFAULT now()
);

-- 10. Estructura Dinámica (Zonas rojas creadas por usuarios)
CREATE TABLE IF NOT EXISTS public.estructura_dinamica (
    id text PRIMARY KEY,
    sede_id text NOT NULL,
    bloque_id text NOT NULL,
    disciplina_id text NOT NULL,
    nombre_carpeta text NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- INDEXACIÓN Y OPTIMIZACIONES
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_archivos_bloque ON public.archivos_iser(bloque);
CREATE INDEX IF NOT EXISTS idx_archivos_sede ON public.archivos_iser(sede);
CREATE INDEX IF NOT EXISTS idx_reportes_block ON public.reportes_historial(block_id);

-- ═══════════════════════════════════════════════════════════════
-- FUNCIONES DE AYUDA Y AUTOMATIZACIONES
-- ═══════════════════════════════════════════════════════════════

-- Función auxiliar para verificar si el usuario es administrador
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.usuarios_iser
    WHERE uid = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger automático para crear perfil cuando un usuario se registra en auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.usuarios_iser (uid, email, role)
  VALUES (new.id, new.email, 'viewer');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════
-- SEGURIDAD: ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════

-- Habilitar RLS en todas las tablas
ALTER TABLE public.usuarios_iser ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archivos_iser ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bloques_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditorias_bloques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_bloques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capas_sig ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estadisticas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estructura_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estructura_dinamica ENABLE ROW LEVEL SECURITY;

-- 1. Políticas de Usuarios ISER
CREATE POLICY usuarios_lectura ON public.usuarios_iser
    FOR SELECT TO authenticated USING (auth.uid() = uid OR public.is_admin());

CREATE POLICY usuarios_escritura ON public.usuarios_iser
    FOR ALL TO authenticated USING (public.is_admin());

-- 2. Políticas de Archivos ISER
CREATE POLICY archivos_lectura ON public.archivos_iser
    FOR SELECT TO authenticated USING (true);

CREATE POLICY archivos_escritura ON public.archivos_iser
    FOR ALL TO authenticated USING (public.is_admin());

-- 3. Políticas de Bloques Estado
CREATE POLICY bloques_lectura ON public.bloques_estado
    FOR SELECT TO authenticated USING (true);

CREATE POLICY bloques_escritura ON public.bloques_estado
    FOR ALL TO authenticated USING (public.is_admin());

-- 4. Políticas de Auditorías Bloques
CREATE POLICY auditorias_lectura ON public.auditorias_bloques
    FOR SELECT TO authenticated USING (public.is_admin());

CREATE POLICY auditorias_escritura ON public.auditorias_bloques
    FOR ALL TO authenticated USING (public.is_admin());

-- 5. Políticas de Inventario Bloques
CREATE POLICY inventario_lectura ON public.inventario_bloques
    FOR SELECT TO authenticated USING (true);

-- Solo el rol de servicio o funciones internas pueden escribir el inventario (bypasses RLS por defecto para service_role)
CREATE POLICY inventario_escritura ON public.inventario_bloques
    FOR ALL TO authenticated USING (false);

-- 6. Políticas de Reportes Historial
CREATE POLICY reportes_lectura ON public.reportes_historial
    FOR SELECT TO authenticated USING (public.is_admin());

CREATE POLICY reportes_escritura ON public.reportes_historial
    FOR ALL TO authenticated USING (public.is_admin());

-- 7. Políticas de Capas SIG
CREATE POLICY capas_lectura ON public.capas_sig
    FOR SELECT TO authenticated USING (true);

CREATE POLICY capas_escritura ON public.capas_sig
    FOR ALL TO authenticated USING (public.is_admin());

-- 8. Políticas de Estadísticas
CREATE POLICY estadisticas_lectura ON public.estadisticas
    FOR SELECT TO authenticated USING (true);

CREATE POLICY estadisticas_escritura ON public.estadisticas
    FOR ALL TO authenticated USING (public.is_admin());

-- 9. Políticas de Estructura Base
CREATE POLICY estructura_base_lectura ON public.estructura_base
    FOR SELECT TO authenticated USING (true);

CREATE POLICY estructura_base_escritura ON public.estructura_base
    FOR ALL TO authenticated USING (public.is_admin());

-- 10. Políticas de Estructura Dinámica
CREATE POLICY estructura_dinamica_lectura ON public.estructura_dinamica
    FOR SELECT TO authenticated USING (true);

CREATE POLICY estructura_dinamica_escritura ON public.estructura_dinamica
    FOR ALL TO authenticated USING (public.is_admin());

-- 11. CONFIGURACIÓN DE STORAGE (BATERÍA DE BUCKETS Y POLÍTICAS)
-- ═══════════════════════════════════════════════════════════════

-- Crear los buckets si no existen con acceso público para descarga directa vía URL
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES 
  ('documentos_iser', 'documentos_iser', true, 52428800),
  ('modelos_bim', 'modelos_bim', true, 52428800),
  ('capas_sig', 'capas_sig', true, 52428800),
  ('auditorias', 'auditorias', true, 52428800)
ON CONFLICT (id) DO NOTHING;

-- Limpiar políticas previas para evitar conflictos de duplicación
DROP POLICY IF EXISTS "Permitir lectura publica" ON storage.objects;
DROP POLICY IF EXISTS "Permitir escritura a administradores" ON storage.objects;
DROP POLICY IF EXISTS "Permitir actualizacion a administradores" ON storage.objects;
DROP POLICY IF EXISTS "Permitir eliminacion a administradores" ON storage.objects;

-- Crear políticas:
-- 1. Permitir lectura pública (descargas e incrustación de PDFs/imágenes en el navegador)
CREATE POLICY "Permitir lectura publica"
ON storage.objects FOR SELECT
TO public
USING (true);

-- 2. Solo administradores pueden subir archivos (INSERT)
CREATE POLICY "Permitir escritura a administradores"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  public.is_admin()
);

-- 3. Solo administradores pueden actualizar archivos/metadatos (UPDATE)
CREATE POLICY "Permitir actualizacion a administradores"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  public.is_admin()
);

-- 4. Solo administradores pueden eliminar archivos (DELETE)
CREATE POLICY "Permitir eliminacion a administradores"
ON storage.objects FOR DELETE
TO authenticated
USING (
  public.is_admin()
);

