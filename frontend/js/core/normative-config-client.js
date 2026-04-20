/**
 * Fuente única: /shared/normative-config.json (espejo de functions/normative-config.json vía sync-config).
 */
import { Logger } from './logger.js';

const FALLBACK = {
  keywords: {},
  thresholds: {
    semaforoVerde: 85,
    semaforoAmarillo: 60,
    mapaVerde: 80,
    mapaAmarillo: 50,
  },
};

let cache = null;

export async function ensureNormativeConfig() {
  if (cache) return cache;
  try {
    const res = await fetch('/shared/normative-config.json', { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cache = await res.json();
    return cache;
  } catch (e) {
    Logger.warn('normative-config: error al cargar /shared/normative-config.json, usando umbrales por defecto', e);
    cache = FALLBACK;
    return cache;
  }
}

export function getNormativeConfigCached() {
  return cache || FALLBACK;
}
