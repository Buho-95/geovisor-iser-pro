/**
 * Punto de entrada. Carga bootstrap para inicialización modular.
 */
import { Logger } from './core/logger.js';
import { bootstrap } from './bootstrap.js';

Logger.info("🚀 Iniciando Geovisor ISER...");

bootstrap().catch(e => {
  Logger.error('❌ Error en bootstrap:', e);
  alert("Error al cargar la aplicación: " + e.message);
});
