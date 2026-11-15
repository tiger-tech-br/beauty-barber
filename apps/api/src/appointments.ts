import { Router, type Response } from 'express';
import { DateTime } from 'luxon';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db.js';
import { canChangeStatus, establishmentHoursForDate, generateSlots, intersectWeeklyPeriods, validBookingDate,
  type AppointmentStatus, type SpecialHours } from './calendar-rules.js';

type Context = { establishmentId: string; userId: string; role: 'owner' | 'receptionist' | 'professional' };
const uuid = z.uuid();
const bookingSchema = z.object({
  serviceId: uuid, professionalId: uuid, customerId: uuid,
  startsAt: z.iso.datetime({ offset: true }), notes: z.string().trim().max(500).optional().default('')
}).strict();
const statusSchema = z.object({ status: z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']) }).strict();
const rescheduleSchema = z.object({ professionalId: uuid, startsAt: z.iso.datetime({ offset: true }) }).strict();
const blockSchema = z.object({
  professionalId: uuid, startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }), reason: z.string().trim().max(160).optional().default('')
}).strict();

export const calendarRouter = Router();

calendarRouter.use((req, res, next) => {
  if (!req.path.startsWith('/calendar')) return next();
  const context = res.locals.auth as Context;
  if (req.path === '/calendar/mine' && req.method === 'GET') return next();
  if (context.role !== 'owner' && context.role !== 'receptionist') {
    res.status(403).json({ error: 'Somente a administração ou recepção pode gerenciar a agenda.' });
    return;
  }
  next();
});

calendarRouter.get('/calendar/mine', async (req, res) => {
  const context = ctx(res);
  if (context.role !== 'professional') { res.status(403).json({ error: 'Agenda pessoal reservada ao perfil profissional.' }); return; }
  const dates = z.object({ start: z.iso.date(), end: z.iso.date() }).safeParse(req.query);
  if (!dates.success) { res.status(400).json({ error: 'Informe o início e o fim do período.' }); return; }
  const professional = await pool.query<{ id: string; full_name: string; timezone: string }>(`
    SELECT p.id,p.full_name,e.timezone FROM professionals p
    JOIN establishments e ON e.id=p.establishment_id
    WHERE p.establishment_id=$1 AND p.user_id=$2 AND p.active=true LIMIT 1
  `, [context.establishmentId, context.userId]);
  if (!professional.rowCount) { res.json({ linked: false, items: [] }); return; }
  const { id, full_name, timezone } = professional.rows[0]!;
  const from = DateTime.fromISO(dates.data.start, { zone: timezone }).startOf('day');
  const until = DateTime.fromISO(dates.data.end, { zone: timezone }).startOf('day');
  if (!from.isValid || !until.isValid || until <= from || until.diff(from, 'days').days > 36) {
    res.status(400).json({ error: 'Consulte um período de até 36 dias.' }); return;
  }
  const appointments = await pool.query(`
    SELECT a.id,a.starts_at AS "startsAt",a.ends_at AS "endsAt",a.status,
      s.name AS "serviceName",c.full_name AS "customerName"
    FROM appointments a
    JOIN services s ON s.establishment_id=a.establishment_id AND s.id=a.service_id
    JOIN customers c ON c.establishment_id=a.establishment_id AND c.id=a.customer_id
    WHERE a.establishment_id=$1 AND a.professional_id=$2 AND a.starts_at<$3 AND a.ends_at>$4
    ORDER BY a.starts_at ASC LIMIT 1000
  `, [context.establishmentId,id,until.toJSDate(),from.toJSDate()]);
  res.json({ linked: true, professionalName: full_name, zone: timezone, items: appointments.rows });
});

export type Availability = {
  professionalId: string; professionalName: string;
  slots: ReturnType<typeof generateSlots>;
};

