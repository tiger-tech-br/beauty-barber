import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword, newSlug, newSessionToken, sessionTokenHash } from './security.js';

test('senha armazenada como hash e verificação segura', async () => {
  const hashed = await hashPassword('minha senha longa 2026');
  assert.ok(!hashed.includes('minha senha'));
  assert.equal(await verifyPassword('minha senha longa 2026', hashed), true);
  assert.equal(await verifyPassword('senha errada', hashed), false);
  assert.equal(await verifyPassword('x', 'formato-invalido'), false);
});

test('slug previsível sem acentos e com sufixo exclusivo', () => {
  assert.equal(newSlug('Salão & Beleza', 'a12bc3'), 'salao-beleza-a12bc3');
});

test('token não é igual à representação persistida no banco', () => {
  const token = newSessionToken();
  assert.notEqual(token, sessionTokenHash(token));
  assert.equal(sessionTokenHash(token).length, 64);
});

