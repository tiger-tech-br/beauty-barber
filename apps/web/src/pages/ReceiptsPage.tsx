import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';
import { DEFAULT_TIMEZONE, formatInZone, todayInZone } from '../lib/dates';

type Unpaid = { appointmentId: string; customerName: string; serviceName: string; priceCents: number; remainingCents: number; startsAt: string };
type Receipt = { id: string; appointmentId: string; customerName: string; serviceName: string; amountCents: number; method: string; status: 'recorded' | 'voided'; notes: string | null; receivedAt: string; voidReason: string | null };
const brl = (cents: number) => (cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const methods: Record<string,string> = { cash:'Dinheiro',pix:'Pix',card:'Cartão',transfer:'Transferência',other:'Outro' };

export function ReceiptsPage() {
  const { account, busy, error: accountError } = useAccount();
  const timezone = account?.establishmentTimezone ?? DEFAULT_TIMEZONE;
  const [from, setFrom] = useState(() => `${todayInZone().slice(0,7)}-01`);
  const [to, setTo] = useState(todayInZone);
  const [unpaid, setUnpaid] = useState<Unpaid[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [appointmentId, setAppointmentId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('pix');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (start: string, finish: string, signal?: AbortSignal) => {
    const qs = new URLSearchParams({ from: start, to: finish });
    const [pending, ledger] = await Promise.all([
      apiRequest<{ items: Unpaid[] }>('/api/finance/unpaid', { signal }),
      apiRequest<{ items: Receipt[] }>(`/api/finance/receipts?${qs}`, { signal })
    ]);
    if (!signal?.aborted) { setUnpaid(pending.items); setReceipts(ledger.items); }
  }, []);
  useEffect(() => {
    if (!account || account.role === 'professional') { setLoading(false); return; }
    const controller = new AbortController();
    const today = todayInZone(timezone);
    const firstDay = `${today.slice(0,7)}-01`;
    setFrom(firstDay);
    setTo(today);
    setLoading(true);
    load(firstDay, today, controller.signal)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Erro ao carregar recebimentos.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [account?.establishmentId, account?.role, timezone, load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice(''); setSaving(true);
    try {
      const cents = Math.round(Number(amount.replace(',','.')) * 100);
      if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Informe um valor positivo válido.');
      await apiRequest('/api/finance/receipts', { method:'POST', body:JSON.stringify({ appointmentId, amountCents:cents, method, notes }) });
      await load(from,to); setNotice('Recebimento registrado.'); setAppointmentId(''); setAmount(''); setNotes('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível registrar.'); }
    finally { setSaving(false); }
  }
  async function voidReceipt(receipt: Receipt) {
    const reason = window.prompt('Informe o motivo do estorno deste lançamento:');
    if (!reason) return;
    setError(''); setNotice('');
    try {
      await apiRequest(`/api/finance/receipts/${receipt.id}/void`, { method:'POST', body:JSON.stringify({ reason }) });
      await load(from,to); setNotice('Lançamento estornado no controle interno.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível estornar.'); }
  }

  if (busy || loading) return <div className="page-state" role="status">Carregando recebimentos…</div>;
  if (!account) return <div className="page-state" role="alert">{accountError || 'Entre na conta para continuar.'}</div>;

  return <WorkspaceLayout account={account}>
    <header className="management-heading"><div><p className="eyebrow">GESTÃO / FINANCEIRO</p><h1>Recebimentos</h1><p>Registre pagamentos de atendimentos concluídos. Este módulo não realiza cobranças online.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
    {account.role === 'professional' ? <p className="form-error">Acesso restrito à administração e recepção.</p> : <>
      <section className="management-editor"><h2>Registrar pagamento recebido</h2><form className="management-form" onSubmit={submit}>
        <label className="management-form__wide">Atendimento concluído com saldo pendente<select required value={appointmentId} onChange={(e) => { setAppointmentId(e.target.value); const selected=unpaid.find((u)=>u.appointmentId===e.target.value); setAmount(selected ? (selected.remainingCents/100).toFixed(2):''); }}><option value="">Selecione um atendimento</option>{unpaid.map((item) => <option key={item.appointmentId} value={item.appointmentId}>{item.customerName} · {item.serviceName} · Restante: {brl(item.remainingCents)}</option>)}</select></label>
        <label>Valor recebido (R$)<input required type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" /></label>
        <label>Forma de pagamento<select value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(methods).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="management-form__wide">Observações (opcional)<input value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="management-form__actions"><button disabled={saving || !appointmentId} type="submit" className="button button--primary">{saving ? 'Salvando…' : 'Registrar recebimento'}</button></div>
      </form></section>
      <section className="management-panel receipts-ledger"><div className="management-toolbar"><h2>Lançamentos</h2><form className="report-filters" onSubmit={(e) => { e.preventDefault(); setLoading(true); void load(from,to).catch((cause:unknown)=>setError(cause instanceof Error?cause.message:'Erro ao filtrar.')).finally(()=>setLoading(false)); }}><label>De<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>Até<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label><button type="submit" className="button button--secondary">Filtrar</button></form></div>
        {receipts.length ? <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Data</th><th>Cliente/Serviço</th><th>Forma</th><th>Valor</th><th>Situação</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{receipts.map((item) => <tr key={item.id}><td>{formatInZone(item.receivedAt, timezone, { dateStyle: 'short' })}</td><td>{item.customerName} · {item.serviceName}</td><td>{methods[item.method]}</td><td>{brl(item.amountCents)}</td><td>{item.status==='recorded'?'Registrado':'Estornado'}</td><td>{item.status==='recorded' && account.role==='owner' && <button className="record-link" type="button" onClick={() => void voidReceipt(item)}>Estornar</button>}</td></tr>)}</tbody></table></div> : <p className="report-empty">Nenhum recebimento registrado neste período.</p>}
      </section>
    </>}
  </WorkspaceLayout>;
}