export async function availableForService(
  db: PoolClient | typeof pool,
  establishmentId: string,
  serviceId: string,
  date: string,
  professionalId?: string,
  excludeAppointmentId?: string
): Promise<{ zone: string; durationMinutes: number; priceCents: number; items: Availability[] } | null> {
  const result = await db.query<{ timezone: string; duration_minutes: number; price_cents: number }>(`
    SELECT e.timezone, s.duration_minutes, s.price_cents
    FROM services s JOIN establishments e ON e.id=s.establishment_id
    WHERE s.establishment_id=$1 AND s.id=$2 AND s.active=true AND e.active=true
  `, [establishmentId, serviceId]);
  const service = result.rows[0];
  if (!service) return null;
  if (!validBookingDate(date, service.timezone)) return { zone: service.timezone, durationMinutes: service.duration_minutes, priceCents: service.price_cents, items: [] };

  const [businessHours, specialHours] = await Promise.all([
    db.query<{ weekday: number; startMinute: number; endMinute: number }>(`
      SELECT weekday,start_minute AS "startMinute",end_minute AS "endMinute"
      FROM establishment_hours WHERE establishment_id=$1
    `, [establishmentId]),
    db.query<SpecialHours>(`
      SELECT closed,periods FROM establishment_special_hours WHERE establishment_id=$1 AND day=$2::date
    `, [establishmentId,date])
  ]);
  const businessPeriods = establishmentHoursForDate(date,service.timezone,businessHours.rows,specialHours.rows[0]);

  const dayStart = DateTime.fromISO(date, { zone: service.timezone }).startOf('day');
  const dayEnd = dayStart.plus({ days: 1 });
  const professionals = await db.query<{ id: string; full_name: string }>(`
    SELECT p.id,p.full_name FROM professionals p
    JOIN professional_services ps ON ps.establishment_id=p.establishment_id AND ps.professional_id=p.id
    WHERE p.establishment_id=$1 AND ps.service_id=$2 AND p.active=true AND ($3::uuid IS NULL OR p.id=$3)
    ORDER BY p.full_name
  `, [establishmentId, serviceId, professionalId ?? null]);
  const items: Availability[] = [];
  for (const professional of professionals.rows) {
    const [periods, reservations, blocks] = await Promise.all([
      db.query<{ weekday: number; startMinute: number; endMinute: number }>(`
        SELECT weekday, start_minute AS "startMinute", end_minute AS "endMinute"
        FROM working_hours WHERE establishment_id=$1 AND professional_id=$2
      `, [establishmentId, professional.id]),
      db.query<{ startsAt: Date; endsAt: Date }>(`
        SELECT starts_at AS "startsAt", ends_at AS "endsAt" FROM appointments
        WHERE establishment_id=$1 AND professional_id=$2 AND starts_at<$3 AND ends_at>$4
          AND status IN ('pending','confirmed','in_progress') AND ($5::uuid IS NULL OR id<>$5)
      `, [establishmentId, professional.id, dayEnd.toJSDate(), dayStart.toJSDate(), excludeAppointmentId ?? null]),
      db.query<{ startsAt: Date; endsAt: Date }>(`
        SELECT begins_at AS "startsAt", ends_at AS "endsAt" FROM schedule_blocks
        WHERE establishment_id=$1 AND professional_id=$2 AND begins_at<$3 AND ends_at>$4
      `, [establishmentId, professional.id, dayEnd.toJSDate(), dayStart.toJSDate()])
    ]);
    items.push({
      professionalId: professional.id, professionalName: professional.full_name,
      slots: generateSlots({ date, zone: service.timezone, durationMinutes: service.duration_minutes,
        periods: intersectWeeklyPeriods(periods.rows, businessPeriods),
        appointments: reservations.rows, blocks: blocks.rows })
    });
  }
  return { zone: service.timezone, durationMinutes: service.duration_minutes, priceCents: service.price_cents, items };
}

function ctx(res: Response): Context { return res.locals.auth as Context; }
function errorIsConflict(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === '23P01'; }

