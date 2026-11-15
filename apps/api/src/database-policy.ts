// Isolamento defensivo: evita usar acidentalmente DATABASE_URL do PetCore ou outro produto.
// Complementa a separação de volumes/serviços Docker; não substitui permissões PostgreSQL.
export function beautyBarberDatabaseName(connectionString: string, production: boolean): string {
  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new Error('DATABASE_URL precisa ser uma URL PostgreSQL válida.'); }

  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL deve utilizar o protocolo PostgreSQL.');
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  const valid = production ? database === 'beautybarber' : /^beautybarber(?:_test|_staging)?$/.test(database);
  if (!valid) {
    throw new Error(`BLOQUEADO: BeautyBarber não pode utilizar o banco '${database || '(vazio)'}'. ` +
      (production ? 'Em produção, use apenas beautybarber.' : 'Use beautybarber, beautybarber_test ou beautybarber_staging.'));
  }
  return database;
}
