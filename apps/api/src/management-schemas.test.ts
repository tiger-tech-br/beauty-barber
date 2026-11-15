import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customerSchema, professionalSchema, serviceSchema, workingHoursSchema } from './management-schemas.js';

test('serviços não aceitam duração ou preço inválidos', () => {
  const valid = { name: 'Corte', category: 'cabelo', durationMinutes: 45, priceCents: 4500 };
  assert.equal(serviceSchema.safeParse(valid).success, true);
  assert.equal(serviceSchema.safeParse({ ...valid, durationMinutes: 0 }).success, false);
  assert.equal(serviceSchema.safeParse({ ...valid, priceCents: -5 }).success, false);
  assert.equal(serviceSchema.safeParse({ ...valid, establishmentId: 'outro' }).success, false);
});

test('IDs de serviços vinculados ao profissional não podem se repetir', () => {
  const id = '18e81936-1f1f-4e44-9111-111111111111';
  const input = { fullName: 'Joana Souza', serviceIds: [id, id] };
  assert.equal(professionalSchema.safeParse(input).success, false);
});

test('um cliente não exige dados pessoais além do nome', () => {
  assert.equal(customerSchema.safeParse({ fullName: 'Ana Pereira' }).success, true);
});

test('expediente impede sobreposição e permite turnos separados', () => {
  const periods = [{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 780, endMinute: 1080 }];
  assert.equal(workingHoursSchema.safeParse({ periods }).success, true);
  assert.equal(workingHoursSchema.safeParse({ periods: [...periods, { weekday: 1, startMinute: 700, endMinute: 800 }] }).success, false);
});

