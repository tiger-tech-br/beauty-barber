import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { pool } from './db.js';
import { settings } from './config.js';
import { availableForService } from './appointments.js';
import { mailConfigured, sendTransactionalEmail, escapeHtml } from './email.js';
import { newSessionToken, sessionTokenHash } from './security.js';
import { hasCurrentSubscription } from './subscription-access.js';

async function onlineBookingPermitted(establishmentId: string): Promise<boolean> {
  return !settings.subscriptionEnforcement || await hasCurrentSubscription(establishmentId);
}

function denyInactiveBooking(res: { status: (status: number) => { json: (body: object) => unknown } }) {
  res.status(403).json({ error: 'Os agendamentos online deste estabelecimento estão temporariamente indisponíveis.' });
}

const uuid = z.uuid();
const tokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/) }).strict();
const requestSchema = z.object({
  serviceId: uuid,
  professionalId: uuid,
  startsAt: z.iso.datetime({ offset: true }),
  fullName: z.string().trim().min(2).max(120),
  email: z.email().max(255).transform((value) => value.toLowerCase()),
  website: z.string().max(200).optional().default('')
}).strict();

export const publicBookingRouter = Router();
const publicLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 6, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Muitas tentativas de agendamento. Tente novamente mais tarde.' }
});

publicBookingRouter.get('/establishments/:slug', async (req, res) => {
  const slug = z.string().regex(/^[a-z0-9-]{2,110}$/).safeParse(req.params.slug);
  if (!slug.success) { res.status(404).json({ error: 'Estabelecimento não encontrado.' }); return; }
  const establishment = await pool.query<{ id: string; name: string; slug: string; timezone: string; hasLogo: boolean }>(
    'SELECT id,name,slug,timezone,(logo_png IS NOT NULL) AS "hasLogo" FROM establishments WHERE slug=$1 AND active=true', [slug.data]);
  if (!establishment.rowCount) { res.status(404).json({ error: 'Estabelecimento não encontrado.' }); return; }
  const tenantId = establishment.rows[0]!.id;
  const [services, professionals] = await Promise.all([
    pool.query(`SELECT id,name,category,description,duration_minutes AS "durationMinutes",
                        price_cents AS "priceCents" FROM services
                WHERE establishment_id=$1 AND active=true ORDER BY name`, [tenantId]),
    pool.query(`SELECT p.id,p.full_name AS "fullName",array_agg(ps.service_id) AS "serviceIds"
                FROM professionals p JOIN professional_services ps
                  ON ps.establishment_id=p.establishment_id AND ps.professional_id=p.id
                JOIN services s ON s.establishment_id=p.establishment_id AND s.id=ps.service_id AND s.active=true
                WHERE p.establishment_id=$1 AND p.active=true GROUP BY p.id ORDER BY p.full_name`, [tenantId])
  ]);
  res.json({ establishment: { name: establishment.rows[0]!.name, slug: slug.data,
    timezone: establishment.rows[0]!.timezone, hasLogo: establishment.rows[0]!.hasLogo },
    services: services.rows, professionals: professionals.rows,
    onlineBookingEnabled: mailConfigured() && await onlineBookingPermitted(tenantId) });
});

publicBookingRouter.get('/establishments/:slug/availability', async (req, res) => {
  const slug = z.string().regex(/^[a-z0-9-]{2,110}$/).safeParse(req.params.slug);
  const params = z.object({ serviceId: uuid, date: z.iso.date(), professionalId: uuid.optional() }).safeParse(req.query);
  if (!slug.success || !params.success) { res.status(400).json({ error: 'Escolha um estabelecimento, serviço e data válidos.' }); return; }
  const establishment = await pool.query<{ id: string }>(
    'SELECT id FROM establishments WHERE slug=$1 AND active=true', [slug.data]);
  if (!establishment.rowCount) { res.status(404).json({ error: 'Estabelecimento não encontrado.' }); return; }
  if (!await onlineBookingPermitted(establishment.rows[0]!.id)) { denyInactiveBooking(res); return; }
  const options = await availableForService(pool, establishment.rows[0]!.id,
    params.data.serviceId, params.data.date, params.data.professionalId);
  if (!options) { res.status(404).json({ error: 'Serviço indisponível.' }); return; }
  res.json({ items: options.items });
});

