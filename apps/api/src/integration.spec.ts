// Execute SOMENTE em banco de testes com nome terminado em _test,
// após aplicar as migrations nele. Este teste cria e remove seus próprios registros.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { DateTime } from 'luxon';

const raw = process.env.TEST_DATABASE_URL;
if (!raw || !decodeURIComponent(new URL(raw).pathname).endsWith('_test')) {
  throw new Error('BLOQUEADO: TEST_DATABASE_URL deve apontar para um banco terminando com _test.');
}
process.env.DATABASE_URL = raw;
process.env.WEB_ORIGIN = 'http://localhost:5173';

test('isolamento de serviços e associações entre empresas', { timeout: 90000 }, async () => {
  const [{ app }, { pool }] = await Promise.all([import('./app.js'), import('./db.js')]);
  const schema = await pool.query<{ services: string | null }>("SELECT to_regclass('public.services')::text AS services");
  assert.ok(schema.rows[0]?.services, 'Aplique as migrations no banco de testes antes de continuar.');

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta de testes inválida.');
  const base = `http://127.0.0.1:${address.port}`;
  const marker = randomBytes(6).toString('hex');
  const emails = [`teste-a-${marker}@exemplo.invalid`, `teste-b-${marker}@exemplo.invalid`];
  const slugs: string[] = [];

  async function request(path: string, method = 'GET', cookie = '', body?: unknown, origin = 'http://localhost:5173') {
    const route = new URL(path, base).pathname.replace(/[a-f0-9-]{30,}/gi, ':id');
    console.log(`[integration] ${method} ${route}`);
    const response = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), Origin: origin },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000)
    });
    console.log(`[integration] ${response.status} ${route}`);
    return response;
  }

  async function register(name: string, email: string) {
    const res = await request('/api/auth/register', 'POST', '', { fullName: 'Teste Isolamento', establishmentName: name, email, password: 'senha-segura-para-testar' });
    const data = await res.json() as { establishment: { slug: string } };
    assert.equal(res.status, 201, JSON.stringify(data));
    slugs.push(data.establishment.slug);
    const cookie = res.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'O servidor deve criar um cookie de sessão.');
    return cookie;
  }

  try {
    const cookieA = await register(`Negócio A ${marker}`, emails[0]!);
    const cookieB = await register(`Negócio B ${marker}`, emails[1]!);

    const ownAccount = await request('/api/auth/me', 'GET', cookieA);
    assert.equal(ownAccount.status, 200);
    const ownData = await ownAccount.json() as { account: { establishmentTimezone: string } };
    assert.equal(ownData.account.establishmentTimezone, 'America/Sao_Paulo');

    // A identidade do estabelecimento deve ficar isolada por empresa, inclusive na rota pública.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l+pQAAAAASUVORK5CYII=','base64');
    const logoPathA = `/api/branding/${slugs[0]}/logo`;
    const logoPathB = `/api/branding/${slugs[1]}/logo`;
    assert.equal((await request(logoPathA)).status,404);
    const uploadLogo = (cookie: string, bytes: Buffer) => fetch(base+'/api/account/logo',{
      method:'PUT', headers:{Cookie:cookie,Origin:'http://localhost:5173','Content-Type':'image/png'},
      body:Uint8Array.from(bytes).buffer
    });
    assert.equal((await uploadLogo('',png)).status,401);
    assert.equal((await uploadLogo(cookieA,Buffer.from('arquivo inválido'))).status,400);
    assert.equal((await uploadLogo(cookieA,png)).status,200);
    const publicLogo = await request(logoPathA);
    assert.equal(publicLogo.status,200);
    assert.equal(publicLogo.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await publicLogo.arrayBuffer()),png);
    assert.equal((await request(logoPathB)).status,404,'A imagem de uma empresa não pode aparecer na página de outra.');
    assert.equal((await request('/api/account/logo','DELETE',cookieA)).status,200);
    assert.equal((await request(logoPathA)).status,404);

    // Política de assinatura é opcional; com a opção ativada, estabelecimentos
    // sem pagamento confirmado só leem dados e solicitam conferência de cobrança.
    const { settings } = await import('./config.js');
    settings.subscriptionEnforcement = true;
    try {
      const forbiddenCreate = await request('/api/services', 'POST', cookieA, {
        name: 'Bloqueado sem assinatura', category: 'cabelo', durationMinutes: 30, priceCents: 2000, active: true
      });
      assert.equal(forbiddenCreate.status, 403);
      assert.equal((await forbiddenCreate.json() as { code: string }).code, 'SUBSCRIPTION_REQUIRED');
      assert.equal((await request('/api/services', 'GET', cookieA)).status, 200);
      assert.equal((await request('/api/billing/checkout', 'POST', cookieA, { cycle: 'annual' })).status, 200);
      const bookingPage = await request(`/api/public/establishments/${slugs[0]}`);
      assert.equal(bookingPage.status, 200);
      const bookingData = await bookingPage.json() as { onlineBookingEnabled: boolean; establishment: { timezone: string } };
      assert.equal(bookingData.onlineBookingEnabled, false);
      assert.equal(bookingData.establishment.timezone, 'America/Sao_Paulo');
    } finally {
      settings.subscriptionEnforcement = false;
    }

    const created = await request('/api/services', 'POST', cookieA, {
      name: 'Corte teste', category: 'cabelo', durationMinutes: 40, priceCents: 3500, active: true
    });
    assert.equal(created.status, 201);
    const { id } = await created.json() as { id: string };

    const listA = await request('/api/services', 'GET', cookieA);
    assert.equal((await listA.json() as { items: unknown[] }).items.length, 1);
    const listB = await request('/api/services', 'GET', cookieB);
    assert.equal((await listB.json() as { items: unknown[] }).items.length, 0);

    const forbiddenUpdate = await request(`/api/services/${id}`, 'PUT', cookieB, {
      name: 'Modificado', category: 'cabelo', durationMinutes: 40, priceCents: 3500, active: true
    });
    assert.equal(forbiddenUpdate.status, 404);

    const invalidAssociation = await request('/api/professionals', 'POST', cookieB, {
      fullName: 'Profissional de outra empresa', serviceIds: [id], active: true
    });
    assert.equal(invalidAssociation.status, 400);

    const csrf = await request('/api/services', 'POST', cookieA, {
      name: 'Requisição estranha', category: 'cabelo', durationMinutes: 40, priceCents: 3500, active: true
    }, 'https://site-malicioso.invalid');
    assert.equal(csrf.status, 403);

    const noSession = await request('/api/services');
    assert.equal(noSession.status, 401);

    const checkout = await request('/api/billing/checkout', 'POST', cookieA, { cycle: 'monthly' });
    assert.equal(checkout.status, 200);
    assert.equal((await checkout.json() as { checkoutUrl: string }).checkoutUrl, 'https://pag.ae/82miujJ7H');
    const forbiddenPlatform = await request('/api/platform/billing-requests', 'GET', cookieA);
    assert.equal(forbiddenPlatform.status, 403);

    const professionalResult = await request('/api/professionals', 'POST', cookieA, {
      fullName: 'Profissional A', serviceIds: [id], active: true
    });
    assert.equal(professionalResult.status, 201);
    const professionalId = (await professionalResult.json() as { id: string }).id;
    const customerResult = await request('/api/customers', 'POST', cookieA, { fullName: 'Cliente A', active: true });
    assert.equal(customerResult.status, 201);
    const customerId = (await customerResult.json() as { id: string }).id;

    // O histórico antigo é somente leitura e precisa manter o isolamento multiempresa.
    // A inserção abaixo é fixture de teste: a API não permite criar reservas no passado.
    const lastMonth = DateTime.now().setZone('America/Sao_Paulo').minus({ months: 1 }).toFormat('yyyy-MM');
    const pastStart = DateTime.fromISO(`${lastMonth}-10T11:00`, { zone: 'America/Sao_Paulo' });
    const businessOwner = await pool.query<{ establishment_id: string; user_id: string }>(`
      SELECT m.establishment_id,m.user_id FROM memberships m
      JOIN establishments e ON e.id=m.establishment_id
      JOIN users u ON u.id=m.user_id
      WHERE e.slug=$1 AND u.email=$2`, [slugs[0],emails[0]]);
    const oldBooking = await pool.query<{ id: string }>(`
      INSERT INTO appointments(establishment_id,service_id,professional_id,customer_id,starts_at,ends_at,
        price_cents,status,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,3500,'completed',$7) RETURNING id`,
    [businessOwner.rows[0]!.establishment_id,id,professionalId,customerId,
      pastStart.toJSDate(),pastStart.plus({ minutes: 40 }).toJSDate(),businessOwner.rows[0]!.user_id]);
    const monthlyHistoryA = await request(`/api/calendar/history?month=${lastMonth}`,'GET',cookieA);
    assert.equal(monthlyHistoryA.status,200);
    assert.ok((await monthlyHistoryA.json() as {items:{id:string}[]}).items.some((item)=>item.id===oldBooking.rows[0]!.id));
    const monthlyHistoryB = await request(`/api/calendar/history?month=${lastMonth}`,'GET',cookieB);
    assert.equal(monthlyHistoryB.status,200);
    assert.equal((await monthlyHistoryB.json() as {total:number}).total,0);
    const currentMonth = DateTime.now().setZone('America/Sao_Paulo').toFormat('yyyy-MM');
    assert.equal((await request(`/api/calendar/history?month=${currentMonth}`,'GET',cookieA)).status,400);

    // Exportação operacional deve exigir a senha e conter somente o estabelecimento ativo.
    const exportBadPassword = await request('/api/account/export', 'POST', cookieA, { password: 'senha-incorreta' });
    assert.equal(exportBadPassword.status, 401);
    const exportA = await request('/api/account/export', 'POST', cookieA, { password: 'senha-segura-para-testar' });
    assert.equal(exportA.status, 200);
    assert.match(exportA.headers.get('content-disposition') ?? '', /^attachment; filename="beautybarber-dados-/);
    const dataA = await exportA.json() as { data: { services: { id:string }[]; customers: { id:string }[] } };
    assert.ok(dataA.data.services.some((service)=>service.id===id));
    assert.ok(dataA.data.customers.some((customer)=>customer.id===customerId));
    const exportB = await request('/api/account/export', 'POST', cookieB, { password: 'senha-segura-para-testar' });
    assert.equal(exportB.status, 200);
    const dataB = await exportB.json() as { data: { services: { id:string }[]; customers: { id:string }[] } };
    assert.equal(dataB.data.services.some((service)=>service.id===id),false);
    assert.equal(dataB.data.customers.some((customer)=>customer.id===customerId),false);

    const target = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(target);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const hours = await request(`/api/professionals/${professionalId}/working-hours`, 'PUT', cookieA, {
      periods: [{ weekday, startMinute: 540, endMinute: 1080 }]
    });
    assert.equal(hours.status, 200, await hours.text());

    const noOpeningHours = await request(`/api/calendar/availability?${new URLSearchParams({ date, serviceId: id, professionalId })}`,
      'GET', cookieA);
    assert.equal(noOpeningHours.status, 200);
    const closed = await noOpeningHours.json() as { items: { slots: unknown[] }[] };
    assert.equal(closed.items[0]?.slots.length, 0,
      'Sem horário definido pelo salão, não se oferecem agendamentos.');

    const saveOpeningHours = await request('/api/account/opening-hours', 'PUT', cookieA, {
      periods: [{ weekday, startMinute: 600, endMinute: 1020 }]
    });
    assert.equal(saveOpeningHours.status, 200, await saveOpeningHours.text());

    const holidayPath = `/api/account/special-hours/${date}`;
    const closeSpecialDate = await request(holidayPath,'PUT',cookieA,{closed:true,periods:[]});
    assert.equal(closeSpecialDate.status, 200);
    const closedHoliday = await request(`/api/calendar/availability?${new URLSearchParams({date,serviceId:id,professionalId})}`,'GET',cookieA);
    assert.equal((await closedHoliday.json() as { items:{slots:unknown[]}[] }).items[0]?.slots.length,0);
    assert.equal((await request(holidayPath,'DELETE',cookieA)).status,200);
    const specialOpen = await request(holidayPath,'PUT',cookieA,{
      closed:false,periods:[{startMinute:660,endMinute:960}]
    });
    assert.equal(specialOpen.status,200);
    const overridden = await request(`/api/calendar/availability?${new URLSearchParams({date,serviceId:id,professionalId})}`,'GET',cookieA);
    const customSlots = await overridden.json() as { items: { slots: { time:string }[] }[] };
    assert.equal(customSlots.items[0]?.slots[0]?.time,'11:00');
    assert.equal((await request(holidayPath,'DELETE',cookieA)).status,200);

    const availabilityResult = await request(`/api/calendar/availability?${new URLSearchParams({
      date, serviceId: id, professionalId
    })}`, 'GET', cookieA);
    assert.equal(availabilityResult.status, 200);
    const options = await availabilityResult.json() as { items: { slots: { startsAt: string }[] }[] };
    assert.ok(options.items[0]?.slots.length);
    const startsAt = options.items[0]!.slots[0]!.startsAt;

    // O índice EXCLUDE do PostgreSQL impede duas reservas simultâneas do mesmo profissional.
    const duplicate = await Promise.all([1, 2].map(() => request('/api/calendar/appointments', 'POST', cookieA, {
      serviceId: id, professionalId, customerId, startsAt
    })));
    assert.deepEqual(duplicate.map((response) => response.status).sort(), [201, 409]);

    const closeWithFutureBooking = await request(`/api/professionals/${professionalId}/working-hours`, 'PUT', cookieA, {
      periods: []
    });
    assert.equal(closeWithFutureBooking.status, 409,
      'Não é permitido fechar expediente quando isso deixaria agendamentos futuros fora do horário.');
    const businessClosesWithFutureBooking = await request('/api/account/opening-hours','PUT',cookieA,{periods:[]});
    assert.equal(businessClosesWithFutureBooking.status, 409,
      'Fechar o salão exige remarcar atendimentos futuros existentes.');
    const holidayClosesWithFutureBooking = await request(holidayPath,'PUT',cookieA,{closed:true,periods:[]});
    assert.equal(holidayClosesWithFutureBooking.status,409,
      'A exceção de um feriado também deve preservar os agendamentos existentes.');

    const timezoneChangeWithBooking = await request('/api/account/business','PUT',cookieA,{
      name:'Empresa A',timezone:'America/Bahia',contactEmail:'',contactPhone:'',addressLine:'',city:'',stateCode:''
    });
    assert.equal(timezoneChangeWithBooking.status,409,
      'Trocar o fuso com reservas futuras não pode deslocar a interpretação da agenda.');

    const historyA = await request(`/api/customers/${customerId}/history`, 'GET', cookieA);
    assert.equal(historyA.status, 200);
    assert.equal((await historyA.json() as { items: unknown[] }).items.length, 2);
    const historyB = await request(`/api/customers/${customerId}/history`, 'GET', cookieB);
    assert.equal(historyB.status, 404, 'Outra empresa não pode consultar o histórico do cliente.');

    const individualExportPath = `/api/account/customers/${customerId}/export`;
    const wrongExportPassword = await request(individualExportPath,'POST',cookieA,{password:'senha-errada'});
    assert.equal(wrongExportPassword.status,401);
    const forbiddenCustomerExport = await request(individualExportPath,'POST',cookieB,{password:'senha-segura-para-testar'});
    assert.equal(forbiddenCustomerExport.status,404,'Outra empresa não pode exportar os dados de um cliente alheio.');
    const customerExport = await request(individualExportPath,'POST',cookieA,{password:'senha-segura-para-testar'});
    assert.equal(customerExport.status,200);
    const exportedCustomer = await customerExport.json() as {data:{customer:{id:string};appointments:{id:string}[]}};
    assert.equal(exportedCustomer.data.customer.id,customerId);
    assert.equal(exportedCustomer.data.appointments.length,2);
    const audited = await pool.query<{ total:string }>(`SELECT count(*) AS total FROM data_export_events
      WHERE establishment_id=(SELECT establishment_id FROM customers WHERE id=$1) AND customer_id=$1`,[customerId]);
    assert.equal(Number(audited.rows[0]?.total),1,'A exportação individual precisa ficar registrada para auditoria.');

    const occupiedStart = new Date(new Date(startsAt).getTime() + 5 * 60_000).toISOString();
    const occupiedEnd = new Date(new Date(startsAt).getTime() + 20 * 60_000).toISOString();
    const occupiedBlock = await request('/api/calendar/blocks', 'POST', cookieA, {
      professionalId, startsAt: occupiedStart, endsAt: occupiedEnd, reason: 'Conflito de teste'
    });
    assert.equal(occupiedBlock.status, 409, 'Folga não pode substituir atendimento já reservado.');

    const freeStart = new Date(new Date(startsAt).getTime() + 2 * 60 * 60_000).toISOString();
    const freeEnd = new Date(new Date(freeStart).getTime() + 45 * 60_000).toISOString();
    const newBlock = await request('/api/calendar/blocks', 'POST', cookieA, {
      professionalId, startsAt: freeStart, endsAt: freeEnd, reason: 'Folga de teste'
    });
    assert.equal(newBlock.status, 201);
    const blockId = (await newBlock.json() as { id: string }).id;
    const overlappingBlock = await request('/api/calendar/blocks', 'POST', cookieA, {
      professionalId, startsAt: freeStart, endsAt: freeEnd
    });
    assert.equal(overlappingBlock.status, 409, 'Não deve registrar duas folgas sobrepostas.');

    const blocksB = await request(`/api/calendar/blocks?professionalId=${professionalId}`, 'GET', cookieB);
    assert.equal((await blocksB.json() as { items: unknown[] }).items.length, 0);
    const deleteOtherTenant = await request(`/api/calendar/blocks/${blockId}`, 'DELETE', cookieB);
    assert.equal(deleteOtherTenant.status, 404);
    const deleteOwn = await request(`/api/calendar/blocks/${blockId}`, 'DELETE', cookieA);
    assert.equal(deleteOwn.status, 204);

    // Um usuário da empresa B não pode agendar usando IDs da empresa A.
    const crossTenant = await request('/api/calendar/appointments', 'POST', cookieB, {
      serviceId: id, professionalId, customerId, startsAt
    });
    assert.notEqual(crossTenant.status, 201);

    // Usuário profissional consulta apenas os próprios atendimentos, após vinculação explícita pelo dono.
    const { hashPassword } = await import('./security.js');
    const professionalEmail = `teste-profissional-${marker}@exemplo.invalid`;
    emails.push(professionalEmail);
    const businessA = await pool.query<{ id: string }>('SELECT id FROM establishments WHERE slug=$1', [slugs[0]]);
    const employee = await pool.query<{ id: string }>(`INSERT INTO users(full_name,email,password_hash)
      VALUES($1,$2,$3) RETURNING id`, ['Profissional Teste',professionalEmail,await hashPassword('senha-segura-profissional')]);
    await pool.query(`INSERT INTO memberships(establishment_id,user_id,role) VALUES($1,$2,'professional')`,
      [businessA.rows[0]!.id,employee.rows[0]!.id]);
    const employeeLogin = await request('/api/auth/login', 'POST', '', { email: professionalEmail, password: 'senha-segura-profissional' });
    assert.equal(employeeLogin.status, 200);
    const cookieProfessional = employeeLogin.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookieProfessional);
    const mineQuery = new URLSearchParams({ start: date, end: new Date(new Date(`${date}T12:00:00Z`).getTime() + 86400_000).toISOString().slice(0,10) });
    const beforeLink = await request(`/api/calendar/mine?${mineQuery}`, 'GET', cookieProfessional);
    assert.equal((await beforeLink.json() as { linked: boolean }).linked, false);
    const assigned = await request(`/api/professionals/${professionalId}/account`, 'PUT', cookieA, { userId: employee.rows[0]!.id });
    assert.equal(assigned.status, 200);
    const personalAgenda = await request(`/api/calendar/mine?${mineQuery}`, 'GET', cookieProfessional);
    assert.equal(personalAgenda.status, 200);
    const personalResult = await personalAgenda.json() as { linked: boolean; items: unknown[] };
    assert.equal(personalResult.linked, true);
    assert.equal(personalResult.items.length, 1);
    assert.equal((await request('/api/calendar?start='+date+'&end='+mineQuery.get('end'), 'GET', cookieProfessional)).status, 403);
    assert.equal((await request('/api/customers', 'GET', cookieProfessional)).status, 403);
    assert.equal((await request('/api/account/export', 'POST', cookieProfessional, { password: 'senha-segura-profissional' })).status, 403,
      'Profissionais não podem exportar dados pessoais de toda a empresa.');
  } finally {
    if (slugs.length) {
      const businesses = await pool.query<{ id: string }>(
        'SELECT id FROM establishments WHERE slug = ANY($1::text[])', [slugs]);
      const ids = businesses.rows.map((row) => row.id);
      if (ids.length) {
        // Limpeza explícita: histórico, pagamentos e convites referenciam memberships
        // sem ON DELETE CASCADE. Uma exclusão direta do estabelecimento falharia.
        for (const table of ['payment_records','appointment_history','appointments',
          'team_invitations','billing_events','subscription_requests']) {
          await pool.query(`DELETE FROM ${table} WHERE establishment_id = ANY($1::uuid[])`, [ids]);
        }
        await pool.query('DELETE FROM establishments WHERE id = ANY($1::uuid[])', [ids]);
      }
    }
    await pool.query('DELETE FROM users WHERE email = ANY($1::text[])', [emails]);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
});

