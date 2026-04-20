'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { computeInventoryFingerprint } = require('../inventoryHash.js');

describe('inventoryHash', () => {
  it('genera huella estable según nombres y updated', () => {
    const inv = {
      totalArchivos: 2,
      archivos: [
        { nombre: 'b.pdf', updated: 't2' },
        { nombre: 'a.pdf', updated: 't1' },
      ],
    };
    const fp = computeInventoryFingerprint(inv);
    assert.strictEqual(fp, '2:a.pdf@t1|b.pdf@t2');
  });
});
