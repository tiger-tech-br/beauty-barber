import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { customerSchema, professionalSchema, serviceSchema, workingHoursSchema } from './management-schemas.js';
import { appointmentFitsPeriods } from './calendar-rules.js';

type SessionContext = { establishmentId: string; role: 'owner' | 'receptionist' | 'professional' };
type DbError = Error & { code?: string };
const uuidSchema = z.uuid();

export const managementRouter = Router();

managementRouter.use((req, res, next) => {
  if (!/^\/(services|professionals|customers)(?:\/|$)/.test(req.path)) return next();
  const auth = res.locals.auth as SessionContext | undefined;
  if (!auth || !['owner', 'receptionist'].includes(auth.role)) {
    res.status(403).json({ error: 'Você não tem permissão para acessar este módulo.' });
    return;
  }
  next();
});

function tenant(res: { locals: Record<string, unknown> }) {
  return (res.locals.auth as SessionContext).establishmentId;
}

function invalidId(id: string | undefined) { return !uuidSchema.safeParse(id).success; }

function dbError(error: unknown, res: { status: (code: number) => { json: (body: object) => unknown } }) {
  const code = (error as DbError).code;
  if (code === '23P01') {
    res.status(409).json({ error: 'Há horários de expediente sobrepostos.' });
    return true;
  }
  if (code === '23503') {
    res.status(409).json({ error: 'Há uma associação inválida ou não permitida.' });
    return true;
  }
  return false;
}

managementRouter.get('/services', async (_req, res) => {
  const result = await pool.query(`
    SELECT id, name, category, description, duration_minutes AS "durationMinutes",
           price_cents AS "priceCents", active
    FROM services WHERE establishment_id = $1
    ORDER BY active DESC, name ASC LIMIT 500
  `, [tenant(res)]);
  res.json({ items: result.rows });
});

managementRouter.post('/services', async (req, res) => {
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Confira nome, categoria, duração e preço do serviço.' }); return; }
  const data = parsed.data;
  const result = await pool.query(`
    INSERT INTO services(establishment_id, name, category, description, duration_minutes, price_cents, active)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    RETURNING id
  `, [tenant(res), data.name, data.category, data.description || null, data.durationMinutes, data.priceCents, data.active]);
  res.status(201).json({ id: result.rows[0].id });
});

managementRouter.put('/services/:id', async (req, res) => {
  if (invalidId(req.params.id)) { res.status(400).json({ error: 'ID de serviço inválido.' }); return; }
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Confira os campos do serviço.' }); return; }
  const data = parsed.data;
  const result = await pool.query(`
    UPDATE services SET name=$3, category=$4, description=$5, duration_minutes=$6,
        price_cents=$7, active=$8, updated_at=now()
    WHERE establishment_id=$1 AND id=$2 RETURNING id
  `, [tenant(res), req.params.id, data.name, data.category, data.description || null, data.durationMinutes, data.priceCents, data.active]);
  if (!result.rowCount) { res.status(404).json({ error: 'Serviço não encontrado neste estabelecimento.' }); return; }
  res.json({ id: result.rows[0].id });
});

managementRouter.get('/professionals', async (_req, res) => {
  const result = await pool.query(`
    SELECT p.id, p.full_name AS "fullName", p.specialty, p.active, p.user_id AS "userId",
           COALESCE(array_agg(ps.service_id) FILTER (WHERE ps.service_id IS NOT NULL), '{}') AS "serviceIds"
    FROM professionals p
    LEFT JOIN professional_services ps
      ON ps.establishment_id=p.establishment_id AND ps.professional_id=p.id
    WHERE p.establishment_id=$1
    GROUP BY p.id ORDER BY p.active DESC, p.full_name ASC LIMIT 500
  `, [tenant(res)]);
  res.json({ items: result.rows });
});

