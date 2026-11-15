import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beautyBarberDatabaseName } from './database-policy.js';

test('a API nunca utiliza o banco PetCore por engano', () => {
  for (const name of ['petcore', 'petcore_test', 'postgres', 'beautybarber_test_extra', '']) {
    assert.throws(() => beautyBarberDatabaseName(`postgresql://app:senha@localhost:5432/${name}`,false), /BLOQUEADO/);
  }
});

test('em produção aceita somente o banco BeautyBarber', () => {
  assert.equal(beautyBarberDatabaseName('postgresql://bb:senha@db:5432/beautybarber',true),'beautybarber');
  assert.throws(()=>beautyBarberDatabaseName('postgresql://bb:senha@db:5432/beautybarber_test',true),/BLOQUEADO/);
  assert.equal(beautyBarberDatabaseName('postgres://bb:senha@localhost:5432/beautybarber_test',false),'beautybarber_test');
  assert.throws(()=>beautyBarberDatabaseName('https://example.com/beautybarber',false),/PostgreSQL/);
});
