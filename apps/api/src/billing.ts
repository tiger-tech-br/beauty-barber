import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { pool } from './db.js';

type Account = { userId: string; establishmentId: string; role: 'owner' | 'receptionist' | 'professional'; isPlatformAdmin: boolean };
type Cycle = 'monthly' | 'annual';

export const checkoutLinks: Record<Cycle, string> = {
  monthly: 'https://pag.ae/82miujJ7H',
  annual: 'https://pag.ae/82miv8vhM'
};

const cycleSchema = z.object({ cycle: z.enum(['monthly', 'annual']) }).strict();
const reviewRequestSchema = z.object({
  cycle: z.enum(['monthly', 'annual']),
  billingEmail: z.email().max(255).transform((value) => value.toLowerCase()),
  externalReference: z.string().trim().max(120).optional().default('')
}).strict();
const decisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approve'),
    paidThrough: z.iso.date(),
    externalReference: z.string().trim().min(5).max(120),
    note: z.string().trim().max(400).optional().default('')
  }).strict(),
  z.object({
    decision: z.literal('reject'),
    note: z.string().trim().min(5).max(400)
  }).strict()
]);
const subscriptionStatusSchema = z.object({
  action: z.enum(['suspend', 'reactivate']),
  note: z.string().trim().min(5).max(400)
}).strict();

function account(res: { locals: Record<string, unknown> }): Account {
  return res.locals.auth as Account;
}

function ownerOnly(res: { locals: Record<string, unknown>; status: (code: number) => { json: (body: object) => unknown } }): boolean {
  if (account(res).role === 'owner') return true;
  res.status(403).json({ error: 'Somente o responsável pode administrar a assinatura.' });
  return false;
}

function platformOnly(res: { locals: Record<string, unknown>; status: (code: number) => { json: (body: object) => unknown } }): boolean {
  if (account(res).isPlatformAdmin) return true;
  res.status(403).json({ error: 'Acesso restrito à administração da plataforma.' });
  return false;
}

export const billingRouter = Router();
const reviewRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Limite de solicitações atingido. Aguarde antes de tentar novamente.' }
});

billingRouter.get('/billing', async (_req, res) => {
  if (!ownerOnly(res)) return;
  const tenant = account(res).establishmentId;
  const [subscription, requests] = await Promise.all([
    pool.query(`SELECT billing_cycle AS "billingCycle", status, external_reference AS "externalReference",
                 active_since AS "activeSince", paid_through AS "paidThrough",
                 (status = 'active' AND paid_through > now()) AS "isCurrent"
                FROM subscriptions WHERE establishment_id = $1`, [tenant]),
    pool.query(`SELECT id, billing_cycle AS "billingCycle", billing_email AS "billingEmail",
                 external_reference AS "externalReference", status, review_note AS "reviewNote",
                 created_at AS "createdAt", reviewed_at AS "reviewedAt"
                FROM subscription_requests WHERE establishment_id = $1 ORDER BY created_at DESC LIMIT 20`, [tenant])
  ]);
  res.json({
    plans: [
      { cycle: 'monthly', name: 'Mensal', checkoutUrl: checkoutLinks.monthly },
      { cycle: 'annual', name: 'Anual', checkoutUrl: checkoutLinks.annual }
    ],
    subscription: subscription.rows[0] ?? null,
    requests: requests.rows,
    verificationMode: 'manual'
  });
});

billingRouter.post('/billing/checkout', reviewRateLimit, async (req, res) => {
  if (!ownerOnly(res)) return;
  const parsed = cycleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Escolha o plano mensal ou anual.' }); return; }
  const identity = account(res);
  await pool.query(`INSERT INTO billing_events(establishment_id, actor_user_id, event, details)
                    VALUES ($1,$2,'checkout_started',$3::jsonb)`,
    [identity.establishmentId, identity.userId, JSON.stringify({ cycle: parsed.data.cycle })]);
  res.json({ checkoutUrl: checkoutLinks[parsed.data.cycle] });
});

