import assert from 'node:assert/strict';
import { test } from 'node:test';
import { businessLocalToUtcIso, formatInZone, monthBoundsInZone, shiftCalendarDate, shiftMonth, todayInZone } from '../src/lib/dates.ts';

test('a data atual segue o fuso do estabelecimento, inclusive na virada do dia', () => {
  const instant = new Date('2026-11-16T02:30:00.000Z');
  assert.equal(todayInZone('America/Sao_Paulo', instant), '2026-11-15');
  assert.equal(todayInZone('UTC', instant), '2026-11-16');
});

test('formulário de folga interpreta o horário local da empresa e não do navegador', () => {
  assert.equal(businessLocalToUtcIso('2026-11-15T09:30', 'America/Sao_Paulo'), '2026-11-15T12:30:00Z');
  assert.equal(businessLocalToUtcIso('2026-11-15T09:30', 'America/Manaus'), '2026-11-15T13:30:00Z');
});

test('horários de verão inexistentes ou datas inválidas não são aceitos', () => {
  assert.equal(businessLocalToUtcIso('2026-03-08T02:30', 'America/New_York'), null);
  assert.equal(businessLocalToUtcIso('2026-02-30T09:00', 'America/Sao_Paulo'), null);
  assert.equal(businessLocalToUtcIso('valor-incorreto', 'America/Sao_Paulo'), null);
});

test('rótulos exibem o horário do salão sem depender da máquina do usuário', () => {
  assert.match(formatInZone('2026-11-15T12:30:00Z', 'America/Sao_Paulo'), /09:30/);
  assert.match(formatInZone('2026-11-15T12:30:00Z', 'America/Manaus'), /08:30/);
});

test('período mensal considera o calendário da empresa e os anos bissextos', () => {
  const reference = new Date('2024-03-01T02:00:00Z');
  assert.deepEqual(monthBoundsInZone('America/Sao_Paulo', reference), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(monthBoundsInZone('UTC', reference), { from: '2024-03-01', to: '2024-03-31' });
});

test('agenda não volta a dias ou meses passados, mas permite consultar meses futuros', () => {
  const today = '2026-11-15';
  assert.equal(shiftCalendarDate(today, 'day', -1, today), today);
  assert.equal(shiftCalendarDate(today, 'week', -1, today), today);
  assert.equal(shiftCalendarDate(today, 'month', -1, today), today);
  assert.equal(shiftCalendarDate('2026-12-01', 'month', -1, today), today);
  assert.equal(shiftCalendarDate('2026-12-01', 'month', 1, today), '2027-01-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});
