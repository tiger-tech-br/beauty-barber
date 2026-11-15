import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { pool } from './db.js';
import { settings } from './config.js';
import { escapeHtml, mailConfigured, sendTransactionalEmail } from './email.js';
import { newSessionToken, sessionTokenHash, verifyPassword, hashPassword } from './security.js';
import { workingHoursSchema } from './management-schemas.js';
import { appointmentFitsPeriods, establishmentHoursForDate, type SpecialHours } from './calendar-rules.js';

type Context = { establishmentId: string; userId: string; role: 'owner' | 'receptionist' | 'professional' };
const uuid = z.uuid();
const businessSchema = z.object({
  name: z.string().trim().min(2).max(160),
  timezone: z.string().min(3).max(64),
  contactEmail: z.union([z.email().max(255),z.literal('')]).default(''),
  contactPhone: z.string().trim().max(25).default(''),
  addressLine: z.string().trim().max(240).default(''),
  city: z.string().trim().max(100).default(''),
  stateCode: z.union([z.string().regex(/^[A-Z]{2}$/),z.literal('')]).default('')
}).strict();
const inviteSchema = z.object({ email: z.email().max(255).transform((s) => s.toLowerCase()), role: z.enum(['receptionist','professional']) }).strict();
const membershipSchema = z.object({ role: z.enum(['receptionist','professional']), active: z.boolean() }).strict();
const acceptSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/), fullName: z.string().trim().min(2).max(120), password: z.string().min(12).max(128) }).strict();
const exportSchema = z.object({ password: z.string().min(1).max(128) }).strict();
const specialPeriodSchema = z.object({
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1439)
}).strict().refine((period) => period.endMinute > period.startMinute);
const specialHoursSchema = z.object({
  closed: z.boolean(),
  periods: z.array(specialPeriodSchema).max(4)
}).strict().refine((input) => input.closed ? input.periods.length === 0 : input.periods.length > 0)
  .refine(({ periods }) => {
    const sorted = [...periods].sort((a,b) => a.startMinute - b.startMinute);
    return sorted.every((period,index) => index === 0 || sorted[index - 1]!.endMinute <= period.startMinute);
  });
const inviteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
const exportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false,
  // Usuários autenticados dividem IPs (ex.: salões na mesma rede ou NAT).
  // O limite é por conta, não pela conexão compartilhada de todos os clientes.
  keyGenerator: (_req,res) => (res.locals.auth as Context).userId,
  message: { error: 'Muitas tentativas de exportação. Aguarde antes de tentar novamente.' } });

function who(res: { locals: Record<string,unknown> }): Context { return res.locals.auth as Context; }
function owner(res: { locals: Record<string,unknown>; status: (code:number)=>{json:(data:object)=>unknown} }) {
  if (who(res).role === 'owner') return true;
  res.status(403).json({ error: 'Somente o responsável pode alterar estas configurações.' });
  return false;
}

export const accountRouter = Router();
export const invitationPublicRouter = Router();

accountRouter.get('/account/business', async (_req,res) => {
  const item = await pool.query(`SELECT name,slug,timezone,COALESCE(contact_email,'') AS "contactEmail",
    COALESCE(contact_phone,'') AS "contactPhone",COALESCE(address_line,'') AS "addressLine",
    COALESCE(city,'') AS city,COALESCE(state_code,'') AS "stateCode",(logo_png IS NOT NULL) AS "hasLogo"
    FROM establishments WHERE id=$1`, [who(res).establishmentId]);
  res.json({ business: item.rows[0] });
});

accountRouter.put('/account/business', async (req,res) => {
  if (!owner(res)) return;
  const parsed = businessSchema.safeParse(req.body);
  if (!parsed.success || !DateTime.now().setZone(parsed.data.timezone).isValid) {
    res.status(400).json({ error: 'Confira os dados do estabelecimento e o fuso horário.' }); return;
  }
  const data = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A reserva também obtém lock na empresa: a checagem não disputa com novas reservas.
    const business = await client.query<{ timezone:string }>(
      'SELECT timezone FROM establishments WHERE id=$1 FOR UPDATE', [who(res).establishmentId]);
    if (business.rows[0]?.timezone !== data.timezone) {
      const upcoming = await client.query(`SELECT 1 FROM appointments
        WHERE establishment_id=$1 AND starts_at>=now()
        AND status IN ('pending','confirmed','in_progress') LIMIT 1`, [who(res).establishmentId]);
      if (upcoming.rowCount) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Existem agendamentos futuros. Para evitar deslocar os horários, altere o fuso somente depois de concluir, remarcar ou cancelar essas reservas.' });
        return;
      }
    }
    await client.query(`UPDATE establishments SET name=$2,timezone=$3,contact_email=$4,contact_phone=$5,
      address_line=$6,city=$7,state_code=$8 WHERE id=$1`, [who(res).establishmentId,data.name,data.timezone,
      data.contactEmail || null,data.contactPhone || null,data.addressLine || null,data.city || null,data.stateCode || null]);
    await client.query('COMMIT');
    res.json({ saved: true });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});