billingRouter.post('/billing/verification', reviewRateLimit, async (req, res) => {
  if (!ownerOnly(res)) return;
  const parsed = reviewRequestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Informe o ciclo e o e-mail utilizado no PagBank.' }); return; }
  const identity = account(res);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM subscription_requests WHERE establishment_id=$1 AND status=$2 LIMIT 1 FOR UPDATE', [identity.establishmentId, 'pending']);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Já existe uma solicitação de conferência pendente para sua empresa.' });
      return;
    }
    const created = await client.query<{ id: string }>(`
      INSERT INTO subscription_requests(establishment_id, requested_by_user_id, billing_cycle, billing_email, external_reference)
      VALUES ($1,$2,$3,$4,$5) RETURNING id
    `, [identity.establishmentId, identity.userId, parsed.data.cycle, parsed.data.billingEmail, parsed.data.externalReference || null]);
    await client.query(`INSERT INTO billing_events(establishment_id, actor_user_id, request_id, event)
                        VALUES ($1,$2,$3,'verification_requested')`,
      [identity.establishmentId, identity.userId, created.rows[0]!.id]);
    await client.query('COMMIT');
    res.status(201).json({ id: created.rows[0]!.id, status: 'pending' });
  } catch (error) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      res.status(409).json({ error: 'Já existe uma solicitação pendente para sua empresa.' }); return;
    }
    throw error;
  }
  finally { client.release(); }
});

billingRouter.get('/platform/billing-requests', async (_req, res) => {
  if (!platformOnly(res)) return;
  const result = await pool.query(`
    SELECT sr.id, sr.establishment_id AS "establishmentId", e.name AS "establishmentName",
           sr.billing_cycle AS "billingCycle", sr.billing_email AS "billingEmail",
           sr.external_reference AS "externalReference", sr.created_at AS "createdAt",
           u.full_name AS "requestedBy", sr.status
    FROM subscription_requests sr
    JOIN establishments e ON e.id = sr.establishment_id
    JOIN users u ON u.id = sr.requested_by_user_id
    WHERE sr.status = 'pending' ORDER BY sr.created_at ASC LIMIT 200
  `);
  res.json({ items: result.rows });
});

billingRouter.get('/platform/establishments', async (_req, res) => {
  if (!platformOnly(res)) return;
  const data = await pool.query(`
    SELECT e.id,e.name,e.slug,e.active,e.created_at AS "createdAt",
      s.status AS "subscriptionStatus",s.billing_cycle AS "billingCycle",
      s.paid_through AS "paidThrough",
      (s.status='active' AND s.paid_through>now()) AS "subscriptionCurrent"
    FROM establishments e LEFT JOIN subscriptions s ON s.establishment_id=e.id
    ORDER BY e.created_at DESC LIMIT 200
  `);
  const counts = await pool.query(`
    SELECT count(*)::integer AS total,
      count(*) FILTER(WHERE s.status='active' AND s.paid_through>now())::integer AS current,
      count(*) FILTER(WHERE s.status='suspended')::integer AS suspended
    FROM establishments e LEFT JOIN subscriptions s ON s.establishment_id=e.id
  `);
  res.json({ items: data.rows, summary: counts.rows[0] });
});

