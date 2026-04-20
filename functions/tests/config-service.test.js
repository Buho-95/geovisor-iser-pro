'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { getNormativeConfig, clearNormativeCache, validateNormativeSchema } = require('../configService.js');

describe('configService', () => {
  beforeEach(() => {
    clearNormativeCache();
  });

  it('carga y valida normative-config.json', () => {
    const cfg = getNormativeConfig();
    assert.ok(cfg.keywords['NSR-10']);
    assert.strictEqual(typeof cfg.thresholds.semaforoVerde, 'number');
  });

  it('validateNormativeSchema rechaza objeto vacío', () => {
    assert.throws(() => validateNormativeSchema({}), /keywords/);
  });
});