calendarRouter.get('/calendar/availability', async (req, res) => {
  const params = z.object({ serviceId: uuid, date: z.iso.date(), professionalId: uuid.optional() }).safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: 'Informe serviço, data e profissional válidos.' }); return; }
  const { serviceId, date, professionalId } = params.data;
  const options = await availableForService(pool, ctx(res).establishmentId, serviceId, date, professionalId);
  if (!options) { res.status(404).json({ error: 'Serviço não encontrado ou inativo.' }); return; }
  res.json(options);
});

calendarRouter.get('/calendar', async (req, res) => {
  const params = z.object({ start: z.iso.date(), end: z.iso.date(), professionalId: uuid.optional() }).safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: 'Informe datas válidas para consultar a agenda.' }); return; }
  const { start, end, professionalId } = params.data;
  const zoneResult = await pool.query<{ timezone: string }>('SELECT timezone FROM establishments WHERE id=$1', [ctx(res).establishmentId]);
  const zone = zoneResult.rows[0]?.timezone ?? 'America/Sao_Paulo';
  const from = DateTime.fromISO(start, { zone }).startOf('day');
  const until = DateTime.fromISO(end, { zone }).startOf('day');
  if (!from.isValid || !until.isValid || until <= from || until.diff(from, 'days').days > 36) {
    res.status(400).json({ error: 'Consulte um período de até 36 dias e informe fim posterior ao início.' }); return;
  }
  const list = await pool.query(`
    SELECT a.id,a.service_id AS "serviceId",s.name AS "serviceName",
           a.professional_id AS "professionalId",p.full_name AS "professionalName",
           a.customer_id AS "customerId",c.full_name AS "customerName",
           a.starts_at AS "startsAt",a.ends_at AS "endsAt",a.status,a.notes,
           a.price_cents AS "priceCents"
    FROM appointments a JOIN services s ON s.establishment_id=a.establishment_id AND s.id=a.service_id
    JOIN professionals p ON p.establishment_id=a.establishment_id AND p.id=a.professional_id
    JOIN customers c ON c.establishment_id=a.establishment_id AND c.id=a.customer_id
    WHERE a.establishment_id=$1 AND a.starts_at<$2 AND a.ends_at>$3
      AND ($4::uuid IS NULL OR a.professional_id=$4)
    ORDER BY a.starts_at,p.full_name LIMIT 1500
  `, [ctx(res).establishmentId, until.toJSDate(), from.toJSDate(), professionalId ?? null]);
  res.json({ zone, items: list.rows });
});

// Consulta histórica somente em lista, paginada e limitada ao estabelecimento autenticado.
// A agenda interativa permanece reservada para hoje e datas futuras.
calendarRouter.get('/calendar/history', async (req, res) => {
  const parsed = z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    q: z.string().trim().max(80).optional().default('')
  }).strict().safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Escolha um mês válido para consultar o histórico.' }); return; }

  const { month, page, q } = parsed.data;
  const establishmentId = ctx(res).establishmentId;
  const zoneResult = await pool.query<{ timezone: string }>(
    'SELECT timezone FROM establishments WHERE id=$1', [establishmentId]);
  const zone = zoneResult.rows[0]?.timezone ?? 'America/Sao_Paulo';
  const start = DateTime.fromISO(`${month}-01`, { zone }).startOf('day');
  if (!start.isValid || start.toFormat('yyyy-MM') !== month || month >= DateTime.now().setZone(zone).toFormat('yyyy-MM')) {
    res.status(400).json({ error: 'O histórico mostra somente meses anteriores ao atual.' }); return;
  }
  const end = start.plus({ months: 1 });
  const args = [establishmentId, start.toJSDate(), end.toJSDate(), q];
  const filter = `FROM appointments a
    JOIN services s ON s.establishment_id=a.establishment_id AND s.id=a.service_id
    JOIN professionals p ON p.establishment_id=a.establishment_id AND p.id=a.professional_id
    JOIN customers c ON c.establishment_id=a.establishment_id AND c.id=a.customer_id
    WHERE a.establishment_id=$1 AND a.starts_at >= $2 AND a.starts_at < $3
      AND ($4::text = '' OR c.full_name ILIKE '%' || $4 || '%'
        OR p.full_name ILIKE '%' || $4 || '%'
        OR s.name ILIKE '%' || $4 || '%')`;
  const pageSize = 50;
  const [totalResult, list] = await Promise.all([
    pool.query<{ total: string }>(`SELECT count(*)::text AS total ${filter}`, args),
    pool.query(`SELECT a.id,a.starts_at AS "startsAt",a.ends_at AS "endsAt",a.status,
      s.name AS "serviceName",p.full_name AS "professionalName",c.full_name AS "customerName",
      a.price_cents AS "priceCents" ${filter}
      ORDER BY a.starts_at DESC,a.id DESC LIMIT $5 OFFSET $6`,
    [...args,pageSize,(page-1)*pageSize])
  ]);
  res.json({ zone, month, items: list.rows, total: Number(totalResult.rows[0]?.total ?? 0), page, pageSize });
});

