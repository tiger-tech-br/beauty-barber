import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';

type Cycle = 'monthly' | 'annual';
type RequestItem = {
  id: string; billingCycle: Cycle; billingEmail: string; externalReference: string | null;
  status: 'pending' | 'approved' | 'rejected'; reviewNote: string | null; createdAt: string;
};
type Subscription = {
  billingCycle: Cycle; status: string; activeSince: string; paidThrough: string; isCurrent: boolean;
} | null;
type BillingResponse = {
  plans: { cycle: Cycle; name: string; checkoutUrl: string }[];
  subscription: Subscription; requests: RequestItem[]; verificationMode: 'manual';
};

const cycleName = (cycle: Cycle) => cycle === 'monthly' ? 'Mensal' : 'Anual';
const dateBR = (date: string) => new Date(date).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const requestStatus = { pending: 'Em conferência', approved: 'Aprovada', rejected: 'Não aprovada' };

export function BillingPage() {
  const { account, busy, error: accountError } = useAccount();
  const [data, setData] = useState<BillingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checkingOut, setCheckingOut] = useState<Cycle | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<Cycle>('monthly');
  const [billingEmail, setBillingEmail] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => setData(await apiRequest<BillingResponse>('/api/billing')), []);
  useEffect(() => {
    if (!account || account.role !== 'owner') { setLoading(false); return; }
    let active = true;
    load().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Erro ao consultar assinatura.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, load]);

  async function checkout(cycle: Cycle) {
    setError(''); setNotice(''); setCheckingOut(cycle);
    try {
      const result = await apiRequest<{ checkoutUrl: string }>('/api/billing/checkout', {
        method: 'POST', body: JSON.stringify({ cycle })
      });
      window.location.assign(result.checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível acessar o checkout.');
      setCheckingOut(null);
    }
  }

  async function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice(''); setSubmitting(true);
    try {
      await apiRequest('/api/billing/verification', {
        method: 'POST',
        body: JSON.stringify({ cycle: selectedCycle, billingEmail, externalReference: reference })
      });
      await load();
      setNotice('Solicitação recebida. A liberação depende de conferência no painel do PagBank.');
      setReference('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível solicitar conferência.');
    } finally { setSubmitting(false); }
  }

  if (busy || loading) return <div className="page-state" role="status">Carregando assinatura…</div>;
  if (!account) return <div className="page-state" role="alert">{accountError || 'Entre na conta para continuar.'}</div>;

  return <WorkspaceLayout account={account}>
    <header className="management-heading"><div><p className="eyebrow">CONTA / ASSINATURA</p><h1>Seu plano BeautyBarber</h1><p>Escolha a recorrência e acompanhe a conferência do pagamento.</p></div></header>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status" className="form-success">{notice}</p>}
    {account.role !== 'owner' ? <p className="form-error">Somente o responsável pode gerenciar a assinatura.</p> : <>
      <section className="billing-status" aria-labelledby="billing-status-title">
        <div><p className="eyebrow">SITUAÇÃO ATUAL</p><h2 id="billing-status-title">{data?.subscription?.isCurrent ? 'Assinatura ativa' : 'Assinatura ainda não confirmada'}</h2>
          <p>{data?.subscription?.isCurrent
            ? `Plano ${cycleName(data.subscription.billingCycle)}. Validade registrada até ${dateBR(data.subscription.paidThrough)}.`
            : 'Os links levam ao ambiente seguro do PagBank. O pagamento não ativa automaticamente a plataforma.'}</p>
        </div><span className={`status-pill ${data?.subscription?.isCurrent ? 'status-pill--active' : ''}`}>{data?.subscription?.isCurrent ? 'Ativa' : 'Pendente'}</span>
      </section>

      <section aria-labelledby="billing-plans-title" className="billing-section"><div className="billing-section__title"><p className="eyebrow">COBRANÇA RECORRENTE</p><h2 id="billing-plans-title">Escolha sua frequência</h2></div>
        <div className="billing-grid">{data?.plans.map((plan) => <article key={plan.cycle} className="billing-plan">
          <span className="billing-plan__type">{cycleName(plan.cycle).toUpperCase()}</span>
          <h3>{plan.cycle === 'monthly' ? 'Cobrança mensal' : 'Cobrança anual'}</h3>
          <p>{plan.cycle === 'monthly' ? 'Pagamento recorrente com frequência mensal.' : 'Pagamento recorrente com frequência anual.'}</p>
          <p className="billing-plan__note">O preço e as condições finais são exibidos no checkout do PagBank.</p>
          <button type="button" className="button button--primary" disabled={checkingOut !== null} onClick={() => void checkout(plan.cycle)}>
            {checkingOut === plan.cycle ? 'Abrindo PagBank…' : `Assinar plano ${cycleName(plan.cycle).toLowerCase()}`}
          </button>
        </article>)}</div>
      </section>

      <section className="billing-section" aria-labelledby="billing-verify-title"><div className="billing-section__title"><p className="eyebrow">JÁ PAGOU?</p><h2 id="billing-verify-title">Solicite a conferência</h2><p>Depois de concluir o pagamento, informe o mesmo e-mail utilizado no PagBank. A equipe da plataforma verificará a assinatura no painel oficial. Não envie dados do cartão.</p></div>
        <form className="billing-verification" onSubmit={submitVerification}>
          <label>Plano assinado<select value={selectedCycle} onChange={(e) => setSelectedCycle(e.target.value as Cycle)}><option value="monthly">Mensal</option><option value="annual">Anual</option></select></label>
          <label>E-mail usado no PagBank<input type="email" required autoComplete="email" maxLength={255} value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} placeholder="nome@exemplo.com" /></label>
          <label>Identificador da assinatura (opcional)<input type="text" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Se disponível no PagBank" /></label>
          <button className="button button--secondary" disabled={submitting || data?.requests.some((item) => item.status === 'pending')} type="submit">{submitting ? 'Enviando…' : 'Solicitar conferência'}</button>
        </form>
      </section>

      <section className="billing-section" aria-labelledby="billing-history-title"><div className="billing-section__title"><p className="eyebrow">ACOMPANHAMENTO</p><h2 id="billing-history-title">Solicitações enviadas</h2></div>
        {data?.requests.length ? <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Enviada em</th><th>Plano</th><th>Situação</th><th>Observação</th></tr></thead><tbody>
          {data.requests.map((item) => <tr key={item.id}><td>{dateBR(item.createdAt)}</td><td>{cycleName(item.billingCycle)}</td><td>{requestStatus[item.status]}</td><td>{item.reviewNote || '—'}</td></tr>)}
        </tbody></table></div> : <p className="billing-empty">Nenhuma conferência solicitada ainda.</p>}
      </section>
    </>}
  </WorkspaceLayout>;
}
