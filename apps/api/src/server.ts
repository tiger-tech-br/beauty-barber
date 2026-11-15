import { app } from './app.js';
import { settings } from './config.js';
import { pool } from './db.js';

const server = app.listen(settings.port, '0.0.0.0', () => {
  console.log(`API disponível na porta ${settings.port}`);
});

async function shutdown() {
  server.close();
  await pool.end();
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