managementRouter.put('/professionals/:id/account', async (req, res) => {
  if ((res.locals.auth as SessionContext).role !== 'owner') {
    res.status(403).json({ error: 'Somente o responsável pode vincular contas à equipe.' }); return;
  }
  if (invalidId(req.params.id)) { res.status(400).json({ error: 'Profissional inválido.' }); return; }
  const parsed = z.object({ userId: z.uuid().nullable() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Selecione uma conta válida.' }); return; }
  if (parsed.data.userId) {
    const member = await pool.query(`SELECT 1 FROM memberships WHERE establishment_id=$1 AND user_id=$2
      AND role='professional' AND active=true`, [tenant(res),parsed.data.userId]);
    if (!member.rowCount) { res.status(400).json({ error: 'A conta selecionada não é um profissional ativo deste estabelecimento.' }); return; }
  }
  try {
    const updated = await pool.query(`UPDATE professionals SET user_id=$3,updated_at=now()
      WHERE establishment_id=$1 AND id=$2 RETURNING id`, [tenant(res),req.params.id,parsed.data.userId]);
    if (!updated.rowCount) { res.status(404).json({ error: 'Profissional não encontrado.' }); return; }
    res.json({ saved: true });
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      res.status(409).json({ error: 'Esta conta já está vinculada a outro profissional.' }); return;
    }
    throw error;
  }
});

async function replaceProfessionalServices(
  client: { query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }> },
  establishmentId: string,
  professionalId: string,
  serviceIds: string[]
) {
  if (serviceIds.length) {
    const valid = await client.query(`
      SELECT s.id FROM services s
      LEFT JOIN professional_services ps ON ps.establishment_id=s.establishment_id
        AND ps.service_id=s.id AND ps.professional_id=$3
      WHERE s.establishment_id=$1 AND s.id = ANY($2::uuid[])
        AND (s.active=true OR ps.professional_id IS NOT NULL)
    `, [establishmentId, serviceIds, professionalId]);
    if (valid.rows.length !== serviceIds.length) return false;
  }
  await client.query('DELETE FROM professional_services WHERE establishment_id=$1 AND professional_id=$2', [establishmentId, professionalId]);
  for (const serviceId of serviceIds) {
    await client.query('INSERT INTO professional_services(establishment_id, professional_id, service_id) VALUES ($1,$2,$3)', [establishmentId, professionalId, serviceId]);
  }
  return true;
}

managementRouter.post('/professionals', async (req, res) => {
  const parsed = professionalSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Confira os dados e os serviços selecionados.' }); return; }
  const data = parsed.data;
  const establishmentId = tenant(res);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query<{ id: string }>(`
      INSERT INTO professionals(establishment_id, full_name, specialty, active)
      VALUES($1,$2,$3,$4) RETURNING id
    `, [establishmentId, data.fullName, data.specialty || null, data.active]);
    const id = created.rows[0]!.id;
    if (!(await replaceProfessionalServices(client, establishmentId, id, data.serviceIds))) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Selecione somente serviços ativos deste estabelecimento.' });
      return;
    }
    await client.query('COMMIT');
    res.status(201).json({ id });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});

managementRouter.put('/professionals/:id', async (req, res) => {
  if (invalidId(req.params.id)) { res.status(400).json({ error: 'ID do profissional inválido.' }); return; }
  const parsed = professionalSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Confira os dados do profissional.' }); return; }
  const data = parsed.data;
  const establishmentId = tenant(res);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query<{ id: string }>(`
      UPDATE professionals SET full_name=$3, specialty=$4, active=$5, updated_at=now()
      WHERE establishment_id=$1 AND id=$2 RETURNING id
    `, [establishmentId, req.params.id, data.fullName, data.specialty || null, data.active]);
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Profissional não encontrado neste estabelecimento.' });
      return;
    }
    if (!(await replaceProfessionalServices(client, establishmentId, req.params.id!, data.serviceIds))) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Selecione somente serviços ativos deste estabelecimento.' });
      return;
    }
    await client.query('COMMIT');
    res.json({ id: updated.rows[0]!.id });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});

managementRouter.get('/professionals/:id/working-hours', async (req, res) => {
  if (invalidId(req.params.id)) { res.status(400).json({ error: 'ID do profissional inválido.' }); return; }
  const establishmentId = tenant(res);
  const found = await pool.query('SELECT 1 FROM professionals WHERE establishment_id=$1 AND id=$2', [establishmentId, req.params.id]);
  if (!found.rowCount) { res.status(404).json({ error: 'Profissional não encontrado.' }); return; }
  const periods = await pool.query(`
    SELECT weekday, start_minute AS "startMinute", end_minute AS "endMinute"
    FROM working_hours WHERE establishment_id=$1 AND professional_id=$2
    ORDER BY weekday, start_minute
  `, [establishmentId, req.params.id]);
  res.json({ periods: periods.rows });
});

