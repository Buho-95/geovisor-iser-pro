# Guía de Desarrollo — Geovisor ISER

Este documento describe cómo hacer cambios al proyecto **sin romper producción**.

> **Regla de oro:** la rama `main` y el proyecto Firebase `geovisor-iser` son PRODUCCIÓN.
> Jamás se trabaja directo sobre ellos. Todo cambio pasa por `develop` + emuladores.

---

## 1. Entornos

| Entorno       | Dónde corre                    | Datos                   | URL                                  |
|---------------|--------------------------------|-------------------------|--------------------------------------|
| `development` | Tu PC (emuladores Firebase)    | Carpeta `emulator-data/` | `http://localhost:5000`              |
| `preview`     | Firebase Hosting Channel       | Firestore/Storage reales (solo lectura recomendada) | URL temporal tipo `geovisor-iser--preview-xxx.web.app` |
| `production`  | Firebase Hosting (canal live)  | Firestore/Storage reales | `https://geovisor-iser.web.app`       |

La detección es automática en `frontend/js/core/env.js` según el `hostname`.
En **development** y **preview** aparece un banner rojo/naranja arriba: `MODO …`.
En **production** el banner NO se monta nunca.

---

## 2. Ramas Git

- `main`     → código que está en producción. **No se toca directo.**
- `develop`  → rama de trabajo. Aquí haces cambios, pruebas y commits.
- Ramas feature (opcional): `feature/xxx` creadas desde `develop`.

### Comandos típicos

```bash
# Antes de trabajar
git checkout develop
git pull origin develop     # si lo tienes en remoto

# Mientras trabajas
git add .
git commit -m "feat: ..."
git push origin develop     # respaldo en remoto
```

---

## 3. Desarrollo local con emuladores (FLUJO PRINCIPAL)

Los emuladores Firebase simulan Auth, Firestore, Storage y Functions en tu PC.
**No tocan la nube.** Puedes borrar, romper y experimentar sin riesgo.

### Arranque diario

```bash
# 1. Asegúrate de estar en develop
git checkout develop

# 2. Inicia los emuladores
npm run dev
```

Se abrirá:
- **App:**              http://localhost:5000
- **Emulator UI:**      http://localhost:4000  ← aquí ves/editas Firestore, Auth y Storage
- **Auth:**             http://127.0.0.1:9099
- **Firestore:**        http://127.0.0.1:8080
- **Storage:**          http://127.0.0.1:9199
- **Functions:**        http://127.0.0.1:5001

Los datos se **persisten entre reinicios** en `./emulator-data/` (al cerrar con `Ctrl+C` se exportan automáticamente).

### Empezar desde cero (reset de datos)

```bash
npm run dev:fresh
```

### Crear usuarios de prueba

En la UI del emulador (`http://localhost:4000` → Authentication → Add user).
Luego, en Firestore, crea el doc en `usuarios_iser/{uid}` con campo `role: "admin"` para que tenga permisos.

### Qué hace automáticamente el código

Cuando detecta `localhost`:
- `frontend/js/services/firebase.js` → conecta Auth/Firestore/Storage a emuladores.
- `frontend/js/services/api.js` → redirige las llamadas a Functions a `127.0.0.1:5001`.
- `frontend/js/core/env-banner.js` → monta banner `MODO DESARROLLO LOCAL`.
- App Check se desactiva (no aplica en emuladores).

---

## 4. Preview online (compartir con otros sin tocar producción)

Si quieres que otra persona vea tus cambios en una URL temporal **sin afectar la página real**, usa Hosting Channels:

```bash
npm run preview:deploy
```

Esto:
- Despliega SOLO el Hosting (no Firestore/Storage/Functions) a un canal temporal.
- Te devuelve una URL tipo `https://geovisor-iser--preview-xxxxxx.web.app`.
- Expira en **7 días** automáticamente.
- La URL de producción sigue intacta.

> ⚠️ **Importante:** en preview, el frontend SÍ usa Firestore/Storage reales (producción).
> Por eso preview está pensado para **validar UI/UX**, no para pruebas destructivas.
> Para pruebas destructivas usa emuladores locales o el entorno de **staging real** (fase siguiente).

