# Arquitectura Geovisor ISER

## Estructura de carpetas

```
public/
├── index.html
├── css/styles.css
├── js/
│   ├── main.js              # Entrada → bootstrap
│   ├── bootstrap.js         # Orquestación e inicialización
│   ├── config.js            # Re-export (compat)
│   ├── state.js             # Re-export (compat)
│   ├── firebase-app.js      # Re-export (compat)
│   ├── auth.js              # Re-export (compat)
│   ├── firestore-sync.js    # Re-export (compat)
│   ├── map.js               # Mapa Leaflet
│   ├── campus-data.js       # Datos del campus
│   ├── ui.js                # Panel planoteca
│   ├── visor.js             # Modal visor documentos
│   ├── upload.js            # Subida de archivos
│   ├── core/
│   │   ├── config.js        # Firebase + constantes
│   │   ├── constants.js     # Colecciones, rutas, roles
│   │   ├── state.js         # Estado global reactivo
│   │   └── events.js        # Pub/sub (desacoplamiento)
│   ├── services/
│   │   ├── firebase.js      # Auth, Firestore, Storage
│   │   ├── auth.js         # Login, logout, perfil usuario
│   │   └── firestore.js    # Sync archivos_iser
│   ├── plugins/
│   │   └── layer-manager.js # Capas SIG (GeoJSON, WMS, WMTS)
│   └── modules/
│       ├── dashboard/       # Estadísticas (lazy)
│       └── bim-viewer/      # Visor IFC (placeholder, lazy)
```

## Flujo de eventos

| Evento | Emisor | Consumidores |
|--------|--------|--------------|
| `map:ready` | map.js | layer-manager |
| `auth:stateChanged` | auth.js | bootstrap |
| `firestore:sync` | firestore.js | ui, dashboard |
| `map:blockSelected` | main | - |
| `viewer:open` | visor.js | bim-viewer |
| `bim:open` | bim-viewer | - |
| `map:layerToggle` | layer-manager | - |

## Extensibilidad

### Capas SIG
```js
import { addLayer, LAYER_TYPES } from './plugins/layer-manager.js';
addLayer('mi-capa', { type: LAYER_TYPES.GEOJSON, url: '/data/capa.json' });
```

### Dashboard
- Se alimenta de `state.archivosNube` y `EVENTS.FIRESTORE_SYNC`
- Extensible a colección `estadisticas` en Firestore

### Visor BIM IFC
- Escucha `EVENTS.VIEWER_OPEN` para archivos tipo `ifc`
- Placeholder para web-ifc-viewer o similar

### Control de usuarios
- `state.userProfile` desde colección `usuarios_iser`
- Constantes `USER_ROLES` en core/constants.js

## Firebase Hosting

Compatible: `firebase deploy` sirve la carpeta `public/` sin build.
