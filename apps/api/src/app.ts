import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool } from './db.js';
import { settings } from './config.js';
import { hashPassword, newSessionToken, newSlug, sessionTokenHash, verifyPassword } from './security.js';
import { managementRouter } from './management.js';
import { billingRouter } from './billing.js';
import { calendarRouter } from './appointments.js';
import { publicBookingRouter } from './public-booking.js';
import { financeRouter } from './finance.js';
import { accountRouter, invitationPublicRouter } from './account.js';
import { escapeHtml, mailConfigured, sendTransactionalEmail } from './email.js';
import { subscriptionAccess } from './subscription-access.js';
import { publicBrandingRouter, privateBrandingRouter } from './branding.js';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
type Role = 'owner' | 'receptionist' | 'professional';
type TenantContext = {
  userId: string;
  fullName: string;
  email: string;
  establishmentId: string;
  establishmentName: string;
  establishmentSlug: string;
  establishmentTimezone: string;
  role: Role;
  isPlatformAdmin: boolean;
};

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.email().max(255).transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
  establishmentName: z.string().trim().min(2).max(160)
}).strict();
const loginSchema = z.object({
  email: z.email().max(255).transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(128)
}).strict();
const resetRequestSchema = z.object({ email: z.email().max(255).transform((v) => v.toLowerCase()) }).strict();
const resetConfirmSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/), password: z.string().min(12).max(128) }).strict();
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(128) }).strict();

export const app = express();
app.disable('x-powered-by');
if (settings.production) app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '16kb' }));

// Dados de clientes, sessões e assinaturas não devem ser armazenados em cache
// por navegadores ou proxies intermediários.
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// A aplicação web e a API são publicadas na mesma origem (Vite proxy em dev e Caddy na VPS).
// Requisições que alteram dados exigem Origin exata para mitigar CSRF por formulário externo.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('origin') !== settings.webOrigin) {
    res.status(403).json({ error: 'Origem da requisição não permitida.' });
    return;
  }
  next();
});

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos.' }
});

const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Limite de cadastros atingido. Tente novamente mais tarde.' }
});

function getCookie(req: Request): string | null {
  const header = req.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name === settings.cookieName) return part.slice(separator + 1).trim();
  }
  return null;
}

function setCookie(res: Response, token: string) {
  res.cookie(settings.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: settings.production,
    path: '/',
    maxAge: SESSION_DURATION_MS
  });
}

function clearCookie(res: Response) {
  res.clearCookie(settings.cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: settings.production,
    path: '/'
  });
}