billingRouter.patch('/platform/subscriptions/:id/status', async (req, res) => {
  if (!platformOnly(res)) return;
  const id = z.uuid().safeParse(req.params.id);
  const parsed = subscriptionStatusSchema.safeParse(req.body);
  if (!id.success || !parsed.success) {
    res.status(400).json({ error: 'Informe estabelecimento, ação e motivo válido.' }); return;
  }
  const admin = account(res);
  const { action, note } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ status: string; paid_through: Date }>(`
      SELECT status,paid_through FROM subscriptions WHERE establishment_id=$1 FOR UPDATE
    `, [id.data]);
    if (!current.rowCount) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Nenhuma assinatura conferida para esse estabelecimento.' }); return;
    }
    const subscription = current.rows[0]!;
    const requiredStatus = action === 'suspend' ? 'active' : 'suspended';
    if (subscription.status !== requiredStatus || (action === 'reactivate' && subscription.paid_through.getTime() <= Date.now())) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Ação não permitida: confira o status e a validade no PagBank.' }); return;
    }
    const nextStatus = action === 'suspend' ? 'suspended' : 'active';
    await client.query(`UPDATE subscriptions SET status=$2,updated_at=now() WHERE establishment_id=$1`, [id.data,nextStatus]);
    await client.query(`INSERT INTO billing_events(establishment_id,actor_user_id,event,details)
      VALUES($1,$2,$3,$4::jsonb)`,
      [id.data,admin.userId,action === 'suspend' ? 'subscription_suspended' : 'subscription_reactivated',JSON.stringify({ note })]);
    await client.query('COMMIT');
    res.json({ status: nextStatus });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});

billingRouter.post('/platform/billing-requests/:id/review', async (req, res) => {
  if (!platformOnly(res)) return;
  const id = z.uuid().safeParse(req.params.id);
  const parsed = decisionSchema.safeParse(req.body);
  if (!id.success || !parsed.success) { res.status(400).json({ error: 'Confira a solicitação, decisão e comprovante de conferência.' }); return; }
  const identity = account(res);
  const decision = parsed.data;
  const endsAt = decision.decision === 'approve'
    ? DateTime.fromISO(decision.paidThrough, { zone: 'America/Sao_Paulo' }).endOf('day') : null;
  if (endsAt && (!endsAt.isValid || endsAt.toMillis() <= Date.now())) {
    res.status(400).json({ error: 'A data de validade precisa ser futura e conferida no PagBank.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const item = await client.query<{ establishment_id: string; billing_cycle: Cycle }>(
      `SELECT establishment_id, billing_cycle FROM subscription_requests WHERE id=$1 AND status='pending' FOR UPDATE`, [id.data]);
    if (!item.rowCount) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Solicitação pendente não encontrada.' });
      return;
    }
    const establishment = item.rows[0]!;
    await client.query(`UPDATE subscription_requests SET status=$2, review_note=$3,
      reviewed_by_user_id=$4, reviewed_at=now(), updated_at=now(),
      external_reference=COALESCE($5, external_reference) WHERE id=$1`,
      [id.data, decision.decision === 'approve' ? 'approved' : 'rejected', decision.note || null,
        identity.userId, decision.decision === 'approve' ? decision.externalReference : null]);
    if (decision.decision === 'approve') {
      await client.query(`INSERT INTO subscriptions(establishment_id,billing_cycle,status,external_reference,active_since,paid_through,verified_by_user_id)
        VALUES ($1,$2,'active',$3,now(),$4,$5)
        ON CONFLICT(establishment_id) DO UPDATE SET billing_cycle=EXCLUDED.billing_cycle,status='active',
        external_reference=EXCLUDED.external_reference,active_since=EXCLUDED.active_since,
        paid_through=EXCLUDED.paid_through,verified_by_user_id=EXCLUDED.verified_by_user_id,updated_at=now()`,
        [establishment.establishment_id, establishment.billing_cycle, decision.externalReference, endsAt!.toJSDate(), identity.userId]);
    }
    await client.query(`INSERT INTO billing_events(establishment_id,request_id,actor_user_id,event,details)
      VALUES($1,$2,$3,$4,$5::jsonb)`,
      [establishment.establishment_id, id.data, identity.userId,
        decision.decision === 'approve' ? 'request_approved' : 'request_rejected',
        JSON.stringify(decision.decision === 'approve' ? { paidThrough: decision.paidThrough } : { note: decision.note })]);
    await client.query('COMMIT');
    res.json({ reviewed: true });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});
