import { useEffect, useState, type FormEvent } from 'react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';
import { DEFAULT_TIMEZONE, formatInZone, shiftMonth, todayInZone } from '../lib/dates';

type HistoryItem = {
  id: string;
  startsAt: string;
  status: string;
  customerName: string;
  serviceName: string;
  professionalName: string;
  priceCents: number;
};
type HistoryResult = {
  items: HistoryItem[];
  total: number;
  page: number;
  pageSize: number;
};

const statuses: Record<string, string> = {
  pending: 'Pendente', confirmed: 'Confirmado', in_progress: 'Em atendimento',
  completed: 'Concluído', cancelled: 'Cancelado', no_show: 'Não compareceu'
};

export function AppointmentHistoryPage() {
  const { account, busy, error: accountError } = useAccount();
  const timezone = account?.establishmentTimezone ?? DEFAULT_TIMEZONE;
  const lastMonth = shiftMonth(todayInZone(timezone).slice(0, 7), -1);
  const [month, setMonth] = useState(() => shiftMonth(todayInZone().slice(0, 7), -1));
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setMonth(lastMonth); setPage(1); setQuery(''); setSearch(''); }, [account?.establishmentId, lastMonth]);

  useEffect(() => {
    if (!account || account.role === 'professional' || month > lastMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ month, page: String(page) });
    if (search) params.set('q', search);
    setLoading(true); setError('');
    apiRequest<HistoryResult>(`/api/calendar/history?${params}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o histórico.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [account?.establishmentId, account?.role, month, page, search, lastMonth]);

  function searchHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(query.trim());
  }

  if (busy) return <div className="page-state" role="status">Verificando sua conta…</div>;
  if (!account) return <div className="page-state" role="alert">{accountError || 'Entre na conta para continuar.'}</div>;

  return <WorkspaceLayout account={account}>
    <header className="management-heading"><div><p className="eyebrow">GESTÃO / HISTÓRICO</p><h1>Histórico de agendamentos</h1><p>Consulte atendimentos de meses anteriores em uma lista, sem calendário e sem alterações de horários.</p></div></header>
    {account.role === 'professional' ? <p className="form-error" role="alert">O histórico administrativo está disponível somente para responsáveis e recepção.</p> : <>
      <form className="report-filters history-filters" onSubmit={searchHistory}>
        <label>Mês anterior ao atual<input type="month" required max={lastMonth} value={month} onChange={(event) => { if (!event.target.value) return; setMonth(event.target.value <= lastMonth ? event.target.value : lastMonth); setPage(1); }} /></label>
        <label>Buscar atendimento<input type="search" maxLength={80} placeholder="Cliente, serviço ou profissional" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <button type="submit" className="button button--secondary">Buscar</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="management-panel history-panel" aria-label="Atendimentos anteriores">
        <div className="history-panel__heading"><h2>Atendimentos registrados</h2><span>{result ? `${result.total} registro(s)` : 'Carregando registros'}</span></div>
        {loading ? <p className="report-empty" role="status">Carregando histórico…</p> : result?.items.length ? <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Data e horário</th><th>Cliente</th><th>Serviço</th><th>Profissional</th><th>Situação</th></tr></thead><tbody>{result.items.map((item) => <tr key={item.id}><td>{formatInZone(item.startsAt,timezone)}</td><td>{item.customerName}</td><td>{item.serviceName}</td><td>{item.professionalName}</td><td>{statuses[item.status] ?? item.status}</td></tr>)}</tbody></table></div> : <p className="report-empty">Nenhum agendamento encontrado nesse mês.</p>}
        {result && result.total > result.pageSize && <div className="history-pagination"><span>Página {result.page} de {Math.ceil(result.total/result.pageSize)}</span><div><button className="button button--secondary" type="button" disabled={loading || page === 1} onClick={() => setPage((current) => current-1)}>Anterior</button><button className="button button--secondary" type="button" disabled={loading || page*result.pageSize >= result.total} onClick={() => setPage((current) => current+1)}>Próxima</button></div></div>}
      </section>
    </>}
  </WorkspaceLayout>;
}