accountRouter.get('/account/opening-hours', async (_req,res) => {
  const result = await pool.query(`
    SELECT weekday,start_minute AS "startMinute",end_minute AS "endMinute"
    FROM establishment_hours WHERE establishment_id=$1 ORDER BY weekday,start_minute
  `, [who(res).establishmentId]);
  res.json({ periods: result.rows });
});

accountRouter.put('/account/opening-hours', async (req,res) => {
  if (!owner(res)) return;
  const parsed = workingHoursSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Confira os horários de funcionamento. Não é permitido sobrepor períodos.' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializa a alteração com novas reservas, inclusive confirmações públicas.
    const business = await client.query<{ timezone: string }>(
      'SELECT timezone FROM establishments WHERE id=$1 FOR UPDATE', [who(res).establishmentId]);
    const upcoming = await client.query<{ starts_at: Date; ends_at: Date }>(`
      SELECT starts_at,ends_at FROM appointments
      WHERE establishment_id=$1 AND starts_at>=now()
        AND status IN ('pending','confirmed','in_progress')
    `, [who(res).establishmentId]);
    const specials = await client.query<SpecialHours & { date: string }>(`
      SELECT day::text AS date,closed,periods FROM establishment_special_hours WHERE establishment_id=$1
    `, [who(res).establishmentId]);
    const zone = business.rows[0]!.timezone;
    const specialByDate = new Map(specials.rows.map((item) => [item.date, item]));
    if (upcoming.rows.some((booking) => {
      const date = DateTime.fromJSDate(booking.starts_at).setZone(zone).toISODate()!;
      const applicable = establishmentHoursForDate(date,zone,parsed.data.periods,specialByDate.get(date));
      return !appointmentFitsPeriods(booking.starts_at,booking.ends_at,zone,applicable);
    })) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Há agendamentos futuros fora do novo horário de funcionamento. Remarque ou cancele esses atendimentos antes de alterá-lo.' });
      return;
    }
    await client.query('DELETE FROM establishment_hours WHERE establishment_id=$1', [who(res).establishmentId]);
    for (const period of parsed.data.periods) {
      await client.query(`INSERT INTO establishment_hours(establishment_id,weekday,start_minute,end_minute)
        VALUES($1,$2,$3,$4)`, [who(res).establishmentId,period.weekday,period.startMinute,period.endMinute]);
    }
    await client.query('COMMIT');
    res.json({ saved: true });
  } catch (error) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error && 'code' in error && error.code === '23P01') {
      res.status(409).json({ error: 'Há períodos de funcionamento sobrepostos.' }); return;
    }
    throw error;
  } finally { client.release(); }
});

accountRouter.get('/account/special-hours', async (_req,res) => {
  const result = await pool.query(`
    SELECT s.day::text AS date,s.closed,s.periods FROM establishment_special_hours s
    JOIN establishments e ON e.id=s.establishment_id
    WHERE s.establishment_id=$1 AND s.day >= (now() AT TIME ZONE e.timezone)::date
    ORDER BY s.day LIMIT 365
  `, [who(res).establishmentId]);
  res.json({ items: result.rows });
});

