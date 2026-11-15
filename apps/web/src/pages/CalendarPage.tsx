import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';
import { DEFAULT_TIMEZONE, formatInZone, shiftCalendarDate, todayInZone } from '../lib/dates';

type Status = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
type Appointment = {
  id: string; serviceId: string; serviceName: string; professionalId: string; professionalName: string;
  customerId: string; customerName: string; startsAt: string; endsAt: string; status: Status;
  notes: string | null; priceCents: number;
};
type Service = { id: string; name: string; durationMinutes: number; priceCents: number; active: boolean };
type Professional = { id: string; fullName: string; active: boolean; serviceIds: string[] };
type Customer = { id: string; fullName: string; active: boolean };
type Availability = { items: { professionalId: string; professionalName: string; slots: { time: string; startsAt: string; endsAt: string }[] }[] };
type History = { event: string; previousStatus: Status | null; currentStatus: Status; createdAt: string; actorName: string | null };
type View = 'day' | 'week' | 'month';

const statusLabels: Record<Status, string> = {
  pending: 'Pendente', confirmed: 'Confirmado', in_progress: 'Em atendimento',
  completed: 'Concluído', cancelled: 'Cancelado', no_show: 'Não compareceu'
};
const transitions: Record<Status, Status[]> = {
  pending: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [], cancelled: [], no_show: []
};
const price = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function addDays(date: string, count: number) {
  const instant = new Date(`${date}T12:00:00Z`); instant.setUTCDate(instant.getUTCDate() + count);
  return instant.toISOString().slice(0, 10);
}
function viewRange(date: string, view: View) {
  if (view === 'day') return { start: date, end: addDays(date, 1) };
  const base = new Date(`${date}T12:00:00Z`);
  if (view === 'week') {
    const start = addDays(date, -((base.getUTCDay() + 6) % 7));
    return { start, end: addDays(start, 7) };
  }
  const start = `${date.slice(0, 7)}-01`;
  const next = new Date(`${start}T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  return { start, end: next.toISOString().slice(0, 10) };
}
export function CalendarPage() {
  const { account, busy, error: accountError } = useAccount();
  const timezone = account?.establishmentTimezone ?? DEFAULT_TIMEZONE;
  const labelDate = (iso: string, opts?: Intl.DateTimeFormatOptions) => formatInZone(iso,timezone,opts);
  const today = todayInZone(timezone);
  const [date, setDate] = useState(todayInZone);
  const [view, setView] = useState<View>('day');
  const [items, setItems] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filterProfessional, setFilterProfessional] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [newServiceId, setNewServiceId] = useState('');
  const [newCustomerId, setNewCustomerId] = useState('');
  const [newProfessionalId, setNewProfessionalId] = useState('');
  const [newDate, setNewDate] = useState(todayInZone);
  const [newStart, setNewStart] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [rescheduleMode, setRescheduleMode] = useState(false);

  useEffect(() => {
    if (!account) return;
    setDate(todayInZone(timezone));
    setNewDate(todayInZone(timezone));
  }, [account?.establishmentId,timezone]);

  const range = useMemo(() => viewRange(date, view), [date, view]);
  const load = useCallback(async () => {
    const qs = new URLSearchParams({ start: range.start, end: range.end });
    if (filterProfessional) qs.set('professionalId', filterProfessional);
    const response = await apiRequest<{ items: Appointment[] }>(`/api/calendar?${qs}`);
    setItems(response.items);
  }, [range, filterProfessional]);

  useEffect(() => {
    if (!account || account.role === 'professional') { setLoading(false); return; }
    let active = true;
    Promise.all([
      apiRequest<{ items: Service[] }>('/api/services'),
      apiRequest<{ items: Professional[] }>('/api/professionals'),
      apiRequest<{ items: Customer[] }>('/api/customers')
    ]).then(([catalog, team, clients]) => {
      if (!active) return;
      setServices(catalog.items); setProfessionals(team.items); setCustomers(clients.items);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Erro ao carregar dados da agenda.'); });
    return () => { active = false; };
  }, [account]);

  useEffect(() => {
    if (!account || account.role === 'professional') return;
    let active = true;
    setLoading(true);
    load().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Erro ao carregar agenda.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, load]);

  useEffect(() => {
    if (!editorOpen || !newServiceId || !newDate) { setAvailability(null); return; }
    let active = true; setAvailabilityLoading(true); setNewStart('');
    const qs = new URLSearchParams({ serviceId: newServiceId, date: newDate });
    apiRequest<Availability>(`/api/calendar/availability?${qs}`)
      .then((result) => { if (active) setAvailability(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Erro ao consultar horários.'); })
      .finally(() => { if (active) setAvailabilityLoading(false); });
    return () => { active = false; };
  }, [editorOpen, newServiceId, newDate]);

  const availableProfessionals = availability?.items ?? [];
  const availableSlots = availableProfessionals.find((item) => item.professionalId === newProfessionalId)?.slots ?? [];

  async function refresh() { await load(); }
  function openEditor(reschedule = false, item?: Appointment) {
    setError(''); setNotice(''); setEditorOpen(true); setRescheduleMode(reschedule);
    setNewServiceId(item?.serviceId ?? ''); setNewCustomerId(item?.customerId ?? '');
    setNewProfessionalId(item?.professionalId ?? ''); setNewDate(item ? labelDate(item.startsAt, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-') : (date < today ? today : date));
    setNewStart(''); setNewNotes(item?.notes ?? '');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      if (!newStart) throw new Error('Selecione um horário disponível.');
      if (rescheduleMode && selected) {
        await apiRequest(`/api/calendar/appointments/${selected.id}/reschedule`, { method: 'PATCH',
          body: JSON.stringify({ professionalId: newProfessionalId, startsAt: newStart }) });
        setNotice('Agendamento remarcado.'); setSelected(null);
      } else {
        await apiRequest('/api/calendar/appointments', { method: 'POST',
          body: JSON.stringify({ customerId: newCustomerId, serviceId: newServiceId,
            professionalId: newProfessionalId, startsAt: newStart, notes: newNotes }) });
        setNotice('Agendamento registrado como pendente.');
      }
      setDate(newDate); setView('day'); setEditorOpen(false); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar agendamento.'); }
    finally { setSaving(false); }
  }

  async function selectItem(item: Appointment) {
    setSelected(item); setEditorOpen(false); setHistory([]); setError(''); setNotice('');
    try {
      const response = await apiRequest<{ items: History[] }>(`/api/calendar/appointments/${item.id}/history`);
      setHistory(response.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro ao consultar histórico.'); }
  }

  async function changeStatus(status: Status) {
    if (!selected) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/calendar/appointments/${selected.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setNotice(`Agendamento: ${statusLabels[status].toLowerCase()}.`); setSelected(null); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar situação.'); }
    finally { setSaving(false); }
  }

  function shift(step: number) {
    setDate((current) => shiftCalendarDate(current, view, step, todayInZone(timezone)));
  }

  if (busy) return <div className="page-state" role="status">Verificando sua conta…</div>;
  if (!account) return <div className="page-state" role="alert">{accountError || 'Entre na conta para continuar.'}</div>;

  return <WorkspaceLayout account={account}>
    <header className="management-heading"><div><p className="eyebrow">GESTÃO / AGENDA</p><h1>Agenda de atendimentos</h1><p>Horários, equipe e clientes organizados no mesmo lugar.</p></div>
      {account.role !== 'professional' && <button className="button button--primary" onClick={() => openEditor()} type="button">Novo agendamento +</button>}
    </header>
    {account.role === 'professional' ? <p className="form-error">A agenda administrativa está disponível somente para responsáveis e recepção.</p> : <>
      {notice && <p className="form-success" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      <section className="calendar-shell" aria-label="Calendário">
        <div className="calendar-toolbar">
          <div className="calendar-toolbar__left"><button className="calendar-nav" type="button" onClick={() => shift(-1)} disabled={shiftCalendarDate(date, view, -1, today) === date} aria-label="Período anterior">‹</button><button className="calendar-nav" type="button" onClick={() => shift(1)} aria-label="Próximo período">›</button><button className="calendar-today" type="button" onClick={() => setDate(todayInZone(timezone))}>Hoje</button><h2>{new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' })}</h2></div>
          <div className="calendar-toolbar__right"><label className="sr-only" htmlFor="agenda-date">Data</label><input id="agenda-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value < today ? today : e.target.value)} /><label className="sr-only" htmlFor="agenda-professional">Filtrar profissional</label><select id="agenda-professional" value={filterProfessional} onChange={(e) => setFilterProfessional(e.target.value)}><option value="">Todos os profissionais</option>{professionals.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select>
            <div className="calendar-view" aria-label="Modo da agenda">{(['day', 'week', 'month'] as View[]).map((option) => <button key={option} type="button" className={view === option ? 'is-selected' : ''} onClick={() => setView(option)} aria-pressed={view === option}>{option === 'day' ? 'Dia' : option === 'week' ? 'Semana' : 'Mês'}</button>)}</div>
          </div>
        </div>
        {loading ? <p className="calendar-placeholder" role="status">Atualizando horários…</p> : view === 'day' ?
          <div className="calendar-day-grid">{professionals.filter((p) => p.active && (!filterProfessional || p.id === filterProfessional)).map((professional) => {
            const own = items.filter((item) => item.professionalId === professional.id);
            return <section className="calendar-column" key={professional.id} aria-label={`Atendimentos de ${professional.fullName}`}><h3>{professional.fullName}<span>{own.length} atendimento(s)</span></h3>
              {own.length ? own.map((item) => <button className="calendar-appointment" key={item.id} type="button" onClick={() => void selectItem(item)}>
                <time>{labelDate(item.startsAt, { hour: '2-digit', minute: '2-digit' })}</time><strong>{item.customerName}</strong><span>{item.serviceName}</span><small>{statusLabels[item.status]}</small></button>) : <p className="calendar-empty-column">Nenhum atendimento neste dia.</p>}
            </section>;
          })}{!professionals.some((p) => p.active) && <p className="calendar-placeholder">Cadastre profissionais ativos para usar a agenda.</p>}</div> :
          <div className="calendar-list">{items.length ? items.map((item) => <button key={item.id} type="button" className="calendar-list__item" onClick={() => void selectItem(item)}><time>{labelDate(item.startsAt, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><strong>{item.customerName}</strong><span>{item.serviceName} · {item.professionalName}</span><small>{statusLabels[item.status]}</small></button>) : <p className="calendar-placeholder">Sem agendamentos neste período.</p>}</div>}
      </section>

      {editorOpen && <section className="management-editor" aria-labelledby="booking-editor-title"><div className="management-editor__header"><div><p className="eyebrow">AGENDA</p><h2 id="booking-editor-title">{rescheduleMode ? 'Remarcar atendimento' : 'Novo agendamento'}</h2></div><button type="button" className="close-editor" aria-label="Fechar formulário" onClick={() => setEditorOpen(false)}>×</button></div>
        <form className="management-form" onSubmit={save}>
          <label>Cliente<select required disabled={rescheduleMode} value={newCustomerId} onChange={(e) => setNewCustomerId(e.target.value)}><option value="">Selecione o cliente</option>{customers.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}</select></label>
          <label>Serviço<select required disabled={rescheduleMode} value={newServiceId} onChange={(e) => { setNewServiceId(e.target.value); setNewProfessionalId(''); }}><option value="">Selecione o serviço</option>{services.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMinutes} min · {price(s.priceCents)}</option>)}</select></label>
          <label>Data<input required type="date" value={newDate} min={todayInZone(timezone)} max={addDays(todayInZone(timezone), 90)} onChange={(e) => setNewDate(e.target.value)} /></label>
          <label>Profissional<select required value={newProfessionalId} onChange={(e) => { setNewProfessionalId(e.target.value); setNewStart(''); }}><option value="">Selecione um profissional</option>{availableProfessionals.map((p) => <option key={p.professionalId} value={p.professionalId}>{p.professionalName}</option>)}</select></label>
          <label>Horário<select required value={newStart} onChange={(e) => setNewStart(e.target.value)} disabled={availabilityLoading || !newProfessionalId}><option value="">{availabilityLoading ? 'Buscando horários…' : 'Selecione um horário disponível'}</option>{availableSlots.map((slot) => <option key={slot.startsAt} value={slot.startsAt}>{slot.time}</option>)}</select></label>
          {!rescheduleMode && <label className="management-form__wide">Observações (opcional)<textarea maxLength={500} rows={3} value={newNotes} onChange={(e) => setNewNotes(e.target.value)} /></label>}
          {newServiceId && !availabilityLoading && newProfessionalId && !availableSlots.length && <p className="management-form__wide">Não há horários para esse profissional nessa data. Verifique o funcionamento do salão em Configurações, o expediente do profissional, folgas e outros atendimentos.</p>}
          <div className="management-form__actions"><button type="button" className="button button--secondary" onClick={() => setEditorOpen(false)}>Cancelar</button><button type="submit" className="button button--primary" disabled={saving || !newStart}>{saving ? 'Salvando…' : rescheduleMode ? 'Confirmar remarcação' : 'Criar agendamento'}</button></div>
        </form>
      </section>}

      {selected && !editorOpen && <section className="management-editor" aria-labelledby="appointment-details-title"><div className="management-editor__header"><div><p className="eyebrow">DETALHES DO ATENDIMENTO</p><h2 id="appointment-details-title">{selected.customerName}</h2></div><button type="button" className="close-editor" aria-label="Fechar detalhes" onClick={() => setSelected(null)}>×</button></div>
        <div className="calendar-detail"><p><strong>Serviço:</strong> {selected.serviceName} · {price(selected.priceCents)}</p><p><strong>Profissional:</strong> {selected.professionalName}</p><p><strong>Horário:</strong> {labelDate(selected.startsAt, { dateStyle: 'full', timeStyle: 'short' })}</p><p><strong>Situação:</strong> {statusLabels[selected.status]}</p>{selected.notes && <p><strong>Observações:</strong> {selected.notes}</p>}</div>
        <div className="calendar-detail__actions">{transitions[selected.status].map((next) => <button disabled={saving} className="button button--secondary" type="button" key={next} onClick={() => void changeStatus(next)}>{statusLabels[next]}</button>)}
          {['pending','confirmed'].includes(selected.status) && new Date(selected.startsAt).getTime() > Date.now() && <button className="button button--primary" type="button" onClick={() => openEditor(true, selected)}>Remarcar</button>}</div>
        <h3 className="calendar-detail__subtitle">Histórico</h3><ol className="calendar-history">{history.map((event, i) => <li key={`${i}-${event.createdAt}`}><span>{labelDate(event.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</span><strong>{event.event === 'created' ? 'Agendamento criado' : event.event === 'rescheduled' ? 'Horário alterado' : `Situação: ${statusLabels[event.currentStatus]}`}</strong><small>{event.actorName ?? 'Sistema'}</small></li>)}</ol>
      </section>}
    </>}
  </WorkspaceLayout>;
}