---

## 5. Publicar a producción

Solo cuando los cambios están validados en `develop` y (opcionalmente) en preview:

```bash
# 1. Mezclar develop → main
git checkout main
git merge develop
git push origin main

# 2. Desplegar
npm run deploy:prod
```

`deploy:prod` ejecuta:
1. `sync-config` (copia `normative-config.json` a functions).
2. `firebase deploy --only hosting,functions,firestore,storage --project geovisor-iser`.

---

## 6. Rollback rápido si algo sale mal

```bash
# Revertir el último commit de main
git checkout main
git revert HEAD
npm run deploy:prod

# O volver a un commit específico
git reset --hard <hash_anterior>
npm run deploy:prod
```

Firebase Hosting también guarda versiones: Console → Hosting → "Release history" → Rollback.

---

## 7. Archivos creados/modificados por este flujo

| Archivo | Qué hace |
|---------|----------|
| `firebase.json` | Añadido bloque `emulators` con puertos. |
| `frontend/js/core/env.js` | **Nuevo.** Detecta `development` / `preview` / `production` por hostname. |
| `frontend/js/core/env-banner.js` | **Nuevo.** Banner superior visible solo fuera de producción. |
| `frontend/js/services/firebase.js` | Conexión automática a emuladores en localhost; App Check se salta. |
| `frontend/js/services/api.js` | URLs de Functions conmutan a emulador en dev. |
| `frontend/js/main.js` | Llama a `mountEnvBanner()` si no es producción. |
| `package.json` | Scripts `dev`, `dev:fresh`, `dev:export`, `preview:deploy`, `deploy:prod`. |
| `.gitignore` | Ignora `emulator-data/` y logs de emulador. |

---

## 8. Checklist antes de hacer `deploy:prod`

- [ ] Probado en emuladores (`npm run dev`) sin errores en consola.
- [ ] Probado el flujo crítico: login, mapa, selección de bloque, subida de archivo, auditoría IA.
- [ ] (Opcional) Validado también en preview (`npm run preview:deploy`).
- [ ] Commits en `develop` pusheados.
- [ ] Merge a `main` sin conflictos.
- [ ] Revisado `firestore.rules` y `storage.rules` — sin reglas peligrosas abiertas.
- [ ] Al menos un admin autentica correctamente en emulador.

---

## 9. Staging real (namespace compartido)

### 9.1 Arquitectura

El Geovisor ISER usa **un único proyecto Firebase** (`geovisor-iser`), pero dentro de él conviven dos namespaces **totalmente aislados**:

| Recurso | Producción | Staging |
|---------|-----------|---------|
| Firestore | `archivos_iser`, `usuarios_iser`, `bloques_estado`, ... | `staging_archivos_iser`, `staging_usuarios_iser`, `staging_bloques_estado`, ... |
| Storage | `documentos_iser/...`, `auditorias/...`, ... | `staging/documentos_iser/...`, `staging/auditorias/...`, ... |
| URL | `https://geovisor-iser.web.app` | `https://geovisor-iser--staging-<hash>.web.app` |

La detección del entorno es **automática por hostname** en `frontend/js/core/env.js`:

- `localhost` / `127.0.0.1` → `development` (banner rojo, emuladores)
- URL con `--staging-` → `staging` (banner naranja, namespace `staging_*` / `staging/`)
- Dominio principal → `production` (sin banner, namespace sin prefijo)

### 9.2 Helpers que garantizan el aislamiento

- `frontend/js/core/paths.js` — `getCollection(name)` y `getStoragePath(path)` aplican el prefijo correspondiente.
- `frontend/js/core/constants.js` — `COLLECTIONS` y `STORAGE_PATHS` ya son **env-aware** (apuntan al namespace correcto sin intervención).
- `frontend/js/core/env-validate.js` — valida al arrancar que TODOS los paths son coherentes con el entorno. Si detecta fuga, emite error.
- `functions/envNamespace.js` — mismos helpers en backend; cada llamada recibe `env` en body o header `X-Geovisor-Env`.
- `firestore.rules` y `storage.rules` — reglas replicadas para `staging_*` y `staging/` (mismo modelo de permisos).

