import type { NextFunction, Request, Response } from 'express';
import { pool } from './db.js';
import { settings } from './config.js';
import { isRestrictedMutation } from './subscription-policy.js';

type TenantSession = { establishmentId: string };

// Ativa somente depois de definir regras de teste, cobrança e inadimplência.
export async function hasCurrentSubscription(establishmentId: string): Promise<boolean> {
  const result = await pool.query<{ current: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM subscriptions
      WHERE establishment_id=$1 AND status='active' AND paid_through > now()
    ) AS current
  `, [establishmentId]);
  return result.rows[0]?.current === true;
}

export async function subscriptionAccess(req: Request, res: Response, next: NextFunction) {
  if (!settings.subscriptionEnforcement || !isRestrictedMutation(req.method, req.path)) {
    next();
    return;
  }
  try {
    const tenant = res.locals.auth as TenantSession;
    if (await hasCurrentSubscription(tenant.establishmentId)) {
      next();
      return;
    }
    res.status(403).json({
      code: 'SUBSCRIPTION_REQUIRED',
      error: 'É necessária uma assinatura ativa para alterar dados. Consulte a página Assinatura.'
    });
  } catch (error) {
    next(error);
  }
}