async function updateSpecialDay(req: Request, res: Response, remove: boolean) {
  if (!owner(res)) return;
  const day = z.iso.date().safeParse(req.params.date);
  const input = remove ? null : specialHoursSchema.safeParse(req.body);
  if (!day.success || (input && !input.success)) {
    res.status(400).json({ error: 'Confira a data e os horários especiais. Os turnos não podem se sobrepor.' }); return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const business = await client.query<{ timezone: string }>(
      'SELECT timezone FROM establishments WHERE id=$1 FOR UPDATE', [who(res).establishmentId]);
    const zone = business.rows[0]!.timezone;
    const target = DateTime.fromISO(day.data, {zone}).startOf('day');
    const today = DateTime.now().setZone(zone).startOf('day');
    if (!target.isValid || target < today || target > today.plus({days:365})) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Escolha uma data válida de hoje até os próximos 365 dias.' }); return;
    }
    const weekday = target.weekday % 7;
    const weekly = await client.query<{ weekday: number; startMinute: number; endMinute: number }>(`
      SELECT weekday,start_minute AS "startMinute",end_minute AS "endMinute"
      FROM establishment_hours WHERE establishment_id=$1 AND weekday=$2
    `, [who(res).establishmentId,weekday]);
    const effective = establishmentHoursForDate(day.data,zone,weekly.rows,
      remove ? null : (input && input.success ? input.data : null));
    const existing = await client.query<{ starts_at: Date; ends_at: Date }>(`
      SELECT starts_at,ends_at FROM appointments WHERE establishment_id=$1
      AND starts_at<$3 AND ends_at>$2 AND status IN ('pending','confirmed','in_progress')
    `, [who(res).establishmentId,target.toJSDate(),target.plus({days:1}).toJSDate()]);
    if (existing.rows.some((booking) => !appointmentFitsPeriods(booking.starts_at,booking.ends_at,zone,effective))) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Já existem agendamentos que ficariam fora desse horário especial. Remarque ou cancele os atendimentos antes de alterar.' });
      return;
    }
    if (remove) {
      await client.query('DELETE FROM establishment_special_hours WHERE establishment_id=$1 AND day=$2::date',
        [who(res).establishmentId,day.data]);
    } else if (input && input.success) {
      await client.query(`INSERT INTO establishment_special_hours(establishment_id,day,closed,periods)
        VALUES($1,$2::date,$3,$4::jsonb)
        ON CONFLICT(establishment_id,day) DO UPDATE SET closed=EXCLUDED.closed,
        periods=EXCLUDED.periods,updated_at=now()`,
      [who(res).establishmentId,day.data,input.data.closed,JSON.stringify(input.data.periods)]);
    }
    await client.query('COMMIT');
    res.json({ saved: true });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

accountRouter.put('/account/special-hours/:date', (req,res) => updateSpecialDay(req,res,false));
accountRouter.delete('/account/special-hours/:date', (req,res) => updateSpecialDay(req,res,true));