### 9.3 Flujo staging

#### Primera vez — clonar datos de producción a staging

```bash
# 1. Despliega reglas staging (solo primera vez, o cuando cambien las reglas)
npm run staging:deploy:rules

# 2. Despliega las Cloud Functions (nuevas: aceptan env="staging")
npm run staging:deploy:functions

# 3. Simula la clonación (DRY-RUN — no escribe nada)
npm run staging:clone:dry

# 4. Si el dry-run se ve bien, clona de verdad
npm run staging:clone:apply

# 5. Despliega el frontend al canal staging
npm run staging:deploy:hosting
```

`npm run staging:deploy` ejecuta todo lo anterior EXCEPTO la clonación de datos.

#### Ciclo normal de trabajo en staging

```bash
git checkout develop
# ...haces cambios...
git add . && git commit -m "feat: ..."
npm run staging:deploy:hosting     # despliega solo el frontend al canal staging
```

La URL preview permanece válida 30 días desde el último deploy.

### 9.4 Clonación selectiva (script)

El script `scripts/clone-to-staging.js` admite flags:

```bash
# Solo Firestore
node scripts/clone-to-staging.js --apply --only=firestore

# Solo Storage
node scripts/clone-to-staging.js --apply --only=storage

# Una colección específica
node scripts/clone-to-staging.js --apply --collections=archivos_iser,bloques_estado

# Un path específico de Storage
node scripts/clone-to-staging.js --apply --paths=documentos_iser
```

**Protecciones del script:**
- DRY-RUN por defecto (sin `--apply` no escribe nada).
- Aborta si el destino no empieza con `staging_` / `staging/`.
- Cada documento migrado guarda `__clonedFrom` y `__clonedAt` para trazabilidad.
- Producción es **solo lectura**. El script nunca escribe sobre colecciones de producción.

**Requisitos previos:**
- Credenciales Admin: `export GOOGLE_APPLICATION_CREDENTIALS=/ruta/a/service-account.json`
  (o haber hecho `firebase login` en la máquina; en Windows es GCP Application Default Credentials).
- `cd functions && npm install` (el script reutiliza `firebase-admin` de `functions/`).

### 9.5 Forzar un entorno manualmente (solo QA)

Para simular staging desde el navegador sin desplegar:

```
?env=staging                                    ← una sola sesión (URL)
localStorage.setItem('__geovisor_env_override__','staging')  ← persistente
```

No se puede forzar `production` desde otra URL — por seguridad.

### 9.6 Validación post-despliegue staging

Al abrir la URL staging, comprueba en la consola del navegador:

- ✅ Banner naranja arriba: `MODO STAGING (PRUEBAS REALES)`.
- ✅ Badge naranja esquina inferior derecha: `STAGING`.
- ✅ Mensaje en consola: `✓ Namespace isolation OK · ENV=staging`.
- ✅ Tabla con `archivos (env): staging_archivos_iser`, `storage (env): staging/documentos_iser`.
- ✅ Sin mensaje `⚠ Inconsistencia de namespace`.
- ✅ En Firestore Console (Firebase), los cambios aparecen SOLO bajo colecciones `staging_*`.
- ✅ En Storage Console, los archivos suben bajo `staging/documentos_iser/...`.

### 9.7 Restricciones

- ❌ NUNCA modificar datos de producción desde staging.
- ❌ NUNCA eliminar colecciones reales (`archivos_iser`, etc.).
- ❌ NUNCA usar rutas mixtas (escribir en `documentos_iser/` desde staging).
- ✅ TODO staging debe vivir bajo `staging_*` (Firestore) o `staging/` (Storage).

### 9.8 Mapa de archivos nuevos/modificados por Staging

