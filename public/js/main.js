/**
 * Punto de entrada. Carga bootstrap para inicialización modular.
 */
// 🟢 Registro de DEBUG para ver si el código se carga
console.log("🚀 Iniciando Geovisor ISER...");

import { bootstrap } from './bootstrap.js';

bootstrap().catch(e => {
  console.error('❌ Error en bootstrap:', e);
  alert("Error al cargar la aplicación: " + e.message);
});

// Agregar un registro global para ver el estado de la app
window.addEventListener('authStateChanged', (user) => {
  console.log("🔐 Estado de autenticación cambiado:", user ? "Usuario logueado" : "Sin sesión");
});
