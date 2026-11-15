import { useCallback, useEffect, useState } from 'react';
import { PlatformLayout } from '../components/PlatformLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';

type Business = {
  id: string; name: string; slug: string; active: boolean; createdAt: string;
  subscriptionStatus: 'active' | 'suspended' | 'cancelled' | 'expired' | null;
  billingCycle: 'monthly' | 'annual' | null; paidThrough: string | null; subscriptionCurrent: boolean | null;
};
type Data = { items: Business[]; summary: { total: number; current: number; suspended: number } };

export function PlatformEstablishmentsPage() {
  const { account, busy, error: authError } = useAccount();
  const [data, setData] = useState<Data | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Business | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [businesses, pending] = await Promise.all([
      apiRequest<Data>('/api/platform/establishments'),
      apiRequest<{ items: unknown[] }>('/api/platform/billing-requests')
    ]);
    setData(businesses);
    setPendingCount(pending.items.length);
  }, []);
  useEffect(() => {
    if (!account?.isPlatformAdmin) { setLoading(false); return; }
    let active = true;
    load().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar estabelecimentos.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, load]);

  async function changeStatus() {
    if (!selected || note.trim().length < 5) { setError('Informe um motivo de pelo menos 5 caracteres.'); return; }
    const action = selected.subscriptionStatus === 'active' ? 'suspend' : 'reactivate';
    if (!window.confirm(`${action === 'suspend' ? 'Suspender' : 'Reativar'} a assinatura de ${selected.name}?`)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/platform/subscriptions/${selected.id}/status`, {
        method: 'PATCH', body: JSON.stringify({ action, note })
      });
      setSelected(null); setNote(''); await load();
      setNotice('Situação da assinatura atualizada com registro de auditoria.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a assinatura.'); }
    finally { setSaving(false); }
  }

  if (busy || loading) return <div className="page-state" role="status">Carregando administração…</div>;
  if (!account) return <div className="page-state" role="alert">{authError || 'Entre na conta para continuar.'}</div>;

  return <PlatformLayout account={account}>
    <header className="management-heading"><div><p className="eyebrow">ADMINISTRAÇÃO DA PLATAFORMA</p><h1>Gestão de assinaturas</h1><p>Estabelecimentos e situação das assinaturas, sem acesso a dados pessoais dos clientes.</p></div></header>
    {!account.isPlatformAdmin ? <p className="form-error" role="alert">Acesso restrito à administração da plataforma.</p> : <>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}
      <section className="platform-metrics" aria-label="Resumo real da plataforma"><article><span>Estabelecimentos cadastrados</span><strong>{data?.summary.total ?? 0}</strong></article><article><span>Assinaturas vigentes</span><strong>{data?.summary.current ?? 0}</strong></article><article><span>Suspensas</span><strong>{data?.summary.suspended ?? 0}</strong></article><article><span>Aguardando conferência</span><strong>{pendingCount ?? '—'}</strong></article></section>
      <section className="management-panel"><div className="management-toolbar"><strong>Últimos estabelecimentos cadastrados</strong></div>
        {!data?.items.length ? <p className="empty-records">Nenhum estabelecimento cadastrado.</p> : <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Estabelecimento</th><th>Ciclo</th><th>Assinatura</th><th>Válida até</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>
          {data.items.map((item) => <tr key={item.id}><td className="record-table__primary">{item.name}<small> · {item.slug}</small></td>
            <td>{item.billingCycle === 'monthly' ? 'Mensal' : item.billingCycle === 'annual' ? 'Anual' : '—'}</td>
            <td>{item.subscriptionStatus === 'suspended' ? 'Suspensa' : item.subscriptionCurrent ? 'Ativa' : item.subscriptionStatus ? 'Sem vigência' : 'Não confirmada'}</td>
            <td>{item.paidThrough ? new Date(item.paidThrough).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '—'}</td>
            <td>{(item.subscriptionStatus === 'active' || (item.subscriptionStatus === 'suspended' && item.paidThrough && new Date(item.paidThrough).getTime() > Date.now()))
              && <button className="record-link" type="button" onClick={() => { setSelected(item); setNote(''); setError(''); }}>Gerenciar</button>}</td>
          </tr>)}
        </tbody></table></div>}
      </section>
      {selected && <section className="management-editor" aria-labelledby="subscription-management-title"><div className="management-editor__header"><div><p className="eyebrow">CONTROLE DE ASSINATURA</p><h2 id="subscription-management-title">{selected.name}</h2></div><button className="close-editor" type="button" onClick={() => setSelected(null)} aria-label="Fechar edição">×</button></div>
        <form className="management-form" onSubmit={(event) => { event.preventDefault(); void changeStatus(); }}>
          <p className="management-form__wide">Uma suspensão pode impedir novas operações quando o controle de assinatura estiver ativado. Reativar não prolonga o prazo pago nem comprova novos pagamentos.</p>
          <label className="management-form__wide">Motivo administrativo<input required minLength={5} maxLength={400} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Registre a justificativa da alteração" /></label>
          <div className="management-form__actions"><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Processando…' : selected.subscriptionStatus === 'active' ? 'Suspender assinatura' : 'Reativar assinatura'}</button></div>
        </form>
      </section>}
    </>}
  </PlatformLayout>;
}
