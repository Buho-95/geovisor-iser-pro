# deploy-backend.ps1
# Script de automatización de despliegue para el Backend de Geovisor ISER en Google Cloud Run.
#
# EJECUTAR DESDE UNA TERMINAL LOCAL EN TU MÁQUINA (con acceso a Internet y gcloud instalado):
#   .\deploy-backend.ps1

$ErrorActionPreference = "Continue"

Write-Host "=========================================================" -ForegroundColor Green
Write-Host "  DESPLIEGUE DEL BACKEND GEOVISOR ISER EN CLOUD RUN     " -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Green
Write-Host ""

# Verificar si gcloud está instalado
$gcloudCheck = Get-Command gcloud -ErrorAction SilentlyContinue
if (-not $gcloudCheck) {
    Write-Host "❌ ERROR: No se encontró el comando 'gcloud' en el sistema." -ForegroundColor Red
    Write-Host "Por favor instala Google Cloud SDK antes de continuar: https://cloud.google.com/sdk" -ForegroundColor Yellow
    Exit
}

# 1. Configurar Proyecto GCP
$projectId = "geovisor-iser"
Write-Host "Configurando proyecto activo en gcloud a: $projectId..." -ForegroundColor Cyan
gcloud config set project $projectId

# Verificar autenticación
Write-Host "Verificando cuenta activa de Google Cloud..." -ForegroundColor Cyan
$authAccount = & gcloud config get-value account 2>$null
if ([string]::IsNullOrEmpty($authAccount)) {
    Write-Host "⚠️ No hay una cuenta activa de gcloud. Iniciando inicio de sesión..." -ForegroundColor Yellow
    gcloud auth login
} else {
    Write-Host "✅ Cuenta activa: $authAccount" -ForegroundColor Green
}

# 2. Habilitar Servicios Necesarios
Write-Host "Habilitando servicios de Cloud Run y Secret Manager en el proyecto..." -ForegroundColor Cyan
gcloud services enable run.googleapis.com secretmanager.googleapis.com

# 3. Configurar Gemini API Key en Secret Manager
Write-Host ""
$geminiApiKey = "AIzaSyBtW6xf9FLNN7j8wwy9jpg0PUuOaz6Vz-8"

if (-not [string]::IsNullOrEmpty($geminiApiKey)) {
    Write-Host "Creando/Actualizando secreto 'gemini-api-key' en Secret Manager..." -ForegroundColor Cyan
    
    # Comprobar si el secreto ya existe usando 'list' para no provocar errores de consola
    $secretExists = & gcloud secrets list --filter="name:projects/$projectId/secrets/gemini-api-key" --format="value(name)"
    if (-not [string]::IsNullOrEmpty($secretExists)) {
        # Agregar una nueva versión
        $geminiApiKey | gcloud secrets versions add gemini-api-key --data-file=-
        Write-Host "✅ Nueva versión del secreto 'gemini-api-key' añadida." -ForegroundColor Green
    } else {
        # Crear el secreto e insertar la primera versión
        gcloud secrets create gemini-api-key --replication-policy="automatic"
        $geminiApiKey | gcloud secrets versions add gemini-api-key --data-file=-
        Write-Host "✅ Secreto 'gemini-api-key' creado y configurado." -ForegroundColor Green
    }
}

# 4. Autorizar a Cloud Run para acceder a Secret Manager
Write-Host ""
Write-Host "Configurando permisos de IAM para Secret Manager..." -ForegroundColor Cyan
$projectNumber = & gcloud projects describe $projectId --format="value(projectNumber)"
$serviceAccount = "${projectNumber}-compute@developer.gserviceaccount.com"
Write-Host "Otorgando el rol Secret Manager Secret Accessor a: $serviceAccount..." -ForegroundColor Yellow
& gcloud projects add-iam-policy-binding $projectId `
    --member="serviceAccount:$serviceAccount" `
    --role="roles/secretmanager.secretAccessor" `
    --condition=None 2>$null

# 5. Desplegar en Cloud Run
Write-Host ""
Write-Host "Iniciando el despliegue del contenedor en Cloud Run..." -ForegroundColor Cyan
Write-Host "Esto compilará el código local de backend-cloudrun en la nube y lo desplegará." -ForegroundColor Yellow

$supabaseUrl = "https://scglhxbysycuqqzgzxhe.supabase.co"
$supabaseServiceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjZ2xoeGJ5c3ljdXFxemdxenhlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgyMzc2NiwiZXhwIjoyMDk2Mzk5NzY2fQ.JFTNBI1dGSX62SehW7xJ6rKorxVq6OKRWJQwF0pwWGo"

& gcloud run deploy geovisor-iser-backend `
  --source ./backend-cloudrun `
  --region us-central1 `
  --allow-unauthenticated `
  --set-env-vars="SUPABASE_URL=$supabaseUrl,SUPABASE_SERVICE_ROLE_KEY=$supabaseServiceKey,SUPABASE_STORAGE_BUCKET=documentos_iser" `
  --update-secrets="GEMINI_API_KEY=gemini-api-key:latest"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "🎉 ¡DESPLIEGUE COMPLETADO CON ÉXITO!" -ForegroundColor Green
    Write-Host "Por favor copia la URL provista por Cloud Run arriba (ej: https://geovisor-iser-backend-xxxx.run.app)" -ForegroundColor Yellow
    Write-Host "y reemplázala en el archivo 'frontend/js/core/config.js' en la variable 'CLOUD_RUN_BASE_URL'." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "❌ Ocurrió un error durante el despliegue. Revisa la salida de error arriba." -ForegroundColor Red
}
