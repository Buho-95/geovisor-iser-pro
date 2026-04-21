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

## 9. Próximo paso — Staging real (pendiente)

Este documento cubre el **entorno de desarrollo local**. El siguiente entorno a configurar es un **Staging real** con:

- Proyecto Firebase independiente (`geovisor-iser-staging`).
- Copia real de Firestore y Storage desde producción.
- URL dedicada (`geovisor-iser-staging.web.app` o custom).
- Pruebas con datos reales, auditoría IA real, carpetas reales.

Cuando estés listo, abre un chat con: **"vamos a configurar staging real"**.
