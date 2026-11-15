import { useEffect, useMemo, useState } from 'react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';
import { DEFAULT_TIMEZONE, formatInZone, todayInZone } from '../lib/dates';

type Appointment = {
  id: string; startsAt: string; endsAt: string; status: string;
  customerName: string; serviceName: string;
};
type Agenda = { linked: boolean; professionalName?: string; zone?: string; items: Appointment[] };
const statusLabels: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmado', in_progress: 'Em atendimento',
  completed: 'Concluído', cancelled: 'Cancelado', no_show: 'Não compareceu' };

function addDays(value: string, count: number) {
  const instant = new Date(`${value}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + count);
  return instant.toISOString().slice(0, 10);
}

export function MyAgendaPage() {
  const { account, busy, error: accountError } = useAccount();
  const timezone = account?.establishmentTimezone ?? DEFAULT_TIMEZONE;
  const [date, setDate] = useState(todayInZone);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const range = useMemo(() => {
    if (view === 'day') return { start: date, end: addDays(date, 1) };
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const monday = addDays(date, -((weekday + 6) % 7));
    return { start: monday, end: addDays(monday, 7) };
  }, [date, view]);

  useEffect(() => { if (account) setDate(todayInZone(timezone)); }, [account?.establishmentId, timezone]);

  useEffect(() => {
    if (account?.role !== 'professional') { setLoading(false); return; }
    let active = true;
    setLoading(true); setError('');
    apiRequest<Agenda>(`/api/calendar/mine?${new URLSearchParams(range)}`)
      .then((result) => { if (active) setAgenda(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar sua agenda.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, range]);

  if (busy) return <div className="page-state" role="status">Verificando seu acesso…</div>;
  if (!account) return <div className="page-state" role="alert">{accountError || 'Entre na sua conta.'}</div>;
  return <WorkspaceLayout account={account}>
    <header className="management-heading"><div><p className="eyebrow">MINHA ROTINA</p><h1>Meus atendimentos</h1><p>Consulte seus horários, serviços e clientes. Alterações são realizadas pela recepção ou pelo responsável.</p></div></header>
    {account.role !== 'professional' ? <p className="management-hint">Esta página é reservada a contas com perfil Profissional.</p> : <>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="calendar-shell" aria-label="Minha agenda">
        <div className="calendar-toolbar"><div className="calendar-toolbar__left"><button type="button" className="calendar-nav" aria-label="Período anterior" onClick={() => setDate(addDays(date, view === 'day' ? -1 : -7))}>‹</button><button type="button" className="calendar-nav" aria-label="Próximo período" onClick={() => setDate(addDays(date, view === 'day' ? 1 : 7))}>›</button><button type="button" className="calendar-today" onClick={() => setDate(todayInZone(timezone))}>Hoje</button><h2>{agenda?.professionalName || 'Agenda pessoal'}</h2></div>
          <div className="calendar-toolbar__right"><label className="sr-only" htmlFor="my-agenda-date">Selecionar data</label><input id="my-agenda-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /><div className="calendar-view" aria-label="Modo da agenda"><button type="button" className={view === 'day' ? 'is-selected' : ''} aria-pressed={view === 'day'} onClick={() => setView('day')}>Dia</button><button type="button" className={view === 'week' ? 'is-selected' : ''} aria-pressed={view === 'week'} onClick={() => setView('week')}>Semana</button></div></div>
        </div>
        {loading ? <p className="calendar-placeholder" role="status">Carregando atendimentos…</p> : !agenda?.linked ? <div className="calendar-placeholder"><strong>Conta ainda não vinculada.</strong><p>Peça ao responsável para associar sua conta a um profissional em Profissionais → Vincular conta.</p></div> : agenda.items.length ? <div className="calendar-list">{agenda.items.map((appointment) => <article className="calendar-list__item" key={appointment.id}><time>{formatInZone(appointment.startsAt, agenda.zone ?? timezone)}</time><strong>{appointment.customerName}</strong><span>{appointment.serviceName}</span><small>{statusLabels[appointment.status] ?? appointment.status}</small></article>)}</div> : <p className="calendar-placeholder">Nenhum atendimento neste período.</p>}
      </section>
    </>}
  </WorkspaceLayout>;
}
