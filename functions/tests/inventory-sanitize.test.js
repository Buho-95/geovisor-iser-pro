'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { redactInventarioForAnonymous } = require('../inventorySanitize');

describe('inventorySanitize', () => {
  it('omite rutas internas y conserva nombre/url para visor', () => {
    const inv = {
      blockId: 'B1',
      basePath: 'documentos_iser/B1',
      archivos: [
        {
          id: 'documentos_iser/B1/x.pdf',
          nombre: 'x.pdf',
          carpeta: 'raíz',
          url: 'https://example.com/token',
          rutaCompleta: 'documentos_iser/B1/x.pdf',
          storagePath: 'documentos_iser/B1/x.pdf',
        },
      ],
      totalArchivos: 1,
    };
    const out = redactInventarioForAnonymous(inv);
    assert.strictEqual(out.basePath, undefined);
    assert.strictEqual(out.archivos[0].rutaCompleta, undefined);
    assert.strictEqual(out.archivos[0].storagePath, undefined);
    assert.strictEqual(out.archivos[0].url, 'https://example.com/token');
    assert.strictEqual(out.archivos[0].nombre, 'x.pdf');
    assert.ok(String(out.archivos[0].id).startsWith('anon-0-'));
  });
});
