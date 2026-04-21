#!/usr/bin/env node
/**
 * validate-staging-structure.js — Validación offline del schema v3.
 *
 * Checks:
 *   ✔ disciplinasBaseBloque contiene 11_Historicos
 *   ✔ 11_Historicos NO está en nivel sede (v3)
 *   ✔ 05_Varios dinámico en subestructura repetible
 *   ✔ Roles nivel sede presentes: general, proyecciones, varios
 *   ✔ general:
 *        - 01_Urbanistico / 02_Topografia con subestructura repetible
 *        - 03_Electricos con [01_Subestaciones, 02_Iluminacion_Zonas_Comunes, 03_SSFV_RE4KVA]
 *          cada uno con subestructura repetible
 *        - 04_Documentacion_General dinámico
 *        - NO contiene 05_Varios
 *   ✔ proyecciones: [01_Proyectos(dyn), 02_En_Construccion(dyn), 03_Archivos_en_Espera(dyn)]
 *   ✔ varios: directo dinámico (sin hijos)
 *   ✔ 05_Renders_y_Presentaciones: [01_Renders(dyn), 02_Presentaciones(dyn)] SIN subestructura interna
 *   ✔ Regla verde v3: laboratorio 01_Electricos = [01_General, 02_Laboratorios, 03_Auditorios]
 *     cada uno con subestructura repetible completa
 *   ✔ Bloques normales no tienen [01_General,02_Laboratorios,03_Auditorios] en 01_Electricos
 *   ✔ 08_Registro_Fotografico = [01_2025, 02_2026(dyn)]
 *   ✔ Nomenclatura NN_ en todos los segmentos
 *
 * Exit 0 = OK ; 1 = fallos.
 */
'use strict';

const path = require('path');
const fs = require('fs');

const RE_NN = /^[0-9]{2}_[A-Za-z0-9_]+$/;

function loadSchema() {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'shared', 'estructura-base.json'),
    'utf8'
  ));
}

function normalizeSub(list) {
  return (list || []).map(x => typeof x === 'string' ? { nombre: x, dinamica: false } : x);
}
function subRepNodes(sub, base) {
  return sub.map(sc => {
    const n = { name: sc.nombre, path: `${base}/${sc.nombre}`, dynamic: !!sc.dinamica, children: [] };
    if (sc.dinamica) n.acceptsDynamic = true;
    return n;
  });
}
function buildBloque(schema, bloqueId) {
  const esLab = (schema.bloquesConLaboratorio || []).includes(bloqueId);
  const sub = normalizeSub(schema.subestructuraRepetible);
  const defs = schema.disciplinaBloque;
  const out = [];
  for (const disc of schema.disciplinasBaseBloque) {
    const def = defs[disc]; if (!def) continue;
    const dpath = `${bloqueId}/${disc}`;
    const node = { name: disc, path: dpath, children: [] };
    if (def.tipo === 'subestructura_repetible') node.children = subRepNodes(sub, dpath);
    else if (def.tipo === 'especialidades') {
      for (const [espId, espDef] of Object.entries(def.especialidades)) {
        const epath = `${dpath}/${espId}`;
        const enode = { name: espId, path: epath, children: [] };
        if (espDef.normal && espDef.laboratorio) {
          const v = esLab ? espDef.laboratorio : espDef.normal;
          if (v.tipo === 'subestructura_repetible') enode.children = subRepNodes(sub, epath);
          else if (v.tipo === 'carpetas_con_subestructura_repetible') {
            enode.children = (v.carpetas || []).map(x => {
              const name = typeof x === 'string' ? x : x.nombre;
              const vn = { name, path: `${epath}/${name}`, children: [] };
              vn.children = subRepNodes(sub, vn.path);
              return vn;
            });
          }
          else if (v.tipo === 'variantes_hoja') {
            enode.children = (v.variantes || []).map(x => ({
              name: x.nombre, path: `${epath}/${x.nombre}`, dynamic: !!x.dinamica, children: [],
            }));
          }
        } else if (espDef.tipo === 'subestructura_repetible') enode.children = subRepNodes(sub, epath);
        else if (espDef.tipo === 'directo') { enode.dynamic = !!espDef.dinamica; if (espDef.dinamica) enode.acceptsDynamic = true; }
        else if (espDef.tipo === 'fijas') {
          enode.children = (espDef.subcarpetas || []).map(sc => {
            const n = { name: sc.nombre, path: `${epath}/${sc.nombre}`, dynamic: !!sc.dinamica, children: [] };
            if (sc.dinamica) n.acceptsDynamic = true;
            return n;
          });
        }
        node.children.push(enode);
      }
    } else if (def.tipo === 'fijas') {
      node.children = (def.subcarpetas || []).map(sc => {
        const n = { name: sc.nombre, path: `${dpath}/${sc.nombre}`, dynamic: !!sc.dinamica, children: [] };
        if (sc.dinamica) n.acceptsDynamic = true;
        return n;
      });
    } else if (def.tipo === 'directo') {
      node.dynamic = !!def.dinamica;
      if (def.dinamica) node.acceptsDynamic = true;
    }
    out.push(node);
  }
  return out;
}

