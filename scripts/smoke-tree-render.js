#!/usr/bin/env node
/**
 * smoke-tree-render.js — Simula en Node lo que el frontend construye vía buildSedeTree(),
 * usando el schema v3. Verifica que no se pierdan nodos y que las reglas críticas se cumplan.
 */
'use strict';

const path = require('path');
const fs = require('fs');

const RE_NN = /^[0-9]{2}_[A-Za-z0-9_]+$/;

const schema = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'shared', 'estructura-base.json'), 'utf8'
));

const normalize = v => {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') return Object.values(v);
  return [];
};
const normItem = x =>
  typeof x === 'string' ? { nombre: x, dinamica: false } :
  (x && typeof x === 'object' ? { nombre: x.nombre || x.name || '', dinamica: !!x.dinamica } : { nombre: '', dinamica: false });

const sub = normalize(schema.subestructuraRepetible).map(normItem);
const lab = normalize(schema.bloquesConLaboratorio);
const roles = schema.nivelSedeRoles || {};

function subRep(base) { return sub.map(x => ({ name: x.nombre, path: `${base}/${x.nombre}`, dinamica: x.dinamica, children: [] })); }

function buildNivelSedeFromDef(def, basePath) {
  if (!def || typeof def !== 'object') return [];
  if (def.tipo === 'directo') return [];
  if (def.tipo === 'subestructura_repetible') return subRep(basePath);
  if (def.tipo === 'carpetas_explicitas') {
    return Object.entries(def.carpetas || {}).map(([name, childDef]) => {
      const childPath = `${basePath}/${name}`;
      const n = { name, path: childPath, dinamica: childDef?.tipo === 'directo' && !!childDef?.dinamica, children: [] };
      n.children = buildNivelSedeFromDef(childDef, childPath);
      return n;
    });
  }
  return [];
}

function buildBloque(bloqueId) {
  const esLab = lab.includes(bloqueId);
  const out = [];
  for (const disc of normalize(schema.disciplinasBaseBloque)) {
    const def = schema.disciplinaBloque[disc]; if (!def) continue;
    const node = { name: disc, path: `${bloqueId}/${disc}`, children: [] };
    if (def.tipo === 'subestructura_repetible') node.children = subRep(node.path);
    else if (def.tipo === 'especialidades') {
      for (const [espId, espDef] of Object.entries(def.especialidades || {})) {
        const e = { name: espId, path: `${node.path}/${espId}`, children: [] };
        if (espDef.normal && espDef.laboratorio) {
          const v = esLab ? espDef.laboratorio : espDef.normal;
          if (v.tipo === 'subestructura_repetible') e.children = subRep(e.path);
          else if (v.tipo === 'carpetas_con_subestructura_repetible') {
            e.children = normalize(v.carpetas).map(x => {
              const name = typeof x === 'string' ? x : x.nombre;
              const leaf = { name, path: `${e.path}/${name}`, children: [] };
              leaf.children = subRep(leaf.path);
              return leaf;
            });
          }
          else if (v.tipo === 'variantes_hoja') e.children = normalize(v.variantes).map(normItem).map(x => ({ name: x.nombre, path: `${e.path}/${x.nombre}`, dinamica: x.dinamica, children: [] }));
        } else if (espDef.tipo === 'subestructura_repetible') e.children = subRep(e.path);
        else if (espDef.tipo === 'directo') { e.dinamica = !!espDef.dinamica; }
        else if (espDef.tipo === 'fijas') e.children = normalize(espDef.subcarpetas).map(normItem).map(x => ({ name: x.nombre, path: `${e.path}/${x.nombre}`, dinamica: x.dinamica, children: [] }));
        node.children.push(e);
      }
    } else if (def.tipo === 'fijas') {
      node.children = normalize(def.subcarpetas).map(normItem).map(x => ({ name: x.nombre, path: `${node.path}/${x.nombre}`, dinamica: x.dinamica, children: [] }));
    } else if (def.tipo === 'directo') {
      node.dinamica = !!def.dinamica;
    }
    out.push(node);
  }
  return out;
}

function buildSedeLevel(sede) {
  const out = [];
  for (const raw of normalize(sede.nivelSede)) {
    let id = null, rol = null;
    if (typeof raw === 'string') id = raw;
    else if (raw && typeof raw === 'object') { id = raw.id || raw.nombre; rol = raw.rol || null; }
    if (!id) continue;
    if (id === '11_Historicos') continue; // v3
    const def = rol && roles[rol] ? roles[rol] : null;
    const acceptsDyn = def?.tipo === 'directo' && !!def?.dinamica;
    const n = { name: id, path: id, rol, dinamica: acceptsDyn, children: [] };
    n.children = def ? buildNivelSedeFromDef(def, id) : [];
    out.push(n);
  }
  return out;
}