calendarRouter.post('/calendar/appointments', async (req, res) => {
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Confira cliente, serviço, profissional, horário e observações.' }); return; }
  const input = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializa agendamento e criação de bloqueios para o mesmo profissional.
    const professional = await client.query('SELECT id FROM professionals WHERE establishment_id=$1 AND id=$2 AND active=true FOR UPDATE', [ctx(res).establishmentId, input.professionalId]);
    const customer = await client.query('SELECT id FROM customers WHERE establishment_id=$1 AND id=$2 AND active=true', [ctx(res).establishmentId, input.customerId]);
    if (!professional.rowCount || !customer.rowCount) {
      await client.query('ROLLBACK'); res.status(400).json({ error: 'Cliente ou profissional inexistente/inativo.' }); return;
    }
    const date = DateTime.fromISO(input.startsAt, { setZone: true }).toFormat('yyyy-MM-dd');
    const zoneResult = await client.query<{ timezone: string }>('SELECT timezone FROM establishments WHERE id=$1 FOR SHARE', [ctx(res).establishmentId]);
    const zone = zoneResult.rows[0]?.timezone ?? 'America/Sao_Paulo';
    const localDate = DateTime.fromISO(input.startsAt).setZone(zone).toISODate() ?? date;
    const availability = await availableForService(client, ctx(res).establishmentId, input.serviceId, localDate, input.professionalId);
    const selected = availability?.items[0]?.slots.find((slot) => new Date(slot.startsAt).getTime() === new Date(input.startsAt).getTime());
    if (!selected) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Horário indisponível, fora do expediente ou já reservado.' }); return; }
    const created = await client.query<{ id: string }>(`
      INSERT INTO appointments(establishment_id,service_id,professional_id,customer_id,starts_at,ends_at,price_cents,notes,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
    `, [ctx(res).establishmentId,input.serviceId,input.professionalId,input.customerId,
      new Date(selected.startsAt),new Date(selected.endsAt),availability!.priceCents,input.notes || null,ctx(res).userId]);
    await client.query(`INSERT INTO appointment_history(establishment_id,appointment_id,actor_user_id,event,current_status,current_starts_at)
                        VALUES($1,$2,$3,'created','pending',$4)`,
      [ctx(res).establishmentId, created.rows[0]!.id, ctx(res).userId, new Date(selected.startsAt)]);
    await client.query('COMMIT');
    res.status(201).json({ id: created.rows[0]!.id });
  } catch (error) {
    await client.query('ROLLBACK');
    if (errorIsConflict(error)) { res.status(409).json({ error: 'Este horário acabou de ser reservado. Escolha outro.' }); return; }
    throw error;
  } finally { client.release(); }
});