function buildNivelSedeFromDef(def, basePath, sub) {
  if (!def || typeof def !== 'object') return [];
  if (def.tipo === 'directo') return [];
  if (def.tipo === 'subestructura_repetible') return subRepNodes(sub, basePath);
  if (def.tipo === 'carpetas_explicitas') {
    const carpetas = def.carpetas && typeof def.carpetas === 'object' ? def.carpetas : {};
    return Object.entries(carpetas).map(([name, childDef]) => {
      const childPath = `${basePath}/${name}`;
      const acceptsDyn = childDef?.tipo === 'directo' && !!childDef?.dinamica;
      const n = { name, path: childPath, dynamic: acceptsDyn, children: [] };
      if (acceptsDyn) n.acceptsDynamic = true;
      n.children = buildNivelSedeFromDef(childDef, childPath, sub);
      return n;
    });
  }
  return [];
}

function buildSedeLevel(schema, sede) {
  const roles = schema.nivelSedeRoles || {};
  const sub = normalizeSub(schema.subestructuraRepetible);
  const out = [];
  for (const raw of sede.nivelSede || []) {
    let folderId = null, rol = null;
    if (typeof raw === 'string') folderId = raw;
    else if (raw && typeof raw === 'object') { folderId = raw.id || raw.nombre; rol = raw.rol || null; }
    if (!folderId) continue;
    if (folderId === '11_Historicos') continue;
    const def = rol && roles[rol] ? roles[rol] : null;
    const acceptsDyn = def?.tipo === 'directo' && !!def?.dinamica;
    const n = { name: folderId, path: folderId, rol, dynamic: acceptsDyn, children: [] };
    if (acceptsDyn) n.acceptsDynamic = true;
    n.children = def ? buildNivelSedeFromDef(def, folderId, sub) : [];
    out.push(n);
  }
  return out;
}

function findChild(node, name)    { return (node.children || []).find(c => c.name === name); }
function findInBloque(tree, disc) { return tree.find(n => n.name === disc); }
function collectAllPaths(nodes, acc = []) {
  for (const n of nodes) {
    acc.push(n.path);
    if (n.children && n.children.length) collectAllPaths(n.children, acc);
  }
  return acc;
}

