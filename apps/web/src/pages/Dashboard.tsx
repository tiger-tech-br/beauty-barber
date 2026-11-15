import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';
import { DEFAULT_TIMEZONE, formatInZone } from '../lib/dates';

type Overview = {
  establishment: { name: string; slug: string };
  nextSteps: { label: string; completed: boolean; href: string }[];
  counts: { services: number; professionals: number; customers: number };
  metrics: { today: number; pending: number; completed: number; cancelled: number; noShow: number; receivedCents: number };
  upcoming: { id: string; customerName: string; serviceName: string; professionalName: string; startsAt: string; status: string }[];
  publicBookingPath: string;
};

export function Dashboard() {
  const { account, busy, error: accountError } = useAccount();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!account) return;
    let active = true;
    apiRequest<Overview>('/api/overview')
      .then((data) => { if (active) setOverview(data); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os indicadores.'); });
    return () => { active = false; };
  }, [account]);

  if (busy || (account && !overview && !error)) return <div className="page-state" role="status">Preparando seu espaço…</div>;
  if (!account) return <div className="page-state" role="alert">{accountError || 'Verificando sua conta…'}</div>;
  if (error || !overview) return <div className="page-state" role="alert">{error || 'Não foi possível carregar.'}</div>;

  const done = overview.nextSteps.filter((step) => step.completed).length;
  const timezone = account.establishmentTimezone ?? DEFAULT_TIMEZONE;
  const today = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).format(new Date());

  return <WorkspaceLayout account={account}>
    <div className="dashboard-heading"><div><p className="eyebrow">VISÃO GERAL / {today.toUpperCase()}</p><h1>Bom ter você aqui, {account.fullName.split(' ')[0]}.</h1><p>Veja os atendimentos e informações da rotina do seu estabelecimento.</p></div>{account.role !== 'professional' && <Link className="button button--primary dashboard-create-booking" to="/painel/agenda?novo=1">Novo agendamento +</Link>}</div>
    {account.role === 'professional' && <section className="management-panel empty-records"><strong>Sua agenda individual está disponível.</strong><p>Consulte seus horários e atendimentos na opção “Minha agenda” do menu.</p></section>}
    {account.role !== 'professional' && <>
      <section className="operations operations--today" aria-labelledby="today-title"><div className="operations__heading"><div><p className="eyebrow">MOVIMENTO DO DIA</p><h2 id="today-title">Atendimentos de hoje</h2></div><span>Indicadores reais do estabelecimento.</span></div><div className="operations__grid"><article><span>Agendados</span><strong>{overview.metrics.today}</strong><small>Inclui todos os status</small></article><article><span>Pendentes</span><strong>{overview.metrics.pending}</strong><small>Aguardam confirmação</small></article><article><span>Concluídos</span><strong>{overview.metrics.completed}</strong><small>Atendimentos finalizados</small></article><article><span>Recebimentos</span><strong className="operations__money">{(overview.metrics.receivedCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</strong><small>Valores registrados hoje</small></article></div></section>
      <section className="management-panel dashboard-upcoming"><h2>Próximos horários</h2>{overview.upcoming.length ? <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Quando</th><th>Cliente</th><th>Serviço</th><th>Profissional</th></tr></thead><tbody>{overview.upcoming.map((item) => <tr key={item.id}><td>{formatInZone(item.startsAt,timezone)}</td><td>{item.customerName}</td><td>{item.serviceName}</td><td>{item.professionalName}</td></tr>)}</tbody></table></div> : <p className="dashboard-upcoming__empty">Ainda não há novos horários agendados.</p>}</section>
      {done < overview.nextSteps.length && <section className="setup-panel" aria-labelledby="setup-title"><div className="setup-panel__side"><span className="setup-label">PRIMEIROS PASSOS</span><div className="setup-panel__figure" aria-hidden="true"><span /><span /><span /></div><h2 id="setup-title">Seu espaço está<br /><em>ganhando forma.</em></h2><p>Cadastre os serviços, defina o horário de funcionamento do salão e configure o expediente dos profissionais. Os agendamentos respeitarão os dois horários.</p></div><div className="setup-panel__steps"><span className="step-count">CONFIGURAÇÃO INICIAL · {done} DE {overview.nextSteps.length}</span>{overview.nextSteps.map((step, index) => <Link className="setup-step" to={step.href} key={step.label}><span className="setup-step__number">0{index + 1}</span><div><strong>{step.label}</strong><small>{step.completed ? 'Etapa concluída' : 'Abrir configuração'}</small></div><span className="setup-step__status">{step.completed ? 'FEITO' : 'ABRIR ↗'}</span></Link>)}</div></section>}
      <div className="dashboard-summary dashboard-summary--single"><section><p className="eyebrow">ACESSO PÚBLICO</p><h2>Seu link de agendamento</h2><div className="dashboard-public-link"><a href={overview.publicBookingPath} target="_blank" rel="noopener noreferrer">Abrir página de agendamento <span aria-hidden="true">↗</span></a><code>{`${window.location.origin}${overview.publicBookingPath}`}</code></div></section></div>
      <section className="operations" aria-labelledby="operations-title"><div className="operations__heading"><div><p className="eyebrow">SUA OPERAÇÃO</p><h2 id="operations-title">Cadastros do estabelecimento</h2></div><span>Contagem real dos registros ativos da sua empresa.</span></div><div className="operations__grid"><article><span>Serviços ativos</span><strong>{overview.counts.services}</strong><small>Registrados no catálogo</small></article><article><span>Profissionais ativos</span><strong>{overview.counts.professionals}</strong><small>Vinculados ao estabelecimento</small></article><article><span>Clientes ativos</span><strong>{overview.counts.customers}</strong><small>Registros cadastrados</small></article></div></section>
    </>}
  </WorkspaceLayout>;
}