function countNodes(nodes) {
  let c = 0;
  for (const n of normalize(nodes)) { c += 1 + countNodes(n.children); }
  return c;
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' Smoke render: árbol por sede v3 (sin Firebase)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

let ok = true;
for (const [sedeId, sede] of Object.entries(schema.sedes)) {
  const nivel = buildSedeLevel(sede);
  const bloqueIds = Object.keys(sede.bloques || {});
  const bloques = bloqueIds.map(id => ({
    name: id, path: id, tipo: lab.includes(id) ? 'laboratorio' : 'normal',
    children: buildBloque(id),
  }));
  const nodosNivelSede = countNodes(nivel);
  const nodosBloques   = countNodes(bloques);
  console.log('');
  console.log(` ── ${sedeId} ─────────────────────────────`);
  console.log(`    Nivel sede (morado): ${nivel.length} carpeta(s), ${nodosNivelSede} nodos totales`);
  console.log(`    Bloques:             ${bloques.length} bloque(s)  | LAB: ${bloques.filter(b=>b.tipo==='laboratorio').map(b=>b.name).join(', ') || '(ninguno)'}`);
  console.log(`    Nodos bloques:       ${nodosBloques}`);

  // 11_Historicos NO debe aparecer en nivel sede
  if (nivel.find(n => n.name === '11_Historicos')) {
    console.log('    ✗ 11_Historicos NO debe aparecer en nivel sede');
    ok = false;
  }

  // Inspección por rol
  for (const f of nivel) {
    const mark = (c) => c ? '\u2713' : '\u2717';
    if (f.rol === 'general') {
      const chNames = f.children.map(c => c.name).join(',');
      const exp = '01_Urbanistico,02_Topografia,03_Electricos,04_Documentacion_General';
      const okG = chNames === exp;
      if (!okG) ok = false;
      console.log(`      · ${f.name.padEnd(45)} rol:general  ${mark(okG)} ${chNames}`);
      // 03_Electricos subniveles
      const elec = f.children.find(c => c.name === '03_Electricos');
      const eKeys = (elec?.children || []).map(c => c.name).join(',');
      const eExp = '01_Subestaciones,02_Iluminacion_Zonas_Comunes,03_SSFV_RE4KVA';
      const okE = eKeys === eExp;
      if (!okE) ok = false;
      console.log(`         └ 03_Electricos: ${mark(okE)} ${eKeys}`);
    } else if (f.rol === 'proyecciones') {
      const chNames = f.children.map(c => c.name).join(',');
      const exp = '01_Proyectos,02_En_Construccion,03_Archivos_en_Espera';
      const okP = chNames === exp;
      if (!okP) ok = false;
      console.log(`      · ${f.name.padEnd(45)} rol:proyecciones  ${mark(okP)} ${chNames}`);
    } else if (f.rol === 'varios') {
      const okV = f.children.length === 0 && !!f.dinamica;
      if (!okV) ok = false;
      console.log(`      · ${f.name.padEnd(45)} rol:varios  ${mark(okV)} (sin hijos, dinámico)`);
    } else {
      console.log(`      · ${f.name} rol:(?) hijos:${f.children.length}`);
    }
  }

  // Bloques: disciplinas críticas
  for (const b of bloques) {
    const discs = b.children.map(c => c.name);
    const tieneHist = discs.includes('11_Historicos');
    const tieneReg  = discs.includes('08_Registro_Fotografico');
    const reg = b.children.find(c => c.name === '08_Registro_Fotografico');
    const regChildren = reg ? reg.children.map(c => c.name).join(',') : '';

    const renders = b.children.find(c => c.name === '05_Renders_y_Presentaciones');
    const rNames = renders ? renders.children.map(c => c.name).join(',') : '';
    const rOk = rNames === '01_Renders,02_Presentaciones'
      && renders.children.every(c => (c.children || []).length === 0);

    // Validación regla verde
    let labOk = true;
    if (b.tipo === 'laboratorio') {
      const d = b.children.find(c => c.name === '03_Electricos_y_Red_de_Datos');
      const el = d && d.children.find(c => c.name === '01_Electricos');
      const names = (el?.children || []).map(c => c.name).join(',');
      if (names !== '01_General,02_Laboratorios,03_Auditorios') labOk = false;
      else labOk = el.children.every(leaf => (leaf.children || []).length === 5);
    }

    const mark = (c) => c ? '\u2713' : '\u2717';
    if (!tieneHist || !tieneReg || !rOk || !labOk) ok = false;
    console.log(`      · ${b.name.padEnd(45)} ${b.tipo.padEnd(12)} ${mark(tieneHist)}11H ${mark(tieneReg)}08R[${regChildren}] ${mark(rOk)}Renders ${b.tipo==='laboratorio'?mark(labOk)+'LAB':''}`);
    for (const d of discs) if (!RE_NN.test(d)) { console.log(`        !! nombre fuera de NN_: ${d}`); ok = false; }
  }
}

console.log('');
console.log(ok ? '[OK] Árbol v3 consistente en todas las sedes.' : '[FAIL] Hay inconsistencias en el árbol.');
process.exit(ok ? 0 : 1);
