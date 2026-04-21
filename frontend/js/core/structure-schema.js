/**
 * structure-schema.js — Navegación del schema v3 (PDF oficial Geovisor ISER).
 *
 * Cambios clave v3 vs v2:
 *   - Nivel sede por ROLES (general/proyecciones/varios):
 *       * general      → 01_Urbanistico, 02_Topografia, 03_Electricos(subniveles), 04_Documentacion_General(dyn)
 *       * proyecciones → 01_Proyectos(dyn), 02_En_Construccion(dyn), 03_Archivos_en_Espera(dyn)
 *       * varios       → directo dinámico (sin hijos internos)
 *   - 11_Historicos ELIMINADO del nivel sede (permanece en nivel bloque).
 *   - 05_Renders_y_Presentaciones: 01_Renders(dyn), 02_Presentaciones(dyn), SIN subestructura repetible.
 *   - Regla verde: 01_Electricos en bloque lab = [01_General, 02_Laboratorios, 03_Auditorios]
 *     cada uno con subestructura repetible completa (no hojas).
 *
 * TreeNode = { name, path, kind, dynamic, acceptsDynamic?, children? }
 */
import { Logger } from './logger.js';
import { normalizeToArray, normalizeItem } from './iter-utils.js';

const SCHEMA_URL = new URL('../../shared/estructura-base.json', import.meta.url).toString();

let _schemaPromise = null;
let _schemaCache = null;

export async function loadSchema() {
  if (_schemaCache) return _schemaCache;
  if (_schemaPromise) return _schemaPromise;
  _schemaPromise = fetch(SCHEMA_URL)
    .then(r => { if (!r.ok) throw new Error(`Schema HTTP ${r.status}`); return r.json(); })
    .then(json => { _schemaCache = json; return json; })
    .catch(err => { Logger.error('[structure-schema] Error:', err); _schemaPromise = null; throw err; });
  return _schemaPromise;
}

export async function getSedeIds()                { return Object.keys((await loadSchema()).sedes); }
export async function getSede(sedeId) {
  const s = await loadSchema();
  if (!s.sedes[sedeId]) throw new Error(`Sede desconocida: ${sedeId}`);
  return s.sedes[sedeId];
}
export async function getBloques(sedeId)          { return Object.keys((await getSede(sedeId)).bloques); }
export async function getBloqueInfo(sedeId, bloqueId) {
  const sede = await getSede(sedeId);
  const b = sede.bloques[bloqueId];
  if (!b) return null;
  return { id: bloqueId, ...b };
}
export async function getDisciplinasBloque() {
  const s = await loadSchema();
  return normalizeToArray(s.disciplinasBaseBloque, { label: 'schema.disciplinasBaseBloque' }).slice();
}
export async function getSubestructuraRepetible() {
  const s = await loadSchema();
  return normalizeToArray(s.subestructuraRepetible, { label: 'schema.subestructuraRepetible' })
    .map(normalizeItem)
    .filter(x => x.nombre);
}

/**
 * REGLA VERDE — lista explícita del schema.
 */
export async function esBloqueConLaboratorio(bloqueId) {
  const s = await loadSchema();
  return normalizeToArray(s.bloquesConLaboratorio).includes(bloqueId);
}

/* ═══════════════ Construcción de árbol ═══════════════ */

function makeNode(name, path, kind, dynamic) {
  // INVARIANTE v3: todos los nodos tienen children:[] para iteración segura.
  return { name, nombre: name, path, kind, dynamic: !!dynamic, children: [] };
}

function buildSubestructuraRepetibleNodes(sub, basePath) {
  return normalizeToArray(sub, { label: 'subestructuraRepetible' })
    .map(normalizeItem)
    .filter(sc => !!sc.nombre)
    .map(sc => {
      const n = makeNode(sc.nombre, `${basePath}/${sc.nombre}`, 'subcarpeta', !!sc.dinamica);
      if (sc.dinamica) { n.children = []; n.acceptsDynamic = true; }
      return n;
    });
}

/**
 * Árbol completo de un bloque aplicando regla verde por lista.
 */
