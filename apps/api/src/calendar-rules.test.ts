import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { appointmentFitsPeriods, canChangeStatus, establishmentHoursForDate,
  generateSlots, intersectWeeklyPeriods, validBookingDate } from './calendar-rules.js';

const baseInput = {
  date: '2026-11-16',
  zone: 'America/Sao_Paulo',
  durationMinutes: 60,
  periods: [{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 780, endMinute: 1080 }],
  appointments: [],
  blocks: [],
  nowMillis: DateTime.fromISO('2026-11-15T00:00:00', { zone: 'America/Sao_Paulo' }).toMillis()
};

test('disponibilidade respeita expediente e intervalo de almoço', () => {
  const slots = generateSlots(baseInput);
  assert.equal(slots.some((item) => item.time === '09:00'), true);
  assert.equal(slots.some((item) => item.time === '11:00'), true);
  assert.equal(slots.some((item) => item.time === '11:15'), false);
  assert.equal(slots.some((item) => item.time === '12:00'), false);
  assert.equal(slots.some((item) => item.time === '13:00'), true);
  assert.equal(slots.some((item) => item.time === '17:15'), false);
});

test('agendamentos e bloqueios impedem sobreposição, inclusive parcial', () => {
  const slots = generateSlots({ ...baseInput,
    appointments: [{ startsAt: '2026-11-16T10:00:00-03:00', endsAt: '2026-11-16T11:00:00-03:00' }],
    blocks: [{ startsAt: '2026-11-16T14:00:00-03:00', endsAt: '2026-11-16T15:00:00-03:00' }]
  });
  assert.equal(slots.some((item) => item.time === '09:15'), false);
  assert.equal(slots.some((item) => item.time === '10:00'), false);
  assert.equal(slots.some((item) => item.time === '11:00'), true);
  assert.equal(slots.some((item) => item.time === '13:15'), false);
  assert.equal(slots.some((item) => item.time === '15:00'), true);
});

test('horários gerados usam o fuso do estabelecimento', () => {
  const slots = generateSlots(baseInput);
  assert.equal(slots[0]?.time, '09:00');
  assert.equal(slots[0]?.startsAt, '2026-11-16T12:00:00.000Z');
});

test('domingo é opcional: fechado sem expediente e aberto quando configurado', () => {
  const sunday = { ...baseInput, date: '2026-11-22' };
  assert.deepEqual(generateSlots(sunday), []);
  const withSunday = generateSlots({ ...sunday, periods: [...baseInput.periods,
    { weekday: 0, startMinute: 600, endMinute: 720 }] });
  assert.equal(withSunday[0]?.time, '10:00');
  assert.equal(withSunday.some((slot) => slot.time === '12:00'), false);
});

test('agendamento depende da interseção entre expediente do salão e do profissional', () => {
  const shifts = [{ weekday: 1, startMinute: 540, endMinute: 1080 }];
  assert.deepEqual(intersectWeeklyPeriods(shifts, []), [], 'Sem horário da empresa, não há vagas.');
  const effective = intersectWeeklyPeriods(shifts, [
    { weekday: 1, startMinute: 600, endMinute: 720 },
    { weekday: 1, startMinute: 780, endMinute: 1020 }
  ]);
  assert.deepEqual(effective, [
    { weekday: 1, startMinute: 600, endMinute: 720 },
    { weekday: 1, startMinute: 780, endMinute: 1020 }
  ]);
  assert.equal(generateSlots({ ...baseInput, periods: effective })[0]?.time, '10:00');
  assert.deepEqual(intersectWeeklyPeriods(shifts, [{weekday:0,startMinute:540,endMinute:1080}]), []);
});

test('exceções pontuais substituem somente o funcionamento da data escolhida', () => {
  const normal = [{weekday:1,startMinute:540,endMinute:1080}];
  assert.deepEqual(establishmentHoursForDate('2026-11-16','America/Sao_Paulo',normal), normal);
  assert.deepEqual(establishmentHoursForDate('2026-11-16','America/Sao_Paulo',normal,
    {closed:true,periods:[]}), []);
  const earlyClose = establishmentHoursForDate('2026-11-16','America/Sao_Paulo',normal,
    {closed:false,periods:[{startMinute:480,endMinute:960}]});
  assert.deepEqual(earlyClose,[{weekday:1,startMinute:480,endMinute:960}]);
  assert.deepEqual(establishmentHoursForDate('2026-11-17','America/Sao_Paulo',normal),[]);
});

test('fechar domingo exige remarcar agendamentos futuros que sairiam do expediente', () => {
  const start = '2026-11-22T13:00:00Z';
  const end = '2026-11-22T14:00:00Z';
  assert.equal(appointmentFitsPeriods(start, end, 'America/Sao_Paulo', baseInput.periods), false);
  assert.equal(appointmentFitsPeriods(start, end, 'America/Sao_Paulo', [
    ...baseInput.periods, { weekday: 0, startMinute: 540, endMinute: 720 }
  ]), true);
  assert.equal(appointmentFitsPeriods(start, end, 'America/Sao_Paulo', [
    { weekday: 0, startMinute: 600, endMinute: 630 }
  ]), false);
});

test('data deve ser válida e limitar reservas aos próximos 90 dias', () => {
  const now = DateTime.fromISO('2026-11-15T12:00:00', { zone: 'America/Sao_Paulo' });
  assert.equal(validBookingDate('2026-11-16', 'America/Sao_Paulo', now), true);
  assert.equal(validBookingDate('2026-11-14', 'America/Sao_Paulo', now), false);
  assert.equal(validBookingDate('2027-06-01', 'America/Sao_Paulo', now), false);
  assert.equal(validBookingDate('2026-02-30', 'America/Sao_Paulo', now), false);
});

test('status não permite voltar de concluído para confirmado', () => {
  assert.equal(canChangeStatus('pending', 'confirmed'), true);
  assert.equal(canChangeStatus('confirmed', 'in_progress'), true);
  assert.equal(canChangeStatus('in_progress', 'completed'), true);
  assert.equal(canChangeStatus('completed', 'confirmed'), false);
});

