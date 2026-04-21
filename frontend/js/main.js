/**
 * Punto de entrada. Carga bootstrap para inicialización modular.
 */
import { Logger } from './core/logger.js';
import { ENV, isProd } from './core/env.js';
import { mountEnvBanner } from './core/env-banner.js';
import { bootstrap } from './bootstrap.js';

Logger.info(`🚀 Iniciando Geovisor ISER... (ENV=${ENV})`);

if (!isProd) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountEnvBanner, { once: true });
  } else {
    mountEnvBanner();
  }
}

bootstrap().catch(e => {
  Logger.error('❌ Error en bootstrap:', e);
  alert("Error al cargar la aplicación: " + e.message);
});
