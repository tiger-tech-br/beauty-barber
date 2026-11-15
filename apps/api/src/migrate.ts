import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from './db.js';

async function migrate() {
  const folder = join(process.cwd(), 'migrations');
  const files = (await readdir(folder)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock(4161, 2026)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    for (const filename of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
      if (applied.rowCount) continue;

      const sql = await readFile(join(folder, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`Migração aplicada: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(4161, 2026)').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

migrate().catch((error: unknown) => {
  console.error('Não foi possível aplicar migrations:', error);
  process.exitCode = 1;
});

