/**
 * dashboard-engine.js — Motor de auditoría de completitud.
 *
 * Audita la completitud de un bloque (o una sede completa) contrastando
 * las disciplinas canónicas del schema v3 contra el contenido real en
 * Firebase Storage. No “decora”: devuelve métricas accionables.
 *
 * Diseño (respeta el resto del sistema):
 *   • Schema canónico:  loadSchema() → disciplinasBaseBloque (11 disciplinas).
 *     NO se hardcodea la lista: si el schema cambia, el motor lo refleja.
 *   • Rutas de Storage: buildStoragePath() → respeta el prefijo `staging/`
 *     en staging y sin prefijo en producción. Nunca construye rutas crudas.
 *   • Firebase Storage: importado desde el CDN 11.6.1 (igual que el resto
 *     del frontend, sin bundler).
 *   • Presencia de archivos: listAll() con detección rápida — en cuanto
 *     encuentra un item o una subcarpeta con items, marca la disciplina
 *     como "con contenido". No descarga archivos.
 *   • Caché en memoria: evita relisting si se consulta la misma ruta dos
 *     veces seguidas (ej. dashboard + file-explorer).
 *
 * Sin cambios de lógica, auth, events ni Firebase.
 */

import { ref, listAll } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js';
import { storage } from '../services/firebase.js';
import { buildStoragePath } from '../core/storage-routing.js';
import { loadSchema, buildSedeTree } from '../core/structure-schema.js';
import { Logger } from '../core/logger.js';

const PLACEHOLDER_FILES = new Set(['.keep', '.placeholder', '.gitkeep']);
const SCAN_DEPTH = 2; // profundidad máxima de descenso para decidir presencia

const cache = new Map();
const inflight = new Map();

/**
 * Pesos por disciplina para el score ponderado. Las disciplinas críticas
 * (planos arquitectónicos, estructurales, documentos, accesibilidad,
 * diagnósticos) pesan más. Lo que falte se computa como peso 1 (neutro).
 * Mantener los nombres canónicos del schema v3.
 */
export const DISCIPLINE_WEIGHTS = Object.freeze({
  '01_Arquitectonico': 2,
  '02_Estructural': 2,
  '03_Electricos_y_Red_de_Datos': 1.5,
  '04_Hidrosanitarios_y_Gas': 1.5,
  '05_Renders_y_Presentaciones': 1,
  '06_Documentos': 2,
  '07_Matriz_Accesibilidad_NTC_6047': 2,
  '08_Registro_Fotografico': 1,
  '09_Diagnosticos': 2,
  '10_Mantenimientos': 1,
  '11_Historicos': 1,
});

function weightOf(disciplina) {
  return DISCIPLINE_WEIGHTS[disciplina] ?? 1;
}

/**
 * Severidad de un vacío por disciplina. Se usa para priorizar alertas.
 *   high   → bloquea habitabilidad/entrega del bloque.
 *   medium → compromete auditoría/normativa (accesibilidad, diagnósticos).
 *   low    → deseable pero no bloqueante.
 */
