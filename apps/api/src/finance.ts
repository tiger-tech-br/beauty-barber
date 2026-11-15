import { Router, type Response } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { pool } from './db.js';

type Context = { userId: string; establishmentId: string; role: 'owner' | 'receptionist' | 'professional' };
const uuid = z.uuid();
const createReceiptSchema = z.object({
  appointmentId: uuid,
  amountCents: z.number().int().min(1).max(10000000),
  method: z.enum(['cash', 'pix', 'card', 'transfer', 'other']),
  notes: z.string().trim().max(300).optional().default('')
}).strict();
const voidSchema = z.object({ reason: z.string().trim().min(5).max(300) }).strict();
const periodSchema = z.object({ from: z.iso.date(), to: z.iso.date() }).strict();

export const financeRouter = Router();
financeRouter.use((req, res, next) => {
  if (!req.path.startsWith('/finance') && !req.path.startsWith('/reports')) return next();
  if ((res.locals.auth as Context).role === 'professional') {
    res.status(403).json({ error: 'Sem permissão para consultar informações financeiras.' }); return;
  }
  next();
});
function ctx(res: Response): Context { return res.locals.auth as Context; }

async function period(req: { query: unknown }, res: Response) {
  const parsed = periodSchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Informe um período válido (AAAA-MM-DD).' }); return null; }
  const tenant = ctx(res).establishmentId;
  const zone = await pool.query<{ timezone: string }>('SELECT timezone FROM establishments WHERE id=$1', [tenant]);
  const timezone = zone.rows[0]?.timezone ?? 'America/Sao_Paulo';
  const start = DateTime.fromISO(parsed.data.from, { zone: timezone }).startOf('day');
  const end = DateTime.fromISO(parsed.data.to, { zone: timezone }).startOf('day').plus({ days: 1 });
  if (!start.isValid || !end.isValid || end <= start || end.diff(start, 'days').days > 367) {
    res.status(400).json({ error: 'Consulte um período de até 12 meses e data final posterior à inicial.' }); return null;
  }
  return { start: start.toJSDate(), end: end.toJSDate(), timezone };
}

financeRouter.get('/finance/receipts', async (req, res) => {
  const dates = await period(req, res); if (!dates) return;
  const result = await pool.query(`
    SELECT pr.id,pr.appointment_id AS "appointmentId",c.full_name AS "customerName",
           s.name AS "serviceName",pr.amount_cents AS "amountCents",pr.method,pr.status,
           pr.notes,pr.received_at AS "receivedAt",pr.void_reason AS "voidReason"
    FROM payment_records pr JOIN appointments a ON a.establishment_id=pr.establishment_id AND a.id=pr.appointment_id
    JOIN customers c ON c.establishment_id=a.establishment_id AND c.id=a.customer_id
    JOIN services s ON s.establishment_id=a.establishment_id AND s.id=a.service_id
    WHERE pr.establishment_id=$1 AND pr.received_at >= $2 AND pr.received_at<$3
    ORDER BY pr.received_at DESC LIMIT 1000
  `, [ctx(res).establishmentId, dates.start, dates.end]);
  res.json({ items: result.rows });
});

financeRouter.get('/finance/unpaid', async (_req, res) => {
  const list = await pool.query(`
    SELECT a.id AS "appointmentId",c.full_name AS "customerName",s.name AS "serviceName",
           a.starts_at AS "startsAt",a.price_cents AS "priceCents",
           a.price_cents - COALESCE(sum(pr.amount_cents) FILTER (WHERE pr.status='recorded'),0)::integer AS "remainingCents"
    FROM appointments a JOIN customers c ON c.establishment_id=a.establishment_id AND c.id=a.customer_id
    JOIN services s ON s.establishment_id=a.establishment_id AND s.id=a.service_id
    LEFT JOIN payment_records pr ON pr.establishment_id=a.establishment_id AND pr.appointment_id=a.id
    WHERE a.establishment_id=$1 AND a.status='completed' AND a.starts_at>now()-interval '365 days'
    GROUP BY a.id,c.full_name,s.name
    HAVING a.price_cents - COALESCE(sum(pr.amount_cents) FILTER (WHERE pr.status='recorded'),0) > 0
    ORDER BY a.starts_at DESC LIMIT 300
  `, [ctx(res).establishmentId]);
  res.json({ items: list.rows });
});

