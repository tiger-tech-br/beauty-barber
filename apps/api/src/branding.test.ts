import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_LOGO_BYTES, isValidPngLogo } from './logo-validation.js';

// PNG 1 × 1, válido para exercitar a validação da estrutura.
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l+pQAAAAASUVORK5CYII=', 'base64');

test('logotipo aceita PNG pequeno com chunks completos', () => {
  assert.equal(isValidPngLogo(pixel),true);
});

test('logotipo rejeita arquivo de outro tipo, truncado, enorme ou dimensões excessivas', () => {
  const fake = Buffer.from(pixel);
  fake[0] = 0;
  assert.equal(isValidPngLogo(fake),false);
  assert.equal(isValidPngLogo(pixel.subarray(0,-12)),false);
  assert.equal(isValidPngLogo(Buffer.alloc(MAX_LOGO_BYTES+1)),false);
  const hugeDimensions = Buffer.from(pixel);
  hugeDimensions.writeUInt32BE(2048,16);
  assert.equal(isValidPngLogo(hugeDimensions),false);
});