export function getSeverity(disciplina) {
  if (['01_Arquitectonico', '02_Estructural'].includes(disciplina)) return 'high';
  if (['07_Matriz_Accesibilidad_NTC_6047', '09_Diagnosticos'].includes(disciplina)) return 'medium';
  return 'low';
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

/**
 * Limpia la caché interna. Útil tras subir/borrar archivos.
 */
export function clearAuditCache() {
  cache.clear();
  inflight.clear();
}

// ── Helpers de presencia ──────────────────────────────────────────
function isRealFile(item) {
  if (!item || !item.name) return false;
  return !PLACEHOLDER_FILES.has(item.name);
}

async function listPath(path) {
  if (cache.has(path)) return cache.get(path);
  if (inflight.has(path)) return inflight.get(path);

  const p = (async () => {
    try {
      const res = await listAll(ref(storage, path));
      const result = {
        items: res.items.filter(isRealFile),
        prefixes: res.prefixes,
      };
      cache.set(path, result);
      return result;
    } catch (err) {
      // Ruta inexistente o sin permisos: lo tratamos como vacío.
      Logger.debug?.(`[dashboard-engine] listAll falló en "${path}": ${err.message}`);
      const empty = { items: [], prefixes: [] };
      cache.set(path, empty);
      return empty;
    } finally {
      inflight.delete(path);
    }
  })();

  inflight.set(path, p);
  return p;
}

/**
 * Detecta si un path (disciplina) tiene contenido real, descendiendo
 * hasta SCAN_DEPTH niveles. Corta en cuanto encuentra el primer archivo.
 */
async function hasContent(path, depth = 0) {
  const listing = await listPath(path);
  // Early exit #1: algún archivo real en este nivel.
  if (listing.items.length > 0) return true;
  // Early exit #2: sin subcarpetas → imposible encontrar nada más abajo.
  if (listing.prefixes.length === 0) return false;
  // Límite de profundidad para no hacer crawling recursivo infinito.
  if (depth >= SCAN_DEPTH) return false;

  for (const childRef of listing.prefixes) {
    const childPath = childRef.fullPath || `${path}/${childRef.name}`;
    if (await hasContent(childPath, depth + 1)) return true;
  }
  return false;
}

// ── API pública ───────────────────────────────────────────────────

/**
 * Auditoría de un bloque. Para cada disciplina canónica verifica si
 * tiene archivos en Storage (recursivo superficial, ignorando .keep).
 *
 * @param {string} sedeId   "pamplona" | "rinconada" | "caldera"
 * @param {string} bloque   Nombre canónico: "04_Bloque_Administrativo", etc.
 * @returns {Promise<{
 *   sede: string,
 *   bloque: string,
 *   total: number,
 *   complete: number,
 *   percent: number,
 *   disciplinas: Array<{ disciplina: string, path: string, hasFiles: boolean }>,
 *   missing: Array<{ disciplina: string, path: string }>
 * }>}
 */
export async function auditBloque(sedeId, bloque) {
  if (!sedeId) throw new Error('auditBloque: sedeId es obligatorio.');
  if (!bloque) throw new Error('auditBloque: bloque es obligatorio.');

  const schema = await loadSchema();
  const disciplinas = Array.isArray(schema?.disciplinasBaseBloque)
    ? schema.disciplinasBaseBloque
    : [];

  if (disciplinas.length === 0) {
    Logger.warn?.('[dashboard-engine] disciplinasBaseBloque vacío en schema.');
  }

  const checks = await Promise.all(
    disciplinas.map(async (disciplina) => {
      const path = buildStoragePath({ sedeId, bloque, disciplina });
      const ok = await hasContent(path);
      return {
        disciplina,
        path,
        hasFiles: ok,
        weight: weightOf(disciplina),
      };
    })
  );

  const total = checks.length;
  const complete = checks.filter((c) => c.hasFiles).length;

  // Score ponderado: disciplinas críticas pesan más que las accesorias.
  const totalWeight = checks.reduce((acc, c) => acc + c.weight, 0);
  const completeWeight = checks
    .filter((c) => c.hasFiles)
    .reduce((acc, c) => acc + c.weight, 0);
  const percent = totalWeight === 0 ? 0 : Math.round((completeWeight / totalWeight) * 100);

  const missing = checks
    .filter((c) => !c.hasFiles)
    .map((c) => ({
      disciplina: c.disciplina,
      path: c.path,
      severity: getSeverity(c.disciplina),
      weight: c.weight,
    }));

  return {
    sede: sedeId,
    bloque,
    total,
    complete,
    percent,
    totalWeight,
    completeWeight,
    disciplinas: checks,
    missing,
  };
}

/**
 * Auditoría de todos los bloques de una sede.
 * Si no se pasan bloques, se leen del schema (nombres canónicos).
 *
 * @param {string} sedeId
 * @param {Array<{name?: string, path?: string}>} [bloques]
 * @returns {Promise<{
 *   sede: string,
 *   global: { total: number, complete: number, percent: number, blocksCount: number },
 *   bloques: Array<Awaited<ReturnType<typeof auditBloque>> & { name: string }>,
 *   alerts: Array<{ bloque: string, disciplina: string, path: string }>
 * }>}
 */
export async function auditSede(sedeId, bloques) {
  if (!sedeId) throw new Error('auditSede: sedeId es obligatorio.');

  let list = Array.isArray(bloques) ? bloques.slice() : null;
  if (!list || list.length === 0) {
    const tree = await buildSedeTree(sedeId);
    list = Array.isArray(tree?.bloques)
      ? tree.bloques.map((b) => ({ name: b.name || b.path, path: b.path || b.name }))
      : [];
  }

  const audits = await Promise.all(
    list.map(async (b) => {
      const canonical = b.path || b.name;
      const audit = await auditBloque(sedeId, canonical);
      return { ...audit, name: b.name || canonical };
    })
  );

  const totalChecks = audits.reduce((acc, a) => acc + a.total, 0);
  const totalComplete = audits.reduce((acc, a) => acc + a.complete, 0);

  // Global ponderado: agrega los pesos de todos los bloques auditados.
  // Éste es el "índice técnico": refleja verdaderamente el estado de
  // entregables porque las disciplinas críticas pesan más.
  const totalWeight = audits.reduce((acc, a) => acc + a.totalWeight, 0);
  const completeWeight = audits.reduce((acc, a) => acc + a.completeWeight, 0);
  const percent = totalWeight === 0 ? 0 : Math.round((completeWeight / totalWeight) * 100);

  // Avance bruto: simple relación disciplinas-con-contenido / total.
  // Útil como lectura "humana" y para contrastarlo contra el índice
  // técnico — si hay gran diferencia es que faltan las críticas.
  const flatPercent = totalChecks === 0 ? 0 : Math.round((totalComplete / totalChecks) * 100);

  const alerts = audits
    .flatMap((a) =>
      a.missing.map((m) => ({
        bloque: a.name,
        bloquePath: a.bloque,
        disciplina: m.disciplina,
        path: m.path,
        severity: m.severity,
        weight: m.weight,
      }))
    )
    // Orden: high → medium → low; y dentro, mayor peso primero.
    .sort(
      (x, y) =>
        (SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]) ||
        (y.weight - x.weight)
    );

  // KPI clave: bloques "entregables" (score ponderado ≥ 80%).
  const bloquesCompletos = audits.filter((a) => a.percent >= 80).length;

  // Riesgo agregado: cuántos huecos críticos (severity=high) hay en toda la
  // sede. Es el número más accionable para un responsable técnico:
  // "cuántas ausencias bloquearían la habitabilidad/entrega del bloque".
  const riskCritical = audits.reduce(
    (acc, a) => acc + a.missing.filter((m) => m.severity === 'high').length,
    0
  );
  const riskMedium = audits.reduce(
    (acc, a) => acc + a.missing.filter((m) => m.severity === 'medium').length,
    0
  );
  // Bloques en riesgo = bloques con al menos un hueco 'high'.
  const blocksAtRisk = audits.filter(
    (a) => a.missing.some((m) => m.severity === 'high')
  ).length;

  return {
    sede: sedeId,
    global: {
      total: totalChecks,
      complete: totalComplete,
      totalWeight,
      completeWeight,
      percent,                    // índice técnico (ponderado) — principal
      completenessIndex: percent, // alias explícito para lecturas externas/IA
      flatPercent,                // avance bruto sin pesos
      blocksCount: audits.length,
      blocksComplete: bloquesCompletos,
      blocksIncomplete: audits.length - bloquesCompletos,
      riskCritical,
      riskMedium,
      blocksAtRisk,
    },
    bloques: audits,
    alerts,
  };
}

/**
 * Resumen compacto por bloque, pensado para alimentar a un módulo de IA
 * (recomendaciones, priorización, redacción de auditoría normativa).
 * No depende del DOM ni de eventos: es puro dato.
 *
 * @param {Awaited<ReturnType<typeof auditBloque>>} audit
 * @returns {{
 *   sede: string, bloque: string,
 *   score: number,
 *   critical: number, medium: number, low: number,
 *   totalMissing: number,
 *   missing: Array<{ disciplina: string, severity: string, weight: number }>
 * }}
 */
export function buildAuditSummary(audit) {
  const missing = Array.isArray(audit?.missing) ? audit.missing : [];
  const countBy = (sev) => missing.filter((m) => m.severity === sev).length;
  const score = audit?.percent ?? 0;

  return {
    sede: audit?.sede ?? null,
    bloque: audit?.bloque ?? null,
    score,
    status: score >= 80 ? 'ok' : 'incomplete',
    critical: countBy('high'),
    medium: countBy('medium'),
    low: countBy('low'),
    totalMissing: missing.length,
    missing: missing.map((m) => ({
      disciplina: m.disciplina,
      severity: m.severity,
      weight: m.weight,
    })),
  };
}