async function createSession(
  client: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  userId: string,
  establishmentId: string
) {
  const token = newSessionToken();
  await client.query(
    'INSERT INTO sessions(token_hash, user_id, establishment_id, expires_at) VALUES ($1, $2, $3, $4)',
    [sessionTokenHash(token), userId, establishmentId, new Date(Date.now() + SESSION_DURATION_MS)]
  );
  return token;
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getCookie(req);
    if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
      res.status(401).json({ error: 'Entre na sua conta para continuar.' });
      return;
    }

    const result = await pool.query<{
      user_id: string; full_name: string; email: string; establishment_id: string;
      establishment_name: string; establishment_slug: string; establishment_timezone: string;
      role: Role; is_platform_admin: boolean;
    }>(`
      SELECT s.user_id, u.full_name, u.email, u.is_platform_admin, s.establishment_id,
             e.name AS establishment_name, e.slug AS establishment_slug,
             e.timezone AS establishment_timezone, m.role
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN memberships m ON m.user_id = s.user_id AND m.establishment_id = s.establishment_id
      JOIN establishments e ON e.id = s.establishment_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND m.active = TRUE AND e.active = TRUE
    `, [sessionTokenHash(token)]);

    const row = result.rows[0];
    if (!row) {
      res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
      return;
    }

    res.locals.auth = {
      userId: row.user_id,
      fullName: row.full_name,
      email: row.email,
      establishmentId: row.establishment_id,
      establishmentName: row.establishment_name,
      establishmentSlug: row.establishment_slug,
      establishmentTimezone: row.establishment_timezone,
      role: row.role,
      isPlatformAdmin: row.is_platform_admin
    } satisfies TenantContext;
    next();
  } catch (error) {
    next(error);
  }
}

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/register', registerRateLimit, async (req, res, next) => {
  try {
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Confira nome, e-mail, estabelecimento e senha (mínimo 12 caracteres).' });
      return;
    }

    const { fullName, email, password, establishmentName } = validation.data;
    const passwordHash = await hashPassword(password);
    const slug = newSlug(establishmentName, randomBytes(4).toString('hex'));
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const business = await client.query<{ id: string }>(
        'INSERT INTO establishments (name, slug) VALUES ($1, $2) RETURNING id',
        [establishmentName, slug]
      );
      const user = await client.query<{ id: string }>(
        'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [fullName, email, passwordHash]
      );
      const establishmentId = business.rows[0]!.id;
      const userId = user.rows[0]!.id;
      await client.query(
        "INSERT INTO memberships(establishment_id, user_id, role) VALUES ($1, $2, 'owner')",
        [establishmentId, userId]
      );
      const token = await createSession(client, userId, establishmentId);
      await client.query('COMMIT');
      setCookie(res, token);
      res.status(201).json({ user: { fullName, email, role: 'owner' }, establishment: { name: establishmentName, slug } });
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
        res.status(409).json({ error: 'E-mail já cadastrado ou identificador indisponível.' });
        return;
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', authRateLimit, async (req, res, next) => {
  try {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Informe um e-mail e uma senha válidos.' });
      return;
    }
    const { email, password } = validation.data;
    const result = await pool.query<{
      id: string; password_hash: string; full_name: string; establishment_id: string; name: string; slug: string; role: Role;
    }>(`
      SELECT u.id, u.password_hash, u.full_name, m.establishment_id, e.name, e.slug, m.role
      FROM users u
      JOIN memberships m ON m.user_id = u.id AND m.active = TRUE
      JOIN establishments e ON e.id = m.establishment_id AND e.active = TRUE
      WHERE u.email = $1
      ORDER BY m.created_at ASC
      LIMIT 1
    `, [email]);
    const row = result.rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      return;
    }
    const token = await createSession(pool, row.id, row.establishment_id);
    setCookie(res, token);
    res.json({ user: { fullName: row.full_name, email, role: row.role }, establishment: { name: row.name, slug: row.slug } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/reset-request', authRateLimit, async (req, res, next) => {
  try {
    const parsed = resetRequestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Informe um e-mail válido.' }); return; }
    // Não revelar se a conta existe. Envios dependem de um domínio Resend configurado.
    const result = await pool.query<{ id: string; full_name: string }>(
      'SELECT id,full_name FROM users WHERE email=$1', [parsed.data.email]);
    if (result.rowCount && mailConfigured()) {
      const user = result.rows[0]!;
      const token = newSessionToken();
      const saved = await pool.query<{ id: string }>(`
        INSERT INTO password_reset_tokens(user_id,token_hash,expires_at)
        VALUES($1,$2,now()+interval '30 minutes') RETURNING id
      `, [user.id,sessionTokenHash(token)]);
      const link = `${settings.webOrigin}/redefinir-senha?token=${encodeURIComponent(token)}`;
      try {
        await sendTransactionalEmail({ to: parsed.data.email,subject:'Recuperação de senha — BeautyBarber',
          idempotencyKey:`beautybarber-password-reset-${saved.rows[0]!.id}`,
          html:`<div style="font-family:Arial,sans-serif;color:#20262D;line-height:1.7"><h1 style="color:#244B50">Redefinir senha</h1>
            <p>Olá, ${escapeHtml(user.full_name)}.</p><p>Para criar uma nova senha, <a href="${link}">acesse este link seguro</a>.</p>
            <p>O link expira em 30 minutos. Caso não tenha solicitado, ignore o e-mail.</p></div>` });
      } catch (error) {
        await pool.query('DELETE FROM password_reset_tokens WHERE id=$1', [saved.rows[0]!.id]);
        console.error('[password-reset-email]',error);
      }
    }
    res.status(202).json({ message: 'Se o e-mail estiver cadastrado e o serviço estiver configurado, enviaremos as instruções.' });
  } catch (error) { next(error); }
});

app.post('/api/auth/reset-password', authRateLimit, async (req, res, next) => {
  try {
    const parsed = resetConfirmSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Link inválido ou senha insegura. Use pelo menos 12 caracteres.' }); return; }
    const newHash = await hashPassword(parsed.data.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const token = await client.query<{ id: string; user_id: string }>(`
        SELECT id,user_id FROM password_reset_tokens
        WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE
      `, [sessionTokenHash(parsed.data.token)]);
      if (!token.rowCount) { await client.query('ROLLBACK'); res.status(410).json({ error: 'O link já foi utilizado ou expirou.' }); return; }
      await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [token.rows[0]!.user_id,newHash]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [token.rows[0]!.user_id]);
      await client.query('UPDATE password_reset_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL', [token.rows[0]!.user_id]);
      await client.query('COMMIT'); res.json({ reset: true });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } catch (error) { next(error); }
});

