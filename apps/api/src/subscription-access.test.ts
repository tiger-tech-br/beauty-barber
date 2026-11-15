import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRestrictedMutation } from './subscription-policy.js';

test('alterações operacionais dependem de assinatura quando a regra for habilitada', () => {
  for (const path of ['/services', '/services/id', '/professionals/id', '/customers', '/calendar/blocks', '/calendar/appointments/id/status', '/finance/receipts', '/team/invitations']) {
    assert.equal(isRestrictedMutation('POST', path), true, path);
    assert.equal(isRestrictedMutation('PATCH', path), true, path);
    assert.equal(isRestrictedMutation('PUT', path), true, path);
    assert.equal(isRestrictedMutation('DELETE', path), true, path);
    assert.equal(isRestrictedMutation('GET', path), false, path);
  }
});

test('assinatura não bloqueia leitura, pagamento, acesso ou administração da plataforma', () => {
  for (const path of ['/billing', '/billing/verification', '/billing/checkout', '/platform/billing-requests', '/account/business', '/account/export', '/auth/logout', '/reports']) {
    assert.equal(isRestrictedMutation('POST', path), false, path);
    assert.equal(isRestrictedMutation('GET', path), false, path);
  }
  assert.equal(isRestrictedMutation('GET', '/calendar/mine'), false);
});