export async function buildBloqueTree(sedeId, bloqueId) {
  const s = await loadSchema();
  const info = await getBloqueInfo(sedeId, bloqueId);
  if (!info) throw new Error(`Bloque desconocido: ${sedeId}/${bloqueId}`);

  const esLab = normalizeToArray(s.bloquesConLaboratorio).includes(bloqueId);
  const sub = await getSubestructuraRepetible();
  const disciplinas = normalizeToArray(s.disciplinasBaseBloque, { label: 'disciplinasBaseBloque' });
  const defs = s.disciplinaBloque || {};
  const root = [];

  for (const disc of disciplinas) {
    const def = defs[disc];
    if (!def) continue;
    const discPath = `${bloqueId}/${disc}`;
    const node = makeNode(disc, discPath, 'disciplina', false);

    switch (def.tipo) {
      case 'subestructura_repetible':
        node.children = buildSubestructuraRepetibleNodes(sub, discPath);
        break;

      case 'especialidades': {
        const esps = def.especialidades && typeof def.especialidades === 'object'
          ? Object.entries(def.especialidades) : [];
        node.children = esps.map(([espId, espDef]) =>
          buildEspecialidadNode(espId, `${discPath}/${espId}`, espDef, esLab, sub)
        );
        break;
      }

      case 'fijas':
        node.children = normalizeToArray(def.subcarpetas, { label: `${disc}.subcarpetas` })
          .map(normalizeItem)
          .filter(sc => !!sc.nombre)
          .map(sc => {
            const n = makeNode(sc.nombre, `${discPath}/${sc.nombre}`, 'subcarpeta', !!sc.dinamica);
            if (sc.dinamica) { n.children = []; n.acceptsDynamic = true; }
            return n;
          });
        break;

      case 'directo':
        node.children = [];
        node.acceptsDynamic = !!def.dinamica;
        node.dynamic = !!def.dinamica;
        break;

      default:
        Logger.warn?.(`[structure-schema] Tipo desconocido en disciplina ${disc}: ${def.tipo}`);
    }
    root.push(node);
  }
  return root;
}

function buildEspecialidadNode(espId, basePath, espDef, esLab, sub) {
  const node = makeNode(espId, basePath, 'especialidad', false);
  if (!espDef || typeof espDef !== 'object') return node;

  // Caso eléctricos: normal | laboratorio
  if (espDef.normal && espDef.laboratorio) {
    const variantDef = esLab ? espDef.laboratorio : espDef.normal;
    if (variantDef?.tipo === 'subestructura_repetible') {
      node.children = buildSubestructuraRepetibleNodes(sub, basePath);
    } else if (variantDef?.tipo === 'carpetas_con_subestructura_repetible') {
      // REGLA VERDE v3: [01_General, 02_Laboratorios, 03_Auditorios] con subestructura repetible CADA UNO.
      node.children = normalizeToArray(variantDef.carpetas, { label: `${espId}.carpetas` })
        .map(normalizeItem)
        .filter(v => !!v.nombre)
        .map(v => {
          const vn = makeNode(v.nombre, `${basePath}/${v.nombre}`, 'subcarpeta_lab', false);
          vn.children = buildSubestructuraRepetibleNodes(sub, vn.path);
          return vn;
        });
    } else if (variantDef?.tipo === 'variantes_hoja') {
      // Compat con schema legacy v2 por si alguna copia queda.
      node.children = normalizeToArray(variantDef.variantes, { label: `${espId}.variantes` })
        .map(normalizeItem)
        .filter(v => !!v.nombre)
        .map(v => {
          const vn = makeNode(v.nombre, `${basePath}/${v.nombre}`, 'subcarpeta_lab', !!v.dinamica);
          if (v.dinamica) { vn.children = []; vn.acceptsDynamic = true; }
          return vn;
        });
    }
    return node;
  }

  // Caso genérico
  if (espDef.tipo === 'subestructura_repetible') {
    node.children = buildSubestructuraRepetibleNodes(sub, basePath);
  } else if (espDef.tipo === 'directo') {
    node.children = [];
    node.acceptsDynamic = !!espDef.dinamica;
    node.dynamic = !!espDef.dinamica;
  } else if (espDef.tipo === 'fijas') {
    node.children = normalizeToArray(espDef.subcarpetas, { label: `${espId}.subcarpetas` })
      .map(normalizeItem)
      .filter(sc => !!sc.nombre)
      .map(sc => {
        const n = makeNode(sc.nombre, `${basePath}/${sc.nombre}`, 'subcarpeta', !!sc.dinamica);
        if (sc.dinamica) { n.children = []; n.acceptsDynamic = true; }
        return n;
      });
  }
  return node;
}

/**
 * Construye nodos a partir de una definición de rol del nivel sede.
 * Acepta: carpetas_explicitas | subestructura_repetible | directo.
 */
function buildNivelSedeFromDef(def, basePath, sub) {
  if (!def || typeof def !== 'object') return [];

  if (def.tipo === 'directo') {
    return [];
  }

  if (def.tipo === 'subestructura_repetible') {
    return buildSubestructuraRepetibleNodes(sub, basePath);
  }

  if (def.tipo === 'carpetas_explicitas') {
    const carpetas = def.carpetas && typeof def.carpetas === 'object' ? def.carpetas : {};
    return Object.entries(carpetas).map(([name, childDef]) => {
      const childPath = `${basePath}/${name}`;
      const acceptsDyn = childDef?.tipo === 'directo' && !!childDef?.dinamica;
      const n = makeNode(name, childPath, 'subcarpeta_sede', acceptsDyn);
      if (acceptsDyn) n.acceptsDynamic = true;
      n.children = buildNivelSedeFromDef(childDef, childPath, sub);
      return n;
    });
  }

  return [];
}