function run() {
  const schema = loadSchema();
  const issues = [];
  const info = [];
  const labList = schema.bloquesConLaboratorio || [];

  info.push(`Schema v${schema.version}`);
  info.push(`Sedes: ${Object.keys(schema.sedes || {}).join(', ')}`);
  info.push(`Bloques con laboratorio (regla verde): [${labList.join(', ')}]`);

  // 11_Historicos en disciplinas base
  if (!schema.disciplinasBaseBloque.includes('11_Historicos'))
    issues.push(`disciplinasBaseBloque no incluye 11_Historicos`);

  // 05_Varios dinámico en subestructura repetible
  const sub = normalizeSub(schema.subestructuraRepetible);
  const varios = sub.find(x => x.nombre === '05_Varios');
  if (!varios)               issues.push(`subestructuraRepetible no contiene 05_Varios`);
  else if (!varios.dinamica)  issues.push(`subestructuraRepetible.05_Varios NO es dinamica`);

  // Roles nivel sede presentes
  const roles = schema.nivelSedeRoles || {};
  for (const r of ['general','proyecciones','varios']) {
    if (!roles[r]) issues.push(`nivelSedeRoles.${r} faltante`);
  }

  // Rol general: estructura exacta
  const rg = roles.general;
  if (rg && rg.tipo === 'carpetas_explicitas') {
    const gKeys = Object.keys(rg.carpetas || {});
    const expected = ['01_Urbanistico','02_Topografia','03_Electricos','04_Documentacion_General'];
    if (gKeys.join(',') !== expected.join(','))
      issues.push(`rol.general carpetas ${gKeys.join(',')} != ${expected.join(',')}`);
    if (gKeys.includes('05_Varios'))
      issues.push(`rol.general NO debe contener 05_Varios`);
    const urb = rg.carpetas?.['01_Urbanistico'];
    const top = rg.carpetas?.['02_Topografia'];
    if (urb?.tipo !== 'subestructura_repetible') issues.push(`rol.general.01_Urbanistico debe ser subestructura_repetible`);
    if (top?.tipo !== 'subestructura_repetible') issues.push(`rol.general.02_Topografia debe ser subestructura_repetible`);
    const elec = rg.carpetas?.['03_Electricos'];
    if (!elec || elec.tipo !== 'carpetas_explicitas') issues.push(`rol.general.03_Electricos debe ser carpetas_explicitas`);
    else {
      const eKeys = Object.keys(elec.carpetas || {});
      const eExp = ['01_Subestaciones','02_Iluminacion_Zonas_Comunes','03_SSFV_RE4KVA'];
      if (eKeys.join(',') !== eExp.join(','))
        issues.push(`rol.general.03_Electricos carpetas ${eKeys.join(',')} != ${eExp.join(',')}`);
      for (const k of eKeys) {
        if (elec.carpetas[k]?.tipo !== 'subestructura_repetible')
          issues.push(`rol.general.03_Electricos.${k} debe ser subestructura_repetible`);
      }
    }
    const doc = rg.carpetas?.['04_Documentacion_General'];
    if (doc?.tipo !== 'directo' || !doc?.dinamica)
      issues.push(`rol.general.04_Documentacion_General debe ser directo dinámico`);
  } else issues.push(`rol.general tipo incorrecto`);

  // Rol proyecciones
  const rp = roles.proyecciones;
  if (rp && rp.tipo === 'carpetas_explicitas') {
    const pKeys = Object.keys(rp.carpetas || {});
    const pExp = ['01_Proyectos','02_En_Construccion','03_Archivos_en_Espera'];
    if (pKeys.join(',') !== pExp.join(','))
      issues.push(`rol.proyecciones carpetas ${pKeys.join(',')} != ${pExp.join(',')}`);
    for (const k of pKeys) {
      const c = rp.carpetas[k];
      if (c?.tipo !== 'directo' || !c?.dinamica)
        issues.push(`rol.proyecciones.${k} debe ser directo dinámico`);
    }
  } else issues.push(`rol.proyecciones tipo incorrecto`);

  // Rol varios
  const rv = roles.varios;
  if (!rv || rv.tipo !== 'directo' || !rv.dinamica)
    issues.push(`rol.varios debe ser directo dinámico`);

  // 05_Renders_y_Presentaciones: directo dinámico ambas
  const rr = schema.disciplinaBloque['05_Renders_y_Presentaciones'];
  if (!rr || rr.tipo !== 'especialidades') issues.push(`05_Renders_y_Presentaciones.tipo != especialidades`);
  else {
    for (const k of ['01_Renders','02_Presentaciones']) {
      const e = rr.especialidades?.[k];
      if (!e || e.tipo !== 'directo' || !e.dinamica)
        issues.push(`05_Renders_y_Presentaciones.${k} debe ser directo dinámico (sin subestructura)`);
    }
  }

  // 08_Registro_Fotografico
  const reg = schema.disciplinaBloque['08_Registro_Fotografico'];
  if (!reg || reg.tipo !== 'fijas') issues.push(`08_Registro_Fotografico.tipo != fijas`);
  else {
    const names = (reg.subcarpetas || []).map(x => x.nombre);
    if (names.join(',') !== '01_2025,02_2026') issues.push(`08_Registro_Fotografico ${names.join(',')} != 01_2025,02_2026`);
    const s26 = reg.subcarpetas.find(x => x.nombre === '02_2026');
    if (!s26?.dinamica) issues.push(`08_Registro_Fotografico.02_2026 NO es dinamica`);
    const s25 = reg.subcarpetas.find(x => x.nombre === '01_2025');
    if (s25?.dinamica) issues.push(`08_Registro_Fotografico.01_2025 NO debe ser dinamica`);
  }

  // Laboratorio 01_Electricos: [01_General,02_Laboratorios,03_Auditorios] c/u con subestructura
  const elecDef = schema.disciplinaBloque['03_Electricos_y_Red_de_Datos']?.especialidades?.['01_Electricos'];
  if (!elecDef?.laboratorio) issues.push(`01_Electricos sin variante laboratorio`);
  else {
    const lab = elecDef.laboratorio;
    if (lab.tipo !== 'carpetas_con_subestructura_repetible')
      issues.push(`01_Electricos.laboratorio.tipo debe ser carpetas_con_subestructura_repetible`);
    const ks = (lab.carpetas || []).map(x => typeof x === 'string' ? x : x.nombre);
    if (ks.join(',') !== '01_General,02_Laboratorios,03_Auditorios')
      issues.push(`01_Electricos.laboratorio.carpetas ${ks.join(',')} != 01_General,02_Laboratorios,03_Auditorios`);
  }

  // Validación por sede
  for (const [sedeId, sede] of Object.entries(schema.sedes || {})) {
    const nivel = buildSedeLevel(schema, sede);

    // 11_Historicos NO debe estar en nivel sede
    if (nivel.find(n => n.name === '11_Historicos'))
      issues.push(`[${sedeId}] nivelSede NO debe contener 11_Historicos (v3)`);

    // Verificar cada rol
    for (const folder of nivel) {
      const rol = folder.rol;
      if (rol === 'general') {
        const childNames = folder.children.map(c => c.name);
        const exp = ['01_Urbanistico','02_Topografia','03_Electricos','04_Documentacion_General'];
        if (childNames.join(',') !== exp.join(','))
          issues.push(`[${sedeId}] ${folder.name} (general) hijos ${childNames.join(',')} != ${exp.join(',')}`);
        // 03_Electricos con 3 subniveles
        const elec = findChild(folder, '03_Electricos');
        const eKeys = (elec?.children || []).map(c => c.name);
        const eExp = ['01_Subestaciones','02_Iluminacion_Zonas_Comunes','03_SSFV_RE4KVA'];
        if (eKeys.join(',') !== eExp.join(','))
          issues.push(`[${sedeId}] ${folder.name}/03_Electricos subniveles ${eKeys.join(',')} != ${eExp.join(',')}`);
        // 04_Documentacion_General dinámico
        const doc = findChild(folder, '04_Documentacion_General');
        if (!doc?.acceptsDynamic) issues.push(`[${sedeId}] ${folder.name}/04_Documentacion_General NO es dinamica`);
      } else if (rol === 'proyecciones') {
        const pKeys = folder.children.map(c => c.name);
        const pExp = ['01_Proyectos','02_En_Construccion','03_Archivos_en_Espera'];
        if (pKeys.join(',') !== pExp.join(','))
          issues.push(`[${sedeId}] ${folder.name} (proyecciones) hijos ${pKeys.join(',')} != ${pExp.join(',')}`);
        for (const c of folder.children) {
          if (!c.acceptsDynamic) issues.push(`[${sedeId}] ${folder.name}/${c.name} debe ser dinamica`);
        }
      } else if (rol === 'varios') {
        if (folder.children.length !== 0)
          issues.push(`[${sedeId}] ${folder.name} (varios) debe estar vacío, tiene ${folder.children.length}`);
        if (!folder.acceptsDynamic)
          issues.push(`[${sedeId}] ${folder.name} (varios) debe ser dinámico`);
      }
    }

    // Por cada bloque
    for (const bloqueId of Object.keys(sede.bloques || {})) {
      const tree = buildBloque(schema, bloqueId);
      const disc11 = findInBloque(tree, '11_Historicos');
      if (!disc11) issues.push(`[${sedeId}/${bloqueId}] falta disciplina 11_Historicos`);
      else if (!disc11.acceptsDynamic) issues.push(`[${sedeId}/${bloqueId}] 11_Historicos NO es dinamica`);

      // 05_Varios dinámico en 01/02
      for (const disc of ['01_Arquitectonico','02_Estructural']) {
        const d = findInBloque(tree, disc);
        const v = d && findChild(d, '05_Varios');
        if (!v || !v.dynamic) issues.push(`[${sedeId}/${bloqueId}/${disc}] 05_Varios no dinamica`);
      }

      const esLab = labList.includes(bloqueId);

      // 03 (03_Electricos_y_Red_de_Datos) y 04 (Hidrosanitarios) especialidades con 05_Varios
      for (const [disc, esps] of Object.entries({
        '03_Electricos_y_Red_de_Datos': ['01_Electricos','02_Redes_de_Datos'],
        '04_Hidrosanitarios_y_Gas':     ['01_Gas','02_Hidrosanitarios'],
      })) {
        const d = findInBloque(tree, disc); if (!d) continue;
        for (const esp of esps) {
          const e = findChild(d, esp); if (!e) continue;
          if (disc === '03_Electricos_y_Red_de_Datos' && esp === '01_Electricos' && esLab) {
            const names = (e.children || []).map(c => c.name);
            if (names.join(',') !== '01_General,02_Laboratorios,03_Auditorios')
              issues.push(`[${sedeId}/${bloqueId}] laboratorio: 01_Electricos esperaba [01_General,02_Laboratorios,03_Auditorios] → [${names.join(',')}]`);
            else {
              // Cada una debe tener subestructura repetible
              for (const leaf of e.children) {
                const v = findChild(leaf, '05_Varios');
                if (!v || !v.dynamic)
                  issues.push(`[${sedeId}/${bloqueId}] lab/${leaf.name}/05_Varios no dinamica (debe tener subestructura completa)`);
                if ((leaf.children || []).length !== 5)
                  issues.push(`[${sedeId}/${bloqueId}] lab/${leaf.name} debe tener 5 subcarpetas (tiene ${leaf.children?.length ?? 0})`);
              }
            }
            continue;
          }
          const v = findChild(e, '05_Varios');
          if (!v || !v.dynamic) issues.push(`[${sedeId}/${bloqueId}/${disc}/${esp}] 05_Varios no dinamica`);
        }
      }

      // 05_Renders_y_Presentaciones: [01_Renders,02_Presentaciones] SIN hijos
      const rDisc = findInBloque(tree, '05_Renders_y_Presentaciones');
      if (rDisc) {
        const rNames = rDisc.children.map(c => c.name);
        if (rNames.join(',') !== '01_Renders,02_Presentaciones')
          issues.push(`[${sedeId}/${bloqueId}] 05_Renders hijos ${rNames.join(',')} != 01_Renders,02_Presentaciones`);
        for (const c of rDisc.children) {
          if ((c.children || []).length > 0)
            issues.push(`[${sedeId}/${bloqueId}] 05_Renders/${c.name} NO debe tener hijos (directo dinámico)`);
          if (!c.acceptsDynamic)
            issues.push(`[${sedeId}/${bloqueId}] 05_Renders/${c.name} debe ser dinámico`);
        }
      }

      // Bloques NORMALES no deben tener [01_General,02_Laboratorios,03_Auditorios]
      if (!esLab) {
        const d = findInBloque(tree, '03_Electricos_y_Red_de_Datos');
        const e = d && findChild(d, '01_Electricos');
        const names = (e?.children || []).map(c => c.name);
        if (names.includes('01_General') && names.includes('02_Laboratorios') && names.includes('03_Auditorios')) {
          issues.push(`[${sedeId}/${bloqueId}] bloque NORMAL no debería tener regla verde en 01_Electricos`);
        }
      }
    }

    // Aislamiento de rutas: NN_ en cada segmento
    const allPaths = [...collectAllPaths(nivel)];
    for (const bloqueId of Object.keys(sede.bloques || {})) {
      allPaths.push(...collectAllPaths(buildBloque(schema, bloqueId)));
    }
    for (const p of allPaths) {
      for (const seg of p.split('/')) {
        if (seg && !RE_NN.test(seg)) issues.push(`[${sedeId}] segmento fuera de NN_: ${seg} (en ${p})`);
      }
    }
  }

  return { schema, labList, issues, info };
}

(function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Validación offline estructura staging (schema v3)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const { issues, info } = run();
  for (const l of info) console.log(` · ${l}`);
  console.log('');
  if (issues.length === 0) {
    console.log('[OK] Validación superada: ningún issue detectado.');
    console.log('     - Nivel sede por roles (general/proyecciones/varios).');
    console.log('     - 11_Historicos ausente del nivel sede.');
    console.log('     - Regla verde con subestructura repetible en cada variante.');
    console.log('     - Renders directos dinámicos sin subestructura.');
    console.log('     - Nomenclatura NN_ respetada.');
    process.exit(0);
  } else {
    console.error('[FAIL] Issues detectados:');
    for (const i of issues) console.error(`   - ${i}`);
    process.exit(1);
  }
})();
