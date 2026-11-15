import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';
import { DEFAULT_TIMEZONE, monthBoundsInZone } from '../lib/dates';

type Report = {
  summary: { total: number; completed: number; cancelled: number; noShow: number; pending: number; performedValueCents: number; receivedCents: number };
  topServices: { serviceName: string; count: number; performedValueCents: number }[];
  byProfessional: { professionalName: string; count: number }[];
  monthly: { month: string; appointments: number; completed: number }[];
};
const brl = (cents: number) => (cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

export function ReportsPage() {
  const { account, busy, error: accountError } = useAccount();
  const timezone = account?.establishmentTimezone ?? DEFAULT_TIMEZONE;
  const [from, setFrom] = useState(() => monthBoundsInZone().from);
  const [to, setTo] = useState(() => monthBoundsInZone().to);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (fromDate: string, toDate: string, signal?: AbortSignal) => {
    const qs = new URLSearchParams({ from: fromDate, to: toDate });
    const response = await apiRequest<Report>(`/api/reports?${qs}`, { signal });
    if (!signal?.aborted) setReport(response);
  }, []);
  useEffect(() => {
    if (!account || account.role === 'professional') { setLoading(false); return; }
    const controller = new AbortController();
    const initial = monthBoundsInZone(timezone);
    setFrom(initial.from); setTo(initial.to); setLoading(true);
    load(initial.from, initial.to, controller.signal)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar relatórios.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [account?.establishmentId, account?.role, timezone, load]);

  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError('');
    try { await load(from,to); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar relatórios.'); }
    finally { setLoading(false); }
  }

  if (busy || loading) return <div className="page-state" role="status">Preparando relatórios…</div>;
  if (!account) return <div className="page-state" role="alert">{accountError || 'Entre na conta para continuar.'}</div>;

  return <WorkspaceLayout account={account}>
    <header className="management-heading"><div><p className="eyebrow">GESTÃO / ANÁLISE</p><h1>Relatórios do estabelecimento</h1><p>Dados reais dos agendamentos e dos recebimentos registrados.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {account.role === 'professional' ? <p className="form-error">Você não tem permissão para consultar os relatórios.</p> : <>
      <form onSubmit={filter} className="report-filters"><label>Início<input required type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>Fim<input required type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></label><button className="button button--secondary" type="submit">Atualizar período</button></form>
      {report && <>
        <div className="report-metrics"><article><span>Agendamentos</span><strong>{report.summary.total}</strong></article><article><span>Concluídos</span><strong>{report.summary.completed}</strong></article><article><span>Cancelados</span><strong>{report.summary.cancelled}</strong></article><article><span>Faltas</span><strong>{report.summary.noShow}</strong></article></div>
        <div className="report-money"><article><span>Valor dos serviços concluídos</span><strong>{brl(report.summary.performedValueCents)}</strong><small>Valor dos serviços executados — não equivale a dinheiro recebido.</small></article><article><span>Recebimentos registrados</span><strong>{brl(report.summary.receivedCents)}</strong><small>Valores lançados manualmente no controle de recebimentos.</small></article></div>
        <div className="report-tables"><section className="management-panel"><h2>Serviços mais realizados</h2>{report.topServices.length ? <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Serviço</th><th>Atendimentos</th><th>Valor executado</th></tr></thead><tbody>{report.topServices.map((item) => <tr key={item.serviceName}><td>{item.serviceName}</td><td>{item.count}</td><td>{brl(item.performedValueCents)}</td></tr>)}</tbody></table></div> : <p className="report-empty">Sem atendimentos concluídos no período.</p>}</section>
          <section className="management-panel"><h2>Atendimentos por profissional</h2>{report.byProfessional.length ? <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Profissional</th><th>Concluídos</th></tr></thead><tbody>{report.byProfessional.map((item) => <tr key={item.professionalName}><td>{item.professionalName}</td><td>{item.count}</td></tr>)}</tbody></table></div> : <p className="report-empty">Sem registros no período.</p>}</section>
        </div>
        <section className="management-panel report-trend"><h2>Evolução por mês</h2>{report.monthly.length ? <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Mês</th><th>Agendamentos</th><th>Concluídos</th></tr></thead><tbody>{report.monthly.map((item) => <tr key={item.month}><td>{item.month}</td><td>{item.appointments}</td><td>{item.completed}</td></tr>)}</tbody></table></div> : <p className="report-empty">Sem dados para o período informado.</p>}</section>
      </>}
    </>}
  </WorkspaceLayout>;
}