publicBookingRouter.post('/establishments/:slug/requests', publicLimiter, async (req, res) => {
  if (!mailConfigured()) {
    res.status(503).json({ error: 'O agendamento online ainda não foi habilitado por este serviço.' }); return;
  }
  const slug = z.string().regex(/^[a-z0-9-]{2,110}$/).safeParse(req.params.slug);
  const parsed = requestSchema.safeParse(req.body);
  if (!slug.success || !parsed.success) { res.status(400).json({ error: 'Confira seus dados e o horário selecionado.' }); return; }
  const input = parsed.data;
  // Campo oculto para os robôs mais simples. Nenhum e-mail é enviado se estiver preenchido.
  if (input.website) { res.status(202).json({ sent: true }); return; }
  const establishment = await pool.query<{ id: string; name: string; timezone: string }>(
    'SELECT id,name,timezone FROM establishments WHERE slug=$1 AND active=true', [slug.data]);
  if (!establishment.rowCount) { res.status(404).json({ error: 'Estabelecimento não encontrado.' }); return; }
  const business = establishment.rows[0]!;
  if (!await onlineBookingPermitted(business.id)) { denyInactiveBooking(res); return; }
  const date = DateTime.fromISO(input.startsAt).setZone(business.timezone).toISODate()!;
  const availability = await availableForService(pool, business.id, input.serviceId, date, input.professionalId);
  if (!availability?.items[0]?.slots.some((slot) => new Date(slot.startsAt).getTime() === new Date(input.startsAt).getTime())) {
    res.status(409).json({ error: 'Horário indisponível. Escolha outro.' }); return;
  }
  const attempts = await pool.query<{ count: string }>(`
    SELECT count(*) FROM public_booking_requests
    WHERE establishment_id=$1 AND customer_email=$2 AND created_at>now()-interval '24 hours'
  `, [business.id, input.email]);
  if (Number(attempts.rows[0]!.count) >= 3) { res.status(429).json({ error: 'Limite diário de pedidos atingido para este e-mail.' }); return; }

  const token = newSessionToken();
  const saved = await pool.query<{ id: string }>(`
    INSERT INTO public_booking_requests(establishment_id,service_id,professional_id,customer_name,customer_email,starts_at,token_hash,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '20 minutes') RETURNING id
  `, [business.id,input.serviceId,input.professionalId,input.fullName,input.email,new Date(input.startsAt),sessionTokenHash(token)]);
  const confirmUrl = `${settings.webOrigin}/agendar/confirmar?token=${encodeURIComponent(token)}`;
  const localStart = DateTime.fromISO(input.startsAt).setZone(business.timezone).toFormat('dd/MM/yyyy HH:mm');
  try {
    await sendTransactionalEmail({
      to: input.email, subject: `Confirme seu agendamento — ${business.name}`,
      idempotencyKey: `beautybarber-booking-${saved.rows[0]!.id}`,
      html: `<div style="font-family:Arial,sans-serif;color:#20262D;line-height:1.6;max-width:560px">
        <h1 style="color:#244B50">Confirme seu horário</h1>
        <p>Olá, ${escapeHtml(input.fullName)}!</p>
        <p>Você solicitou um atendimento em <strong>${escapeHtml(business.name)}</strong> para <strong>${escapeHtml(localStart)}</strong>.</p>
        <p><a href="${confirmUrl}" style="display:inline-block;background:#244B50;color:#fff;padding:12px 18px;text-decoration:none">Confirmar meu e-mail e agendamento</a></p>
        <p>O link expira em 20 minutos. A vaga só será reservada depois da confirmação e pode ser ocupada por outra pessoa enquanto isso.</p>
        <p>Se não foi você, ignore esta mensagem.</p></div>`
    });
  } catch (error) {
    await pool.query('DELETE FROM public_booking_requests WHERE id=$1', [saved.rows[0]!.id]);
    console.error('[public-booking-mail]', error);
    res.status(503).json({ error: 'Não foi possível enviar a confirmação agora. Tente novamente.' }); return;
  }
  res.status(202).json({ sent: true });
});