| Archivo | Qué hace |
|---------|----------|
| `frontend/js/core/env.js` | Detecta `development` / `staging` / `production` + overrides QA. |
| `frontend/js/core/paths.js` | **Nuevo.** `getCollection()`, `getStoragePath()`, `belongsToCurrentEnv()`. |
| `frontend/js/core/constants.js` | `COLLECTIONS`/`STORAGE_PATHS` env-aware + versiones `*_RAW`. |
| `frontend/js/core/env-banner.js` | 3 colores (rojo/naranja/ninguno) + badge persistente. |
| `frontend/js/core/env-validate.js` | **Nuevo.** Valida al arrancar que los paths son correctos. |
| `frontend/js/services/api.js` | Envía `env` en body + header `X-Geovisor-Env` al backend. |
| `functions/envNamespace.js` | **Nuevo.** Namespacing server-side. |
| `functions/storageInventory.js` | Acepta `env` y escanea `staging/documentos_iser/...`. |
| `functions/index.js` | `inventario_bloques` → `staging_inventario_bloques` según env. |
| `firestore.rules` | Reglas replicadas para `staging_*`. |
| `storage.rules` | Reglas replicadas para `staging/`. |
| `scripts/clone-to-staging.js` | **Nuevo.** Clonación producción→staging con DRY-RUN por defecto. |

---

## 9.9 Estructura canónica del Geovisor (PDF oficial)

El Geovisor contiene la **estructura jerárquica completa** definida en el PDF oficial *"Estructura carpetas Geovisor - ISER"*, activa tanto en Staging como en Producción.

### Schema y reglas

- Fuente de verdad: [`frontend/shared/estructura-base.json`](frontend/shared/estructura-base.json)
- **Jerarquía:** `SEDE → BLOQUE → DISCIPLINA → SUBCARPETAS`.
- **10 disciplinas por bloque** (`01_Arquitectonico` … `10_Mantenimientos`).
- **Subestructura repetible** para la mayoría de disciplinas:
  `01_Modelos_2D_AutoCAD, 02_Modelo_3D_SketchUP, 03_Entregables_PDF, 04_Modelo_BIM_Revit, 05_Varios`.
- **Regla verde (laboratorio):** en bloques con `tipo: "laboratorio"`, la subcarpeta
  `03_Electricos_y_Red_de_Datos → 01_Electricos` se expande en `01_General`, `02_Laboratorios`
  y `03_Auditorios`, cada una con subestructura repetible.
- **Regla roja (dinámica):** las disciplinas `06_Documentos`, `07_Matriz_Accesibilidad_NTC_6047`,
  `08_Registro_Fotografico`, `09_Diagnosticos`, además de `02_Proyecciones_Nuevas_*`, `03_Varios_*`
  y `10_Historicos` permiten crear subcarpetas dinámicas con nomenclatura `NN_Nombre`
  (`^[0-9]{2}_[A-Za-z0-9_]+$`).

### Colecciones Firestore

| Colección (Prod) | Colección (Staging) | Contenido |
|------------------|---------------------|-----------|
| `estructura_base` | `staging_estructura_base` | 1 doc por sede con el árbol completo (nivelSede + bloques). Generado por el seed. Solo lectura para usuarios; escritura restringida a administradores. |
| `estructura_dinamica` | `staging_estructura_dinamica` | 1 doc por carpeta NN_Nombre creada por usuarios bajo zonas "rojas". |

### Storage

- **Producción:** `sedes/{sedeId}/{bloque}/{disciplina}/{subcarpeta}/archivo` (y `sedes/{sedeId}/{nivelSedeFolder}/...`)
- **Staging:** `staging/sedes/{sedeId}/{bloque}/{disciplina}/{subcarpeta}/archivo` (y `staging/sedes/{sedeId}/{nivelSedeFolder}/...`)

Cada nodo hoja del schema tiene un placeholder `.keep` para que la estructura sea navegable desde el inicio aunque no haya archivos subidos.

### Seed inicial (obligatorio la primera vez)

Para que el explorador de la planoteca funcione correctamente, es necesario inicializar el árbol de carpetas base y marcadores `.keep`.

