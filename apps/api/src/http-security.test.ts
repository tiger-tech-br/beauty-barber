import assert from 'node:assert/strict';
import { test } from 'node:test';

test('rotas privadas recusam ausência de sessão e mutações exigem origem correta', async () => {
  // Este teste não abre conexão com PostgreSQL: o middleware responde antes de
  // consultar a sessão. Uma URL inválida para produção basta para criar o pool.
  process.env.DATABASE_URL ??= 'postgresql://ignored:ignored@127.0.0.1:5432/beautybarber_test';
  process.env.WEB_ORIGIN = 'http://localhost:5173';
  const { app } = await import('./app.js');
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;

    const unauthorized = await fetch(`${base}/api/services`);
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get('cache-control'), 'no-store');

    const csrf = await fetch(`${base}/api/services`, {
      method: 'POST', headers: { Origin: 'https://external.invalid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ataque' })
    });
    assert.equal(csrf.status, 403);
    assert.equal(csrf.headers.get('cache-control'), 'no-store');

    const validOrigin = await fetch(`${base}/api/services`, {
      method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(validOrigin.status, 401);

    const exportWithoutSession = await fetch(`${base}/api/account/export`, {
      method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'senha-inexistente' })
    });
    assert.equal(exportWithoutSession.status, 401, 'Exportação privada exige sessão autenticada.');
    assert.equal(exportWithoutSession.headers.get('cache-control'), 'no-store');

    const exportWrongOrigin = await fetch(`${base}/api/account/export`, {
      method: 'POST', headers: { Origin: 'https://outro-site.invalid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'senha-inexistente' })
    });
    assert.equal(exportWrongOrigin.status, 403, 'Exportação deve obedecer à proteção de origem.');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