/**
 * Árbol del nivel sede (v3).
 *   - Cada entrada en sede.nivelSede tiene { id, rol }
 *   - El rol referencia schema.nivelSedeRoles
 *   - 11_Historicos YA NO aparece aquí.
 */
export async function buildSedeLevelTree(sedeId) {
  const s = await loadSchema();
  const sede = s.sedes?.[sedeId];
  if (!sede) throw new Error(`Sede desconocida: ${sedeId}`);

  const roles = s.nivelSedeRoles && typeof s.nivelSedeRoles === 'object' ? s.nivelSedeRoles : {};
  const sub = await getSubestructuraRepetible();
  const folders = normalizeToArray(sede.nivelSede, { label: `sedes.${sedeId}.nivelSede` });
  const out = [];

  for (const rawFolder of folders) {
    let folderId = null;
    let rol = null;

    if (typeof rawFolder === 'string') {
      folderId = rawFolder;
    } else if (rawFolder && typeof rawFolder === 'object') {
      folderId = rawFolder.id || rawFolder.nombre || rawFolder.name;
      rol = rawFolder.rol || rawFolder.role || null;
    }
    if (!folderId) continue;

    // Compat: si algún schema legacy aún trae 11_Historicos en sede → lo ignoramos (regla v3).
    if (folderId === '11_Historicos') continue;

    const def = rol && roles[rol] ? roles[rol] : null;
    const acceptsDyn = def?.tipo === 'directo' && !!def?.dinamica;
    const node = makeNode(folderId, folderId, 'nivel_sede', acceptsDyn);
    if (acceptsDyn) node.acceptsDynamic = true;

    if (def) {
      node.children = buildNivelSedeFromDef(def, folderId, sub);
    } else {
      Logger.warn?.(`[structure-schema] Nivel sede sin rol en ${sedeId}: ${folderId}`);
      node.children = [];
    }
    out.push(node);
  }
  return out;
}

export async function buildSedeTree(sedeId) {
  const sede = await getSede(sedeId);
  const nivelSede = await buildSedeLevelTree(sedeId);
  const bloquesSchema = sede.bloques && typeof sede.bloques === 'object' ? sede.bloques : {};
  const bloqueIds = Array.isArray(bloquesSchema)
    ? bloquesSchema.map(b => (typeof b === 'string' ? b : b?.id || b?.nombre)).filter(Boolean)
    : Object.keys(bloquesSchema);
  const bloques = [];
  for (const bloqueId of bloqueIds) {
    const tree = await buildBloqueTree(sedeId, bloqueId);
    const esLab = await esBloqueConLaboratorio(bloqueId);
    bloques.push({
      name: bloqueId, nombre: bloqueId, path: bloqueId, kind: 'bloque',
      tipo: esLab ? 'laboratorio' : 'normal',
      dynamic: false,
      children: tree || [],
      subcarpetas: tree || [],
    });
  }
  attachSubcarpetasAlias(nivelSede);
  for (const b of bloques) attachSubcarpetasAlias(b.children);
  return {
    sedeId,
    nombre: sede?.nombreMostrar || sedeId,
    sede,
    nivelSede,
    bloques,
  };
}

/** Recursivamente añade el alias `subcarpetas` a cada nodo (apunta al mismo array). */
function attachSubcarpetasAlias(nodes) {
  for (const n of normalizeToArray(nodes)) {
    if (!n || typeof n !== 'object') continue;
    if (!Array.isArray(n.children)) n.children = normalizeToArray(n.children);
    n.subcarpetas = n.children;
    attachSubcarpetasAlias(n.children);
  }
}

/* ═══════════════ Búsqueda y helpers ═══════════════ */

export async function isDynamicFolder(sedeId, path) {
  const n = await findNodeInSede(sedeId, path);
  return !!n?.acceptsDynamic;
}

export async function findNodeInSede(sedeId, path) {
  const tree = await buildSedeTree(sedeId);
  return findNode(tree, path);
}

function findNode(tree, path) {
  const visit = (nodes) => {
    const arr = normalizeToArray(nodes);
    for (const n of arr) {
      if (!n) continue;
      if (n.path === path) return n;
      if (n.children && path.startsWith(n.path + '/')) {
        const f = visit(n.children);
        if (f) return f;
      }
    }
    return null;
  };
  return visit([...normalizeToArray(tree?.nivelSede), ...normalizeToArray(tree?.bloques)]);
}

export async function isValidPath(sedeId, path) {
  return !!(await findNodeInSede(sedeId, path));
}

/**
 * Siguiente número NN disponible.
 */
export function nextDynamicNumber(existingNames) {
  const used = new Set();
  for (const n of normalizeToArray(existingNames)) {
    const name = typeof n === 'string' ? n : (n?.nombre || '');
    const m = /^(\d{2})_/.exec(name);
    if (m) used.add(parseInt(m[1], 10));
  }
  let i = 1;
  while (used.has(i) && i < 100) i++;
  return String(i).padStart(2, '0');
}