// Arquivo entregue apenas ao responsável autenticado que confirmar a própria senha.
// Não inclui senhas, sessões, tokens, links privados nem credenciais do PagBank.
accountRouter.post('/account/export', exportLimiter, async (req,res) => {
  if (!owner(res)) return;
  const parsed = exportSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Confirme sua senha para exportar os dados.' }); return; }
  const identity = who(res);
  const user = await pool.query<{ password_hash:string }>(
    'SELECT password_hash FROM users WHERE id=$1', [identity.userId]);
  if (!user.rowCount || !await verifyPassword(parsed.data.password,user.rows[0]!.password_hash)) {
    res.status(401).json({ error: 'Senha incorreta. Exportação não autorizada.' }); return;
  }

  const client = await pool.connect();
  let exportData: Record<string,unknown>;
  try {
    // Um retrato consistente: todos os SELECTs enxergam a mesma versão dos dados.
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tenant = identity.establishmentId;
    const queries: Record<string,string> = {
      establishment: `SELECT id,name,slug,timezone,contact_email,contact_phone,address_line,city,state_code,
        encode(logo_png,'base64') AS logo_png_base64,created_at
        FROM establishments WHERE id=$1`,
      team: `SELECT u.id,u.full_name,u.email,m.role,m.active,m.created_at
        FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.establishment_id=$1 ORDER BY m.created_at`,
      services: `SELECT id,name,category,description,duration_minutes,price_cents,active,created_at,updated_at
        FROM services WHERE establishment_id=$1 ORDER BY created_at`,
      professionals: `SELECT id,full_name,specialty,active,user_id,created_at,updated_at
        FROM professionals WHERE establishment_id=$1 ORDER BY created_at`,
      professionalServices: `SELECT professional_id,service_id FROM professional_services WHERE establishment_id=$1`,
      workingHours: `SELECT id,professional_id,weekday,start_minute,end_minute
        FROM working_hours WHERE establishment_id=$1`,
      establishmentHours: `SELECT id,weekday,start_minute,end_minute
        FROM establishment_hours WHERE establishment_id=$1`,
      specialHours: `SELECT day,closed,periods,updated_at FROM establishment_special_hours WHERE establishment_id=$1 ORDER BY day`,
      exportEvents: `SELECT id,requested_by_user_id,customer_id,created_at
        FROM data_export_events WHERE establishment_id=$1 ORDER BY created_at`,
      scheduleBlocks: `SELECT id,professional_id,begins_at,ends_at,reason
        FROM schedule_blocks WHERE establishment_id=$1 ORDER BY begins_at`,
      customers: `SELECT id,full_name,email,phone,notes,active,created_at,updated_at
        FROM customers WHERE establishment_id=$1 ORDER BY created_at`,
      appointments: `SELECT id,professional_id,service_id,customer_id,price_cents,starts_at,ends_at,status,
        notes,created_by_user_id,created_at,updated_at FROM appointments WHERE establishment_id=$1 ORDER BY starts_at`,
      appointmentHistory: `SELECT id,appointment_id,actor_user_id,event,previous_status,current_status,
        previous_starts_at,current_starts_at,created_at FROM appointment_history
        WHERE establishment_id=$1 ORDER BY created_at`,
      receipts: `SELECT id,appointment_id,amount_cents,method,status,notes,created_by_user_id,
        voided_by_user_id,void_reason,voided_at,received_at,created_at
        FROM payment_records WHERE establishment_id=$1 ORDER BY created_at`
    };
    exportData = {};
    // Não montar arquivos ilimitados em memória. Nunca entregar uma exportação parcial.
    const maxExportRows = 10000;
    let totalRows = 0;
    for (const [name,query] of Object.entries(queries)) {
      const result = await client.query(`SELECT * FROM (${query}) AS export_items LIMIT $2`,[tenant,maxExportRows+1]);
      totalRows += result.rowCount ?? 0;
      if (totalRows > maxExportRows) {
        await client.query('ROLLBACK');
        res.status(413).json({ error: 'A exportação excede o limite seguro de 10 mil registros. Solicite uma exportação assistida.' });
        return;
      }
      exportData[name] = name === 'establishment' ? result.rows[0] ?? null : result.rows;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }

  // Guarda somente quem solicitou e quando, sem registrar o conteúdo da exportação.
  await pool.query('INSERT INTO data_export_events(establishment_id,requested_by_user_id) VALUES($1,$2)',
    [identity.establishmentId, identity.userId]);
  const date = new Date().toISOString().slice(0,10);
  res.set('Content-Type','application/json; charset=utf-8');
  res.set('Content-Disposition',`attachment; filename="beautybarber-dados-${date}.json"`);
  res.status(200).send(JSON.stringify({ formatVersion:1,exportedAt:new Date().toISOString(),data:exportData }));
});

// Download individual para que o responsável possa atender uma solicitação após
// verificar a identidade do cliente. Não é uma exclusão nem entrega automática ao público.
accountRouter.post('/account/customers/:id/export', exportLimiter, async (req,res) => {
  if (!owner(res)) return;
  const customerId = uuid.safeParse(req.params.id);
  const input = exportSchema.safeParse(req.body);
  if (!customerId.success || !input.success) {
    res.status(400).json({error:'Informe o cliente e confirme sua senha.'}); return;
  }
  const identity = who(res);
  const user = await pool.query<{ password_hash:string }>('SELECT password_hash FROM users WHERE id=$1', [identity.userId]);
  if (!user.rowCount || !await verifyPassword(input.data.password,user.rows[0]!.password_hash)) {
    res.status(401).json({error:'Senha incorreta. Exportação não autorizada.'}); return;
  }
  const client = await pool.connect();
  let data: Record<string,unknown>;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const customer = await client.query(`SELECT id,full_name,email,phone,notes,active,created_at,updated_at
      FROM customers WHERE establishment_id=$1 AND id=$2`, [identity.establishmentId,customerId.data]);
    if (!customer.rowCount) {
      await client.query('ROLLBACK');
      res.status(404).json({error:'Cliente não encontrado neste estabelecimento.'}); return;
    }
    const queries: Record<string,string> = {
      appointments:`SELECT a.id,a.starts_at,a.ends_at,a.status,a.notes,a.price_cents,s.name AS service_name,
          p.full_name AS professional_name,a.created_at,a.updated_at FROM appointments a
          JOIN services s ON s.establishment_id=a.establishment_id AND s.id=a.service_id
          JOIN professionals p ON p.establishment_id=a.establishment_id AND p.id=a.professional_id
          WHERE a.establishment_id=$1 AND a.customer_id=$2 ORDER BY a.starts_at`,
      appointmentHistory:`SELECT h.id,h.appointment_id,h.event,h.previous_status,h.current_status,
          h.previous_starts_at,h.current_starts_at,h.created_at FROM appointment_history h
          JOIN appointments a ON a.establishment_id=h.establishment_id AND a.id=h.appointment_id
          WHERE a.establishment_id=$1 AND a.customer_id=$2 ORDER BY h.created_at`,
      receipts:`SELECT pr.id,pr.appointment_id,pr.amount_cents,pr.method,pr.status,
          pr.received_at,pr.notes,pr.void_reason,pr.voided_at,pr.created_at FROM payment_records pr
          JOIN appointments a ON a.establishment_id=pr.establishment_id AND a.id=pr.appointment_id
          WHERE a.establishment_id=$1 AND a.customer_id=$2 ORDER BY pr.received_at`
    };
    data = { customer:customer.rows[0] };
    let total = 0;
    for (const [name,sql] of Object.entries(queries)) {
      const rows = await client.query(`SELECT * FROM (${sql}) AS records LIMIT 5001`,
        [identity.establishmentId,customerId.data]);
      total += rows.rowCount??0;
      if (total>5000) {
        await client.query('ROLLBACK');
        res.status(413).json({error:'Este histórico é grande demais para a exportação automática. Solicite uma exportação assistida.'}); return;
      }
      data[name] = rows.rows;
    }
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK').catch(()=>undefined); throw error; }
  finally { client.release(); }

  await pool.query('INSERT INTO data_export_events(establishment_id,requested_by_user_id,customer_id) VALUES($1,$2,$3)',
    [identity.establishmentId,identity.userId,customerId.data]);
  res.type('json');
  res.set('Content-Disposition',`attachment; filename="beautybarber-cliente-${customerId.data}.json"`);
  res.send(JSON.stringify({formatVersion:1,exportedAt:new Date().toISOString(),data}));
});

accountRouter.get('/team', async (_req,res) => {
  if (!owner(res)) return;
  const users = await pool.query(`SELECT u.id,u.full_name AS "fullName",u.email,m.role,m.active,m.created_at AS "createdAt"
    FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.establishment_id=$1 ORDER BY m.role='owner' DESC,u.full_name`, [who(res).establishmentId]);
  const invites = await pool.query(`SELECT id,email,role,created_at AS "createdAt",expires_at AS "expiresAt",
    consumed_at AS "consumedAt",revoked_at AS "revokedAt"
    FROM team_invitations WHERE establishment_id=$1 ORDER BY created_at DESC LIMIT 40`, [who(res).establishmentId]);
  res.json({ users: users.rows, invitations: invites.rows, emailEnabled: mailConfigured() });
});

accountRouter.post('/team/invitations', inviteLimiter, async (req,res) => {
  if (!owner(res)) return;
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Informe e-mail válido e função.' }); return; }
  const data = parsed.data;
  const current = await pool.query(`SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.establishment_id=$1 AND u.email=$2`, [who(res).establishmentId,data.email]);
  if (current.rowCount) { res.status(409).json({ error: 'Este e-mail já faz parte da equipe.' }); return; }
  const token = newSessionToken();
  const client = await pool.connect();
  let invitationId: string;
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE team_invitations SET revoked_at=now()
      WHERE establishment_id=$1 AND email=$2 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at<now()`,
      [who(res).establishmentId,data.email]);
    const created = await client.query<{ id: string }>(`INSERT INTO team_invitations(establishment_id,invited_by_user_id,email,role,token_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '48 hours') RETURNING id`,
      [who(res).establishmentId,who(res).userId,data.email,data.role,sessionTokenHash(token)]);
    invitationId = created.rows[0]!.id;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      res.status(409).json({ error: 'Já existe um convite pendente para esse e-mail.' }); return;
    }
    throw error;
  } finally { client.release(); }
  const link = `${settings.webOrigin}/convite?token=${encodeURIComponent(token)}`;
  let emailed = false;
  if (mailConfigured()) {
    const company = await pool.query<{ name: string }>('SELECT name FROM establishments WHERE id=$1', [who(res).establishmentId]);
    try {
      await sendTransactionalEmail({ to: data.email,subject: 'Convite para a equipe — BeautyBarber',
        idempotencyKey: `beautybarber-invitation-${invitationId}`,
        html: `<div style="font-family:Arial,sans-serif;color:#20262D;line-height:1.7"><h1 style="color:#244B50">Convite para equipe</h1>
        <p>Você foi convidado(a) para atuar em <strong>${escapeHtml(company.rows[0]!.name)}</strong> no BeautyBarber.</p>
        <p><a href="${link}">Aceitar convite</a></p><p>Este link vence em 48 horas. Se não reconhece o convite, ignore.</p></div>` });
      emailed = true;
    } catch (error) { console.error('[team-invitation-mail]',error); }
  }
  res.status(201).json({ id: invitationId, emailed, invitationUrl: emailed ? null : link });
});

accountRouter.post('/team/invitations/:id/revoke', async (req,res) => {
  if (!owner(res)) return;
  if (!uuid.safeParse(req.params.id).success) { res.status(400).json({ error: 'Convite inválido.' }); return; }
  const result = await pool.query(`UPDATE team_invitations SET revoked_at=now()
    WHERE establishment_id=$1 AND id=$2 AND consumed_at IS NULL AND revoked_at IS NULL RETURNING id`,
  [who(res).establishmentId,req.params.id]);
  if (!result.rowCount) { res.status(404).json({ error: 'Convite pendente não encontrado.' }); return; }
  res.json({ revoked: true });
});

accountRouter.put('/team/:id', async (req,res) => {
  if (!owner(res)) return;
  if (!uuid.safeParse(req.params.id).success) { res.status(400).json({ error: 'Usuário inválido.' }); return; }
  const parsed = membershipSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Informe função e situação válidas.' }); return; }
  const result = await pool.query(`UPDATE memberships SET role=$3,active=$4
    WHERE establishment_id=$1 AND user_id=$2 AND role<>'owner' RETURNING user_id`,
  [who(res).establishmentId,req.params.id,parsed.data.role,parsed.data.active]);
  if (!result.rowCount) { res.status(404).json({ error: 'Membro não encontrado ou proprietário protegido.' }); return; }
  if (!parsed.data.active) await pool.query('DELETE FROM sessions WHERE establishment_id=$1 AND user_id=$2', [who(res).establishmentId,req.params.id]);
  res.json({ saved: true });
});

invitationPublicRouter.get('/invitations/:token', async (req,res) => {
  const token = z.string().regex(/^[A-Za-z0-9_-]{40,60}$/).safeParse(req.params.token);
  if (!token.success) { res.status(404).json({ error: 'Convite inválido.' }); return; }
  const result = await pool.query(`SELECT i.email,i.role,e.name AS "establishmentName"
    FROM team_invitations i JOIN establishments e ON e.id=i.establishment_id
    WHERE i.token_hash=$1 AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND e.active=true`,
  [sessionTokenHash(token.data)]);
  if (!result.rowCount) { res.status(404).json({ error: 'Convite não encontrado ou expirado.' }); return; }
  res.json({ invitation: result.rows[0] });
});

invitationPublicRouter.post('/invitations/accept', inviteLimiter, async (req,res) => {
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Informe nome, senha (mínimo 12 caracteres) e convite válidos.' }); return; }
  const data = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string; establishment_id: string; email: string; role: string }>(`
      SELECT id,establishment_id,email,role FROM team_invitations WHERE token_hash=$1 AND consumed_at IS NULL
      AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`, [sessionTokenHash(data.token)]);
    const invitation = result.rows[0];
    if (!invitation) { await client.query('ROLLBACK'); res.status(410).json({ error: 'Convite já utilizado ou expirado.' }); return; }
    const users = await client.query<{ id: string; password_hash: string }>('SELECT id,password_hash FROM users WHERE email=$1', [invitation.email]);
    let userId: string;
    if (users.rowCount) {
      if (!(await verifyPassword(data.password,users.rows[0]!.password_hash))) {
        await client.query('ROLLBACK'); res.status(401).json({ error: 'A senha dessa conta não confere. Use sua senha atual.' }); return;
      }
      userId = users.rows[0]!.id;
    } else {
      const hash = await hashPassword(data.password);
      const created = await client.query<{ id: string }>(`INSERT INTO users(full_name,email,password_hash) VALUES($1,$2,$3) RETURNING id`,
        [data.fullName,invitation.email,hash]);
      userId = created.rows[0]!.id;
    }
    await client.query(`INSERT INTO memberships(establishment_id,user_id,role)
      VALUES($1,$2,$3)`,
      [invitation.establishment_id,userId,invitation.role]);
    await client.query('UPDATE team_invitations SET consumed_at=now() WHERE id=$1', [invitation.id]);
    await client.query('COMMIT'); res.json({ accepted: true });
  } catch (error) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      res.status(409).json({ error: 'Este usuário já possui acesso. Entre normalmente.' }); return;
    }
    throw error;
  }
  finally { client.release(); }
});
