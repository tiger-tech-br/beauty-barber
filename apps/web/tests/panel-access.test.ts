import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasAreaAccess, panelHome } from '../src/lib/panel-access.ts';

const platformAdmin = { isPlatformAdmin: true };
const businessUser = { isPlatformAdmin: false };

test('login direciona o administrador para a plataforma e o cliente para o estabelecimento', () => {
  assert.equal(panelHome(platformAdmin), '/plataforma/estabelecimentos');
  assert.equal(panelHome(businessUser), '/painel');
});

test('as áreas dos painéis ficam separadas por perfil', () => {
  assert.equal(hasAreaAccess(platformAdmin, '/painel'), false);
  assert.equal(hasAreaAccess(platformAdmin, '/painel/clientes'), false);
  assert.equal(hasAreaAccess(platformAdmin, '/plataforma/cobrancas'), true);
  assert.equal(hasAreaAccess(businessUser, '/painel/agenda'), true);
  assert.equal(hasAreaAccess(businessUser, '/plataforma/estabelecimentos'), false);
  assert.equal(hasAreaAccess(businessUser, '/plataforma/cobrancas'), false);
});