app.post('/api/auth/change-password', requireAuth, authRateLimit, async (req, res, next) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Informe sua senha atual e uma nova senha com no mínimo 12 caracteres.' }); return; }
    const identity = res.locals.auth as TenantContext;
    const current = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [identity.userId]);
    if (!current.rowCount || !(await verifyPassword(parsed.data.currentPassword,current.rows[0]!.password_hash))) {
      res.status(401).json({ error: 'Senha atual incorreta.' }); return;
    }
    const hash = await hashPassword(parsed.data.newPassword);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [identity.userId,hash]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [identity.userId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    clearCookie(res); res.json({ changed: true, signedOut: true });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    const token = getCookie(req);
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sessionTokenHash(token)]);
    clearCookie(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', requireAuth, (_req, res) => {
  res.json({ account: res.locals.auth as TenantContext });
});

app.get('/api/auth/establishments', requireAuth, async (_req,res,next) => {
  try {
    const identity = res.locals.auth as TenantContext;
    const results = await pool.query(`SELECT e.id,e.name,e.slug,m.role
      FROM memberships m JOIN establishments e ON e.id=m.establishment_id
      WHERE m.user_id=$1 AND m.active=true AND e.active=true ORDER BY m.created_at ASC`, [identity.userId]);
    res.json({ items: results.rows });
  } catch (error) { next(error); }
});

