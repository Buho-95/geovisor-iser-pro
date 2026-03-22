/**
 * Logger centralizado para el Geovisor ISER.
 * Solo emite logs de nivel info/debug en entornos de desarrollo (localhost).
 * En producción solo se muestran warn y error.
 */
const isDev = location.hostname === 'localhost'
           || location.hostname === '127.0.0.1'
           || !!window.__DEV__;

export const Logger = {
  info:  (...args) => { if (isDev) console.log('[ISER]', ...args); },
  debug: (...args) => { if (isDev) console.debug('[ISER:DBG]', ...args); },
  warn:  (...args) => { console.warn('[ISER:WARN]', ...args); },
  error: (...args) => { console.error('[ISER:ERR]', ...args); },
};