financeRouter.post('/finance/receipts', async (req, res) => {
  const parsed = createReceiptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Confira atendimento, método e valor recebido.' }); return; }
  const input = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<{ price_cents: number; status: string }>(`
      SELECT price_cents,status FROM appointments WHERE establishment_id=$1 AND id=$2 FOR UPDATE
    `, [ctx(res).establishmentId,input.appointmentId]);
    if (!found.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Atendimento não encontrado.' }); return; }
    if (found.rows[0]!.status !== 'completed') {
      await client.query('ROLLBACK'); res.status(409).json({ error: 'Conclua o atendimento antes de registrar o recebimento.' }); return;
    }
    const previous = await client.query<{ received: string }>(`
      SELECT COALESCE(sum(amount_cents),0)::text AS received FROM payment_records
      WHERE establishment_id=$1 AND appointment_id=$2 AND status='recorded'
    `, [ctx(res).establishmentId,input.appointmentId]);
    const remaining = found.rows[0]!.price_cents - Number(previous.rows[0]!.received);
    if (input.amountCents > remaining) {
      await client.query('ROLLBACK'); res.status(409).json({ error: `O saldo restante é R$ ${(remaining / 100).toFixed(2).replace('.', ',')}.` }); return;
    }
    const saved = await client.query<{ id: string }>(`
      INSERT INTO payment_records(establishment_id,appointment_id,amount_cents,method,notes,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id
    `, [ctx(res).establishmentId,input.appointmentId,input.amountCents,input.method,input.notes || null,ctx(res).userId]);
    await client.query('COMMIT'); res.status(201).json({ id: saved.rows[0]!.id });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});

financeRouter.post('/finance/receipts/:id/void', async (req, res) => {
  if (ctx(res).role !== 'owner') { res.status(403).json({ error: 'Somente o responsável pode estornar um lançamento.' }); return; }
  if (!uuid.safeParse(req.params.id).success) { res.status(400).json({ error: 'Lançamento inválido.' }); return; }
  const parsed = voidSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Informe o motivo do estorno.' }); return; }
  const result = await pool.query(`UPDATE payment_records SET status='voided',void_reason=$3,
    voided_by_user_id=$4,voided_at=now() WHERE establishment_id=$1 AND id=$2 AND status='recorded' RETURNING id`,
  [ctx(res).establishmentId,req.params.id,parsed.data.reason,ctx(res).userId]);
  if (!result.rowCount) { res.status(404).json({ error: 'Lançamento não encontrado ou já estornado.' }); return; }
  res.json({ voided: true });
});

financeRouter.get('/reports', async (req, res) => {
  const dates = await period(req, res); if (!dates) return;
  const tenant = ctx(res).establishmentId;
  const [counts, performed, receipts, services, staff, trend] = await Promise.all([
    pool.query<{ total: string; completed: string; cancelled: string; no_show: string; pending: string }>(`
      SELECT count(*)::text AS total,
        count(*) FILTER(WHERE status='completed')::text AS completed,
        count(*) FILTER(WHERE status='cancelled')::text AS cancelled,
        count(*) FILTER(WHERE status='no_show')::text AS no_show,
        count(*) FILTER(WHERE status='pending')::text AS pending
      FROM appointments WHERE establishment_id=$1 AND starts_at>=$2 AND starts_at<$3
    `, [tenant,dates.start,dates.end]),
    pool.query<{ value: string }>(`
      SELECT COALESCE(sum(price_cents),0)::text AS value FROM appointments
      WHERE establishment_id=$1 AND starts_at>=$2 AND starts_at<$3 AND status='completed'
    `, [tenant,dates.start,dates.end]),
    pool.query<{ value: string }>(`
      SELECT COALESCE(sum(amount_cents),0)::text AS value FROM payment_records
      WHERE establishment_id=$1 AND received_at>=$2 AND received_at<$3 AND status='recorded'
    `, [tenant,dates.start,dates.end]),
    pool.query(`SELECT s.name AS "serviceName",count(*)::integer AS count,
                sum(a.price_cents)::integer AS "performedValueCents"
      FROM appointments a JOIN services s ON s.establishment_id=a.establishment_id AND s.id=a.service_id
      WHERE a.establishment_id=$1 AND a.starts_at>=$2 AND a.starts_at<$3 AND a.status='completed'
      GROUP BY s.id ORDER BY count DESC,s.name LIMIT 10`, [tenant,dates.start,dates.end]),
    pool.query(`SELECT p.full_name AS "professionalName",count(*)::integer AS count
      FROM appointments a JOIN professionals p ON p.establishment_id=a.establishment_id AND p.id=a.professional_id
      WHERE a.establishment_id=$1 AND a.starts_at>=$2 AND a.starts_at<$3 AND a.status='completed'
      GROUP BY p.id ORDER BY count DESC,p.full_name LIMIT 20`, [tenant,dates.start,dates.end]),
    pool.query(`SELECT to_char(date_trunc('month',starts_at AT TIME ZONE $4),'YYYY-MM') AS month,
                count(*)::integer AS appointments,
                count(*) FILTER (WHERE status='completed')::integer AS completed
      FROM appointments WHERE establishment_id=$1 AND starts_at>=$2 AND starts_at<$3
      GROUP BY month ORDER BY month`, [tenant,dates.start,dates.end,dates.timezone])
  ]);
  const totals = counts.rows[0]!;
  res.json({
    summary: {
      total: Number(totals.total), completed: Number(totals.completed), cancelled: Number(totals.cancelled),
      noShow: Number(totals.no_show), pending: Number(totals.pending),
      performedValueCents: Number(performed.rows[0]!.value),
      receivedCents: Number(receipts.rows[0]!.value)
    },
    topServices: services.rows, byProfessional: staff.rows, monthly: trend.rows
  });
});