managementRouter.put('/professionals/:id/working-hours', async (req, res) => {
  if (invalidId(req.params.id)) { res.status(400).json({ error: 'ID do profissional inválido.' }); return; }
  const parsed = workingHoursSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Confira os intervalos: os horários não podem se sobrepor.' }); return; }
  const establishmentId = tenant(res);
  const professionalId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Bloqueia o registro do profissional para serializar alterações concorrentes no expediente.
    const found = await client.query('SELECT id FROM professionals WHERE establishment_id=$1 AND id=$2 FOR UPDATE', [establishmentId, professionalId]);
    if (!found.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Profissional não encontrado.' }); return; }
    const zone = await client.query<{ timezone: string }>(
      'SELECT timezone FROM establishments WHERE id=$1', [establishmentId]);
    const upcoming = await client.query<{ starts_at: Date; ends_at: Date }>(`
      SELECT starts_at,ends_at FROM appointments
      WHERE establishment_id=$1 AND professional_id=$2 AND starts_at>=now()
        AND status IN ('pending','confirmed','in_progress')
    `, [establishmentId, professionalId]);
    if (upcoming.rows.some((booking) => !appointmentFitsPeriods(
      booking.starts_at, booking.ends_at, zone.rows[0]?.timezone ?? 'America/Sao_Paulo', parsed.data.periods))) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Há agendamentos futuros fora do novo expediente. Remarque ou cancele esses atendimentos antes de alterar os horários.' });
      return;
    }
    await client.query('DELETE FROM working_hours WHERE establishment_id=$1 AND professional_id=$2', [establishmentId, professionalId]);
    for (const item of parsed.data.periods) {
      await client.query(`
        INSERT INTO working_hours(establishment_id, professional_id, weekday, start_minute, end_minute)
        VALUES($1,$2,$3,$4,$5)
      `, [establishmentId, professionalId, item.weekday, item.startMinute, item.endMinute]);
    }
    await client.query('COMMIT');
    res.json({ saved: true });
  } catch (error) {
    await client.query('ROLLBACK');
    if (!dbError(error, res)) throw error;
  } finally { client.release(); }
});

managementRouter.get('/customers', async (_req, res) => {
  const result = await pool.query(`
    SELECT id, full_name AS "fullName", email, phone, notes, active
    FROM customers WHERE establishment_id=$1 ORDER BY active DESC, full_name ASC LIMIT 500
  `, [tenant(res)]);
  res.json({ items: result.rows });
});

managementRouter.post('/customers', async (req, res) => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Confira os dados do cliente.' }); return; }
  const data = parsed.data;
  const result = await pool.query(`
    INSERT INTO customers(establishment_id, full_name, email, phone, notes, active)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id
  `, [tenant(res), data.fullName, data.email || null, data.phone || null, data.notes || null, data.active]);
  res.status(201).json({ id: result.rows[0].id });
});

managementRouter.put('/customers/:id', async (req, res) => {
  if (invalidId(req.params.id)) { res.status(400).json({ error: 'ID do cliente inválido.' }); return; }
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Confira os dados do cliente.' }); return; }
  const data = parsed.data;
  const result = await pool.query(`
    UPDATE customers SET full_name=$3, email=$4, phone=$5, notes=$6, active=$7, updated_at=now()
    WHERE establishment_id=$1 AND id=$2 RETURNING id
  `, [tenant(res), req.params.id, data.fullName, data.email || null, data.phone || null, data.notes || null, data.active]);
  if (!result.rowCount) { res.status(404).json({ error: 'Cliente não encontrado neste estabelecimento.' }); return; }
  res.json({ id: result.rows[0].id });
});

// O histórico é sempre filtrado pela empresa da sessão, inclusive quando o ID do cliente existe em outra empresa.
managementRouter.get('/customers/:id/history', async (req, res) => {
  if (invalidId(req.params.id)) { res.status(400).json({ error: 'Cliente inválido.' }); return; }
  const found = await pool.query('SELECT 1 FROM customers WHERE establishment_id=$1 AND id=$2', [tenant(res), req.params.id]);
  if (!found.rowCount) { res.status(404).json({ error: 'Cliente não encontrado.' }); return; }
  const result = await pool.query(`
    SELECT a.id,a.starts_at AS "startsAt",a.ends_at AS "endsAt",a.status,
           a.price_cents AS "priceCents",s.name AS "serviceName",p.full_name AS "professionalName"
    FROM appointments a
    JOIN services s ON s.establishment_id=a.establishment_id AND s.id=a.service_id
    JOIN professionals p ON p.establishment_id=a.establishment_id AND p.id=a.professional_id
    WHERE a.establishment_id=$1 AND a.customer_id=$2
    ORDER BY a.starts_at DESC LIMIT 100
  `, [tenant(res), req.params.id]);
  res.json({ items: result.rows });
});