calendarRouter.patch('/calendar/appointments/:id/status', async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) { res.status(400).json({ error: 'Agendamento inválido.' }); return; }
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Situação inválida.' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<{ status: AppointmentStatus; starts_at: Date }>(
      'SELECT status,starts_at FROM appointments WHERE establishment_id=$1 AND id=$2 FOR UPDATE',
      [ctx(res).establishmentId,req.params.id]);
    if (!found.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Agendamento não encontrado.' }); return; }
    if (!canChangeStatus(found.rows[0]!.status, parsed.data.status)) {
      await client.query('ROLLBACK'); res.status(409).json({ error: 'Essa mudança de situação não é permitida.' }); return;
    }
    await client.query('UPDATE appointments SET status=$3,updated_at=now() WHERE establishment_id=$1 AND id=$2',
      [ctx(res).establishmentId,req.params.id,parsed.data.status]);
    await client.query(`INSERT INTO appointment_history(establishment_id,appointment_id,actor_user_id,event,previous_status,current_status,current_starts_at)
                        VALUES($1,$2,$3,'status_changed',$4,$5,$6)`,
      [ctx(res).establishmentId,req.params.id,ctx(res).userId,found.rows[0]!.status,parsed.data.status,found.rows[0]!.starts_at]);
    await client.query('COMMIT'); res.json({ updated: true });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});

calendarRouter.patch('/calendar/appointments/:id/reschedule', async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) { res.status(400).json({ error: 'Agendamento inválido.' }); return; }
  const parsed = rescheduleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Escolha um profissional e horário válidos.' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const original = await client.query<{ status: AppointmentStatus; starts_at: Date; service_id: string; professional_id: string }>(
      'SELECT status,starts_at,service_id,professional_id FROM appointments WHERE establishment_id=$1 AND id=$2 FOR UPDATE',
      [ctx(res).establishmentId,req.params.id]);
    if (!original.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Agendamento não encontrado.' }); return; }
    if (!['pending','confirmed'].includes(original.rows[0]!.status)) {
      await client.query('ROLLBACK'); res.status(409).json({ error: 'Somente agendamentos pendentes ou confirmados podem ser remarcados.' }); return;
    }
    const professional = await client.query('SELECT id FROM professionals WHERE establishment_id=$1 AND id=$2 AND active=true FOR UPDATE',
      [ctx(res).establishmentId,parsed.data.professionalId]);
    if (!professional.rowCount) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Profissional não disponível.' }); return; }
    const zoneResult = await client.query<{ timezone: string }>('SELECT timezone FROM establishments WHERE id=$1 FOR SHARE', [ctx(res).establishmentId]);
    const day = DateTime.fromISO(parsed.data.startsAt).setZone(zoneResult.rows[0]?.timezone ?? 'America/Sao_Paulo').toISODate()!;
    const availability = await availableForService(client, ctx(res).establishmentId,
      original.rows[0]!.service_id, day, parsed.data.professionalId, req.params.id);
    const selected = availability?.items[0]?.slots.find((slot) => new Date(slot.startsAt).getTime() === new Date(parsed.data.startsAt).getTime());
    if (!selected) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Novo horário indisponível.' }); return; }
    await client.query('UPDATE appointments SET professional_id=$3,starts_at=$4,ends_at=$5,updated_at=now() WHERE establishment_id=$1 AND id=$2',
      [ctx(res).establishmentId,req.params.id,parsed.data.professionalId,new Date(selected.startsAt),new Date(selected.endsAt)]);
    await client.query(`INSERT INTO appointment_history(establishment_id,appointment_id,actor_user_id,event,previous_status,current_status,previous_starts_at,current_starts_at)
                        VALUES($1,$2,$3,'rescheduled',$4,$4,$5,$6)`,
      [ctx(res).establishmentId,req.params.id,ctx(res).userId,original.rows[0]!.status,original.rows[0]!.starts_at,new Date(selected.startsAt)]);
    await client.query('COMMIT'); res.json({ updated: true });
  } catch (error) {
    await client.query('ROLLBACK');
    if (errorIsConflict(error)) { res.status(409).json({ error: 'Novo horário ocupado por outro agendamento.' }); return; }
    throw error;
  } finally { client.release(); }
});