publicBookingRouter.post('/confirm', publicLimiter, async (req, res) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Link de confirmação inválido.' }); return; }
  const client = await pool.connect();
  let confirmed: { id: string; email: string; fullName: string; establishmentName: string; zone: string; startsAt: Date; cancelToken: string } | null = null;
  try {
    await client.query('BEGIN');
    const result = await client.query<{
      id: string; establishment_id: string; service_id: string; professional_id: string;
      customer_name: string; customer_email: string; starts_at: Date; expires_at: Date; consumed_at: Date | null;
    }>('SELECT * FROM public_booking_requests WHERE token_hash=$1 FOR UPDATE', [sessionTokenHash(parsed.data.token)]);
    const request = result.rows[0];
    if (!request) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Solicitação não encontrada.' }); return; }
    if (request.consumed_at || request.expires_at.getTime() <= Date.now()) {
      await client.query('ROLLBACK'); res.status(410).json({ error: 'O link já foi utilizado ou expirou. Solicite um novo horário.' }); return;
    }
    const business = await client.query<{ name: string; timezone: string }>('SELECT name,timezone FROM establishments WHERE id=$1 AND active=true FOR SHARE', [request.establishment_id]);
    if (!business.rowCount) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Estabelecimento indisponível.' }); return; }
    if (!await onlineBookingPermitted(request.establishment_id)) {
      await client.query('ROLLBACK'); denyInactiveBooking(res); return;
    }
    await client.query('SELECT id FROM professionals WHERE establishment_id=$1 AND id=$2 FOR UPDATE', [request.establishment_id,request.professional_id]);
    const date = DateTime.fromJSDate(request.starts_at).setZone(business.rows[0]!.timezone).toISODate()!;
    const available = await availableForService(client, request.establishment_id, request.service_id, date, request.professional_id);
    const slot = available?.items[0]?.slots.find((item) => new Date(item.startsAt).getTime() === request.starts_at.getTime());
    if (!slot) { await client.query('ROLLBACK'); res.status(409).json({ error: 'O horário foi ocupado. Volte à agenda e escolha outro.' }); return; }
    let customer = await client.query<{ id: string }>(`
      SELECT id FROM customers WHERE establishment_id=$1 AND lower(email)=$2 AND active=true ORDER BY created_at LIMIT 1
    `, [request.establishment_id, request.customer_email]);
    if (!customer.rowCount) {
      customer = await client.query<{ id: string }>(`INSERT INTO customers(establishment_id,full_name,email)
        VALUES($1,$2,$3) RETURNING id`, [request.establishment_id,request.customer_name,request.customer_email]);
    }
    const cancelToken = newSessionToken();
    const booking = await client.query<{ id: string }>(`
      INSERT INTO appointments(establishment_id,service_id,professional_id,customer_id,starts_at,ends_at,price_cents,status,public_cancel_token_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8) RETURNING id
    `, [request.establishment_id,request.service_id,request.professional_id,customer.rows[0]!.id,
      new Date(slot.startsAt),new Date(slot.endsAt),available!.priceCents,sessionTokenHash(cancelToken)]);
    await client.query(`INSERT INTO appointment_history(establishment_id,appointment_id,event,current_status,current_starts_at)
      VALUES($1,$2,'created','pending',$3)`, [request.establishment_id,booking.rows[0]!.id,new Date(slot.startsAt)]);
    await client.query('UPDATE public_booking_requests SET consumed_at=now() WHERE id=$1', [request.id]);
    await client.query('COMMIT');
    confirmed = { id: booking.rows[0]!.id, email: request.customer_email, fullName: request.customer_name,
      establishmentName: business.rows[0]!.name, zone: business.rows[0]!.timezone, startsAt: request.starts_at, cancelToken };
  } catch (error) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error && 'code' in error && error.code === '23P01') {
      res.status(409).json({ error: 'Esse horário acabou de ser reservado. Escolha outro.' }); return;
    }
    throw error;
  } finally { client.release(); }

  if (confirmed) {
    const dateText = DateTime.fromJSDate(confirmed.startsAt).setZone(confirmed.zone).toFormat('dd/MM/yyyy HH:mm');
    const cancelUrl = `${settings.webOrigin}/agendar/cancelar?token=${encodeURIComponent(confirmed.cancelToken)}`;
    try {
      await sendTransactionalEmail({
        to: confirmed.email, subject: `Seu agendamento foi registrado — ${confirmed.establishmentName}`,
        idempotencyKey: `beautybarber-booking-confirmed-${confirmed.id}`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#20262D"><h1 style="color:#244B50">Agendamento registrado</h1>
          <p>Olá, ${escapeHtml(confirmed.fullName)}! Seu atendimento em <strong>${escapeHtml(confirmed.establishmentName)}</strong> foi registrado para ${escapeHtml(dateText)}.</p>
          <p>A equipe poderá confirmar o atendimento. Para cancelar antes do horário, <a href="${cancelUrl}">acesse este link seguro</a>.</p></div>`
      });
    } catch (error) { console.error('[public-booking-confirmation-mail]', error); }
    res.status(201).json({ booked: true, status: 'pending', establishmentName: confirmed.establishmentName, startsAt: confirmed.startsAt });
  }
});

publicBookingRouter.post('/cancel', publicLimiter, async (req, res) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Link de cancelamento inválido.' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await client.query<{ id: string; establishment_id: string; status: string; starts_at: Date }>(`
      SELECT id,establishment_id,status,starts_at FROM appointments WHERE public_cancel_token_hash=$1 FOR UPDATE
    `, [sessionTokenHash(parsed.data.token)]);
    const booking = row.rows[0];
    if (!booking) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Agendamento não encontrado.' }); return; }
    if (!['pending','confirmed'].includes(booking.status) || booking.starts_at.getTime() <= Date.now()) {
      await client.query('ROLLBACK'); res.status(409).json({ error: 'Este agendamento não pode mais ser cancelado pelo link.' }); return;
    }
    await client.query(`UPDATE appointments SET status='cancelled',public_cancel_token_hash=NULL,updated_at=now() WHERE id=$1`, [booking.id]);
    await client.query(`INSERT INTO appointment_history(establishment_id,appointment_id,event,previous_status,current_status,current_starts_at)
      VALUES($1,$2,'status_changed',$3,'cancelled',$4)`, [booking.establishment_id,booking.id,booking.status,booking.starts_at]);
    await client.query('COMMIT'); res.json({ cancelled: true });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});