> [!TIP]
> **Autenticación simplificada:** Los scripts de seeding y clonación (`seed-production-structure.js`, `seed-staging-structure.js`, `clone-to-staging.js`) detectan automáticamente las credenciales locales de tu máquina si has ejecutado `firebase login` previamente. Generan un archivo temporal de Application Default Credentials (ADC) bajo `.firebase/temp-adc.json` para dar acceso a las APIs de Google Cloud sin requerir descargar claves de cuentas de servicio manualmente, limpiándose automáticamente tras finalizar la tarea.

#### Comandos para Staging:
```bash
# Dry-run (muestra qué haría, no escribe nada)
npm run staging:seed:dry

# Aplicar a staging (escribe Firestore + placeholders Storage)
npm run staging:seed:apply

# Solo Firestore o Storage de staging
npm run staging:seed:firestore
npm run staging:seed:storage
```

#### Comandos para Producción:
```bash
# Dry-run (muestra qué haría, no escribe nada)
npm run prod:seed:dry

# Aplicar a producción (escribe Firestore + placeholders Storage)
npm run prod:seed:apply

# Solo Firestore o Storage de producción
npm run prod:seed:firestore
npm run prod:seed:storage
```

El seed de producción cuenta con validaciones de seguridad estrictas para garantizar que no se utilicen prefijos de staging en producción.

### UI de la Planoteca

- **Panel "Base de Datos"**: muestra el árbol completo de la sede activa, aplicando regla verde por bloque y carpetas dinámicas. Cada nodo dinámico tiene botón "+" para crear subcarpetas con validación en vivo (auto-sugiere siguiente número disponible).
- **Selección de ruta** (botón diana): emite `geovisor:structure-path-selected` — el flujo de upload queda pre-cargado con la ruta para subir archivos directo ahí.
- **Upload**: usa `buildStoragePath()` para construir la ruta física respetando la nueva jerarquía. Los archivos heredados se siguen cargando mediante el mapeador de compatibilidad (`fileMapper.js`) que funciona como fallback inteligente de cara al usuario.
- **Metadata IA**: cada archivo subido registra en Firestore un bloque `ia: {disciplina, subcarpeta, tipoArchivo, anio, entorno, schemaVersion}` listo para auditoría normativa.

### Módulos del Core

| Archivo | Qué hace |
|---------|----------|
| `frontend/shared/estructura-base.json` | Schema canónico del PDF (single source of truth). |
| `frontend/js/core/structure-schema.js` | Navegación del schema, regla verde, dynamic folders. |
| `frontend/js/core/structure-validator.js` | Validación de nomenclatura NN_, rutas y consistencia. |
| `frontend/js/core/storage-routing.js` | `buildStoragePath()` jerárquico por sede en todos los entornos. |
| `frontend/js/core/dynamic-folders-store.js` | CRUD de carpetas dinámicas (`estructura_dinamica` y `staging_estructura_dinamica`). |
| `frontend/js/modules/structure-tree.js` | UI del árbol navegable para la planoteca. |
| `frontend/js/modules/dynamic-folder-modal.js` | Modal interactivo para crear carpeta NN_Nombre. |
| `scripts/seed-production-structure.js` | Inicializa base de datos y Storage en producción. |
| `scripts/seed-staging-structure.js` | Inicializa base de datos y Storage en staging. |

### Restricciones de la estructura canónica

- ❌ NO se permite crear carpetas fuera del schema (solo bajo nodos con `acceptsDynamic: true`).
- ❌ NO se aceptan nombres sin nomenclatura `NN_Nombre`.
- ✅ La validación es activa en UI (modal) y en código (`validateFolderName`, `validatePath`, `validateStoragePath`).

---

## 10. Cuándo usar qué entorno

| Tarea | Entorno recomendado |
|-------|---------------------|
| Cambios de UI / lógica que no tocan datos | `development` (emuladores) |
| Pruebas que requieren datos reales (auditoría IA, estructura de carpetas) | `staging` |
| Compartir una versión de prueba con otros | `staging` (URL preview) |
| Despliegue final validado | `production` |