app.post('/api/auth/switch-establishment', requireAuth, async (req,res,next) => {
  try {
    const parsed = z.object({ establishmentId:z.uuid() }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Escolha um estabelecimento válido.' }); return; }
    const identity = res.locals.auth as TenantContext;
    const found = await pool.query(`SELECT 1 FROM memberships m JOIN establishments e ON e.id=m.establishment_id
      WHERE m.user_id=$1 AND m.establishment_id=$2 AND m.active=true AND e.active=true`,
      [identity.userId,parsed.data.establishmentId]);
    if (!found.rowCount) { res.status(403).json({ error: 'Você não tem acesso a esse estabelecimento.' }); return; }
    const token = getCookie(req);
    if (!token) { res.status(401).json({ error: 'Sua sessão expirou.' }); return; }
    await pool.query('UPDATE sessions SET establishment_id=$2 WHERE token_hash=$1 AND user_id=$3',
      [sessionTokenHash(token),parsed.data.establishmentId,identity.userId]);
    res.json({ changed:true });
  } catch (error) { next(error); }
});

app.get('/api/overview', requireAuth, async (_req, res) => {
  const account = res.locals.auth as TenantContext;
  if (account.role === 'professional') {
    res.json({
      establishment: { id: account.establishmentId, name: account.establishmentName, slug: account.establishmentSlug },
      user: { name: account.fullName, role: account.role },
      nextSteps: [], counts: { services: 0, professionals: 0, customers: 0 },
      metrics: { today: 0, pending: 0, completed: 0, cancelled: 0, noShow: 0, receivedCents: 0 },
      upcoming: [], publicBookingPath: `/agendar/${account.establishmentSlug}`
    });
    return;
  }
  const result = await pool.query<{ services: string; professionals: string; customers: string; working_hours: string; establishment_hours: string }>(`
    SELECT
      (SELECT count(*) FROM services WHERE establishment_id=$1 AND active=true) AS services,
      (SELECT count(*) FROM professionals WHERE establishment_id=$1 AND active=true) AS professionals,
      (SELECT count(*) FROM customers WHERE establishment_id=$1 AND active=true) AS customers,
      (SELECT count(*) FROM working_hours wh JOIN professionals p
        ON p.establishment_id=wh.establishment_id AND p.id=wh.professional_id
        WHERE wh.establishment_id=$1 AND p.active=true) AS working_hours,
      (SELECT count(*) FROM establishment_hours WHERE establishment_id=$1) AS establishment_hours
  `, [account.establishmentId]);
  const counts = result.rows[0]!;
  const services = Number(counts.services);
  const professionals = Number(counts.professionals);
  const customers = Number(counts.customers);
  const workingHours = Number(counts.working_hours);
  const openingHours = Number(counts.establishment_hours);
  const [day, upcoming] = await Promise.all([
    pool.query<{
      today: string; pending: string; completed: string; cancelled: string; no_show: string; received_cents: string;
    }>(`
      SELECT
        (SELECT count(*) FROM appointments a JOIN establishments e ON e.id=a.establishment_id
          WHERE a.establishment_id=$1 AND (a.starts_at AT TIME ZONE e.timezone)::date=(now() AT TIME ZONE e.timezone)::date)::text AS today,
        (SELECT count(*) FROM appointments a JOIN establishments e ON e.id=a.establishment_id
          WHERE a.establishment_id=$1 AND a.status='pending' AND (a.starts_at AT TIME ZONE e.timezone)::date=(now() AT TIME ZONE e.timezone)::date)::text AS pending,
        (SELECT count(*) FROM appointments a JOIN establishments e ON e.id=a.establishment_id
          WHERE a.establishment_id=$1 AND a.status='completed' AND (a.starts_at AT TIME ZONE e.timezone)::date=(now() AT TIME ZONE e.timezone)::date)::text AS completed,
        (SELECT count(*) FROM appointments a JOIN establishments e ON e.id=a.establishment_id
          WHERE a.establishment_id=$1 AND a.status='cancelled' AND (a.starts_at AT TIME ZONE e.timezone)::date=(now() AT TIME ZONE e.timezone)::date)::text AS cancelled,
        (SELECT count(*) FROM appointments a JOIN establishments e ON e.id=a.establishment_id
          WHERE a.establishment_id=$1 AND a.status='no_show' AND (a.starts_at AT TIME ZONE e.timezone)::date=(now() AT TIME ZONE e.timezone)::date)::text AS no_show,
        (SELECT COALESCE(sum(pr.amount_cents),0)::text FROM payment_records pr JOIN establishments e ON e.id=pr.establishment_id
          WHERE pr.establishment_id=$1 AND pr.status='recorded' AND (pr.received_at AT TIME ZONE e.timezone)::date=(now() AT TIME ZONE e.timezone)::date) AS received_cents
    `, [account.establishmentId]),
    pool.query(`
      SELECT a.id,c.full_name AS "customerName",s.name AS "serviceName",p.full_name AS "professionalName",
             a.starts_at AS "startsAt",a.status
      FROM appointments a JOIN customers c ON c.establishment_id=a.establishment_id AND c.id=a.customer_id
      JOIN services s ON s.establishment_id=a.establishment_id AND s.id=a.service_id
      JOIN professionals p ON p.establishment_id=a.establishment_id AND p.id=a.professional_id
      WHERE a.establishment_id=$1 AND a.starts_at>=now() AND a.status IN('pending','confirmed')
      ORDER BY a.starts_at LIMIT 8
    `, [account.establishmentId])
  ]);
  const metrics = day.rows[0]!;
  res.json({
    establishment: { id: account.establishmentId, name: account.establishmentName, slug: account.establishmentSlug },
    user: { name: account.fullName, role: account.role },
    nextSteps: [
      { label: 'Cadastre os serviços', completed: services > 0, href: '/painel/servicos' },
      { label: 'Defina o funcionamento do salão', completed: openingHours > 0, href: '/painel/configuracoes' },
      { label: 'Profissionais e seus expedientes', completed: professionals > 0 && workingHours > 0, href: '/painel/profissionais' }
    ],
    counts: { services, professionals, customers },
    metrics: {
      today: Number(metrics.today), pending: Number(metrics.pending), completed: Number(metrics.completed),
      cancelled: Number(metrics.cancelled), noShow: Number(metrics.no_show), receivedCents: Number(metrics.received_cents)
    },
    upcoming: upcoming.rows,
    publicBookingPath: `/agendar/${account.establishmentSlug}`
  });
});

app.use('/api/public', publicBookingRouter);
app.use('/api/public', invitationPublicRouter);
app.use('/api', publicBrandingRouter);
app.use('/api', requireAuth, subscriptionAccess);
app.use('/api', managementRouter);
app.use('/api', billingRouter);
app.use('/api', calendarRouter);
app.use('/api', financeRouter);
app.use('/api', accountRouter);
app.use('/api', privateBrandingRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api]', error);
  if (res.headersSent) return;
  if (typeof error === 'object' && error && 'status' in error && error.status === 413) {
    res.status(413).json({ error:'Arquivo muito grande. Envie uma imagem PNG de até 256 KB.' }); return;
  }
  res.status(500).json({ error: 'Não foi possível concluir a operação. Tente novamente.' });
});

