import { Router, raw } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from './db.js';
import { isValidPngLogo } from './logo-validation.js';

export const publicBrandingRouter = Router();
export const privateBrandingRouter = Router();

// A página de agendamento deve poder mostrar a marca, sem expor detalhes da empresa.
publicBrandingRouter.get('/branding/:slug/logo', async (req,res) => {
  const slug = req.params.slug;
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 110) {
    res.status(404).end(); return;
  }
  const record = await pool.query<{ logo_png: Buffer | null }>(
    'SELECT logo_png FROM establishments WHERE slug=$1 AND active=TRUE', [slug]);
  const png = record.rows[0]?.logo_png;
  if (!png) { res.status(404).end(); return; }
  res.type('image/png').send(png);
});

const logoLimiter = rateLimit({ windowMs:60 * 60 * 1000, limit:20,
  standardHeaders:'draft-8', legacyHeaders:false,
  message:{error:'Muitas alterações de logotipo. Tente novamente mais tarde.'} });

privateBrandingRouter.put('/account/logo', logoLimiter, raw({type:'image/png',limit:'256kb'}), async (req,res) => {
  if (res.locals.auth.role !== 'owner') { res.status(403).json({error:'Somente o responsável pode alterar o logotipo.'}); return; }
  if (req.get('content-type') !== 'image/png' || !Buffer.isBuffer(req.body) || !isValidPngLogo(req.body)) {
    res.status(400).json({error:'Escolha um PNG válido de até 256 KB e com até 1024 × 1024 pixels.'}); return;
  }
  await pool.query('UPDATE establishments SET logo_png=$2 WHERE id=$1',
    [res.locals.auth.establishmentId,req.body]);
  res.json({saved:true});
});

privateBrandingRouter.delete('/account/logo', logoLimiter, async (_req,res) => {
  if (res.locals.auth.role !== 'owner') { res.status(403).json({error:'Somente o responsável pode remover o logotipo.'}); return; }
  await pool.query('UPDATE establishments SET logo_png=NULL WHERE id=$1', [res.locals.auth.establishmentId]);
  res.json({saved:true});
});

