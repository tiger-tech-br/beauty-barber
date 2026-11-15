import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { beautyBarberDatabaseName } from './database-policy.js';

loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const production = process.env.NODE_ENV === 'production';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL não definida. Crie .env na raiz do projeto.');
}
beautyBarberDatabaseName(databaseUrl,production);

const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
if (production && !webOrigin.startsWith('https://')) {
  throw new Error('WEB_ORIGIN deve utilizar HTTPS em produção.');
}

export const settings = {
  production,
  port: Number(process.env.PORT ?? 3001),
  databaseUrl,
  webOrigin,
  cookieName: process.env.SESSION_COOKIE_NAME ?? 'studio_session',
  subscriptionEnforcement: process.env.SUBSCRIPTION_ENFORCEMENT === 'true',
  resendApiKey: process.env.RESEND_API_KEY,
  resendFrom: process.env.RESEND_FROM
};

