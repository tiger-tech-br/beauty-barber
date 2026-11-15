import { useCallback, useEffect, useState } from 'react';
import { PlatformLayout } from '../components/PlatformLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';

type PendingRequest = {
  id: string; establishmentId: string; establishmentName: string; billingCycle: 'monthly' | 'annual';
  billingEmail: string; externalReference: string | null; createdAt: string; requestedBy: string;
};

export function PlatformBillingPage() {
  const { account, busy, error: accountError } = useAccount();
  const [items, setItems] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<PendingRequest | null>(null);
  const [paidThrough, setPaidThrough] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const result = await apiRequest<{ items: PendingRequest[] }>('/api/platform/billing-requests');
    setItems(result.items);
  }, []);

  useEffect(() => {
    if (!account?.isPlatformAdmin) { setLoading(false); return; }
    let active = true;
    load().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Erro ao buscar solicitações.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, load]);

  function select(item: PendingRequest) {
    setSelected(item); setReference(item.externalReference ?? ''); setNote(''); setPaidThrough('');
    setError(''); setNotice('');
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!selected) return;
    if (decision === 'reject' && note.trim().length < 5) {
      setError('Informe o motivo da recusa.'); return;
    }
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/platform/billing-requests/${selected.id}/review`, {
        method: 'POST',
        body: JSON.stringify(decision === 'approve'
          ? { decision, paidThrough, externalReference: reference, note }
          : { decision, note })
      });
      setNotice(decision === 'approve' ? 'Assinatura ativada após conferência.' : 'Solicitação recusada.');
      setSelected(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível revisar.'); }
    finally { setSaving(false); }
  }

  if (busy || loading) return <div className="page-state" role="status">Carregando solicitações…</div>;
  if (!account) return <div className="page-state" role="alert">{accountError || 'Entre na conta para continuar.'}</div>;

  return <PlatformLayout account={account}>
    <header className="management-heading"><div><p className="eyebrow">ADMINISTRAÇÃO GERAL</p><h1>Conferência de assinaturas</h1><p>Reveja os pagamentos no painel do PagBank antes de tomar qualquer decisão.</p></div></header>
    {!account.isPlatformAdmin ? <p className="form-error">Acesso restrito à administração da plataforma.</p> : <>
      <p className="billing-warning"><strong>Atenção:</strong> nome, e-mail e identificador informados pelo cliente não comprovam pagamento. Abra o PagBank separadamente e confirme o pagamento recorrente, período, titular e ausência de cancelamento.</p>
      {notice && <p className="form-success" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      <div className={`platform-review-layout ${selected ? 'platform-review-layout--selected' : ''}`}>
      <section className="management-panel"><div className="management-toolbar"><strong>{items.length} solicitação(ões) pendente(s)</strong></div>
        {!items.length ? <div className="empty-records"><strong>Nenhuma solicitação pendente.</strong><p>Solicitações de conferência de assinatura aparecerão aqui.</p></div> : <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Estabelecimento</th><th>Plano</th><th>E-mail informado</th><th>Enviada em</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}>
          <td className="record-table__primary">{item.establishmentName}</td><td>{item.billingCycle === 'monthly' ? 'Mensal' : 'Anual'}</td><td>{item.billingEmail}</td><td>{new Date(item.createdAt).toLocaleDateString('pt-BR')}</td>
          <td><button className="record-link" type="button" onClick={() => select(item)}>Conferir</button></td>
        </tr>)}</tbody></table></div>}
      </section>
      {selected && <section className="management-editor" aria-labelledby="billing-review-title"><div className="management-editor__header"><div><p className="eyebrow">CONFERÊNCIA MANUAL</p><h2 id="billing-review-title">{selected.establishmentName}</h2></div><button className="close-editor" type="button" onClick={() => setSelected(null)} aria-label="Fechar conferência">×</button></div>
        <form className="management-form" onSubmit={(event) => { event.preventDefault(); void decide('approve'); }}>
          <p className="management-form__wide">Solicitante: {selected.requestedBy} · Identificador informado: {selected.externalReference || 'não informado'}.</p>
          <label>Identificador conferido no PagBank<input required minLength={5} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
          <label>Assinatura paga até<input type="date" required value={paidThrough} onChange={(e) => setPaidThrough(e.target.value)} /></label>
          <label className="management-form__wide">Observação administrativa<input maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional ao aprovar; obrigatório ao recusar" /></label>
          <div className="management-form__actions"><button type="button" disabled={saving} className="button button--secondary" onClick={() => void decide('reject')}>Recusar solicitação</button><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Processando…' : 'Confirmar pagamento e ativar'}</button></div>
        </form></section>}
      </div>
    </>}
  </PlatformLayout>;
}
