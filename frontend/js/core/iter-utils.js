/**
 * iter-utils.js — Helpers defensivos para iteración sobre estructuras dinámicas del schema v2.
 *
 * Problema que resuelve:
 *   Varias colecciones del schema/árbol pueden llegar como:
 *     - Array (forma canónica)
 *     - Objeto indexado por clave (formato heredado)
 *     - null / undefined (carga fallida)
 *   Iterarlas directamente con for..of / .map / .forEach provoca
 *   "TypeError: object is not iterable (cannot read property Symbol(Symbol.iterator))".
 *
 * Uso típico:
 *   import { normalizeToArray, normalizeItem } from '../core/iter-utils.js';
 *
 *   const items = normalizeToArray(node.subcarpetas);
 *   for (const raw of items) {
 *     const { nombre, dinamica } = normalizeItem(raw);
 *     ...
 *   }
 */
import { Logger } from './logger.js';

/**
 * Convierte cualquier input en un array iterable seguro.
 * - Array: se retorna tal cual.
 * - Objeto plano: Object.values(input).
 * - Set / Map: Array.from(values).
 * - null/undefined/primitivo: [].
 *
 * Nunca lanza. Loguea warning cuando recibe tipos inesperados.
 *
 * @template T
 * @param {Array<T>|Record<string,T>|Set<T>|Map<any,T>|null|undefined} input
 * @param {{ label?: string }} [opts]
 * @returns {Array<T>}
 */
export function normalizeToArray(input, opts = {}) {
  if (input == null) return [];
  if (Array.isArray(input)) return input;

  if (input instanceof Set)  return Array.from(input);
  if (input instanceof Map)  return Array.from(input.values());

  if (typeof input === 'object') {
    return Object.values(input);
  }

  Logger?.warn?.(`[iter-utils] normalizeToArray: tipo no iterable (${typeof input})${opts.label ? ' @ ' + opts.label : ''}, devolviendo [].`);
  return [];
}

/**
 * Normaliza un item de subestructura/subcarpeta al formato canónico
 *   { nombre: string, dinamica: boolean, raw: <input> }
 *
 * Reglas:
 *   - string         → { nombre: input, dinamica: false }
 *   - { nombre }     → tal cual (dinamica coerced a boolean)
 *   - { name }       → { nombre: name } (alias)
 *   - otro           → { nombre: '', dinamica: false }  (failsafe, no rompe)
 *
 * @param {string|object|null|undefined} input
 * @returns {{ nombre: string, dinamica: boolean, raw: any }}
 */
export function normalizeItem(input) {
  if (input == null) return { nombre: '', dinamica: false, raw: input };
  if (typeof input === 'string') {
    return { nombre: input, dinamica: false, raw: input };
  }
  if (typeof input === 'object') {
    const nombre   = typeof input.nombre === 'string' ? input.nombre
                   : typeof input.name   === 'string' ? input.name
                   : '';
    const dinamica = input.dinamica === true || input.dynamic === true;
    return { nombre, dinamica, raw: input };
  }
  return { nombre: String(input ?? ''), dinamica: false, raw: input };
}

/**
 * Azúcar sintáctico: normaliza un array mezclado de strings/objetos a objetos canónicos.
 * @param {any} input
 * @returns {Array<{nombre: string, dinamica: boolean, raw: any}>}
 */
export function normalizeItemsArray(input) {
  return normalizeToArray(input).map(normalizeItem);
}
