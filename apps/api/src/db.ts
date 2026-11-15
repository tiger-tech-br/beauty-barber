import pg from 'pg';
import { settings } from './config.js';

export const pool = new pg.Pool({
  connectionString: settings.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

