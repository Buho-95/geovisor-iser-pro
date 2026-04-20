#!/usr/bin/env node
/**
 * Sincroniza la fuente de verdad de normativa (frontend) hacia functions/
 * para que el paquete desplegado incluya normative-config.json.
 *
 * Uso: node scripts/sync-config.js
 *      npm run sync-config
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'frontend', 'shared', 'normative-config.json');
const dest = path.join(root, 'functions', 'normative-config.json');

if (!fs.existsSync(src)) {
  console.error('[sync-config] ERROR: no existe el archivo origen:', src);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);

const st = fs.statSync(dest);
console.log('[sync-config] OK:', path.relative(root, src), '→', path.relative(root, dest), `(${st.size} bytes)`);