calendarRouter.get('/calendar/appointments/:id/history', async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) { res.status(400).json({ error: 'Agendamento inválido.' }); return; }
  const exists = await pool.query('SELECT 1 FROM appointments WHERE establishment_id=$1 AND id=$2', [ctx(res).establishmentId,req.params.id]);
  if (!exists.rowCount) { res.status(404).json({ error: 'Agendamento não encontrado.' }); return; }
  const events = await pool.query(`
    SELECT h.event,h.previous_status AS "previousStatus",h.current_status AS "currentStatus",
           h.previous_starts_at AS "previousStartsAt",h.current_starts_at AS "currentStartsAt",
           h.created_at AS "createdAt",u.full_name AS "actorName"
    FROM appointment_history h LEFT JOIN users u ON u.id=h.actor_user_id
    WHERE h.establishment_id=$1 AND h.appointment_id=$2 ORDER BY h.created_at ASC
  `, [ctx(res).establishmentId,req.params.id]);
  res.json({ items: events.rows });
});

calendarRouter.post('/calendar/blocks', async (req, res) => {
  const parsed = blockSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Informe profissional, período e motivo válidos.' }); return; }
  const { professionalId, startsAt, endsAt, reason } = parsed.data;
  const begins = new Date(startsAt); const ends = new Date(endsAt);
  const now = Date.now();
  if (begins.getTime() >= ends.getTime() || ends.getTime() - begins.getTime() > 30 * 24 * 3600_000
    || begins.getTime() < now - 5 * 60_000 || begins.getTime() > now + 365 * 24 * 3600_000) {
    res.status(400).json({ error: 'Informe um período futuro, com duração máxima de 30 dias e início em até um ano.' }); return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const professional = await client.query('SELECT id FROM professionals WHERE establishment_id=$1 AND id=$2 FOR UPDATE', [ctx(res).establishmentId,professionalId]);
    if (!professional.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Profissional não encontrado.' }); return; }
    const existingBlock = await client.query(`SELECT 1 FROM schedule_blocks WHERE establishment_id=$1 AND professional_id=$2
      AND begins_at<$3 AND ends_at>$4 LIMIT 1`, [ctx(res).establishmentId,professionalId,ends,begins]);
    if (existingBlock.rowCount) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Já existe um bloqueio sobreposto a esse período.' }); return; }
    const conflicting = await client.query(`SELECT 1 FROM appointments WHERE establishment_id=$1 AND professional_id=$2
      AND starts_at<$3 AND ends_at>$4 AND status IN ('pending','confirmed','in_progress') LIMIT 1`,
      [ctx(res).establishmentId,professionalId,ends,begins]);
    if (conflicting.rowCount) { await client.query('ROLLBACK'); res.status(409).json({ error: 'O bloqueio conflita com um atendimento existente.' }); return; }
    const created = await client.query<{ id: string }>(`INSERT INTO schedule_blocks(establishment_id,professional_id,begins_at,ends_at,reason)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [ctx(res).establishmentId,professionalId,begins,ends,reason || null]);
    await client.query('COMMIT'); res.status(201).json({ id: created.rows[0]!.id });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});

calendarRouter.get('/calendar/blocks', async (req, res) => {
  const parsed = z.object({ professionalId: uuid }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Informe o profissional.' }); return; }
  const blocks = await pool.query(`SELECT id,begins_at AS "startsAt",ends_at AS "endsAt",reason FROM schedule_blocks
     WHERE establishment_id=$1 AND professional_id=$2 AND ends_at>now()-interval '14 days' ORDER BY begins_at DESC LIMIT 150`,
    [ctx(res).establishmentId,parsed.data.professionalId]);
  res.json({ items: blocks.rows });
});

calendarRouter.delete('/calendar/blocks/:id', async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) { res.status(400).json({ error: 'Bloqueio inválido.' }); return; }
  const result = await pool.query('DELETE FROM schedule_blocks WHERE establishment_id=$1 AND id=$2', [ctx(res).establishmentId,req.params.id]);
  if (!result.rowCount) { res.status(404).json({ error: 'Bloqueio não encontrado.' }); return; }
  res.status(204).end();
});
