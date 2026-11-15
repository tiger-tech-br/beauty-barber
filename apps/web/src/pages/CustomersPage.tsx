import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';
import { formatInZone } from '../lib/dates';

type Customer = { id: string; fullName: string; email: string | null; phone: string | null; notes: string | null; active: boolean };
type CustomerAppointment = {
  id: string; startsAt: string; endsAt: string; status: string;
  priceCents: number; serviceName: string; professionalName: string;
};
type Draft = Omit<Customer, 'id'>;
const empty: Draft = { fullName: '', email: '', phone: '', notes: '', active: true };
const statusLabels: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmado', in_progress: 'Em atendimento',
  completed: 'Concluído', cancelled: 'Cancelado', no_show: 'Faltou' };
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function CustomersPage() {
  const { account, busy, error: accountError } = useAccount();
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [historyFor, setHistoryFor] = useState<Customer | null>(null);
  const [historyItems, setHistoryItems] = useState<CustomerAppointment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [exportPassword, setExportPassword] = useState('');

  const load = useCallback(async () => {
    const response = await apiRequest<{ items: Customer[] }>('/api/customers');
    setItems(response.items);
  }, []);

  useEffect(() => {
    if (!account) return;
    let active = true;
    load().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar clientes.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, load]);

  function newCustomer() { setEditingId(null); setDraft({ ...empty }); setEditorOpen(true); setHistoryFor(null); setNotice(''); setError(''); }
  function editCustomer(item: Customer) { setEditingId(item.id); setDraft({ fullName: item.fullName, email: item.email, phone: item.phone, notes: item.notes, active: item.active }); setEditorOpen(true); setHistoryFor(null); setNotice(''); setError(''); }

  async function viewHistory(item: Customer) {
    setEditorOpen(false); setHistoryFor(item); setHistoryItems([]); setHistoryLoading(true); setError(''); setNotice(''); setExportPassword('');
    try {
      const response = await apiRequest<{ items: CustomerAppointment[] }>(`/api/customers/${item.id}/history`);
      setHistoryItems(response.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível consultar atendimentos do cliente.'); }
    finally { setHistoryLoading(false); }
  }

  async function exportCustomer(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (account?.role!=='owner' || !historyFor) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/account/customers/${encodeURIComponent(historyFor.id)}/export`,{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({password:exportPassword})
      });
      if (!response.ok) {
        const result = await response.json().catch(()=>({error:'Não foi possível exportar os dados.'})) as {error?:string};
        throw new Error(result.error||'Não foi possível exportar os dados.');
      }
      const fileUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = `beautybarber-cliente-${historyFor.id}.json`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(fileUrl),1000);
      setExportPassword('');
      setNotice('Arquivo preparado. Confirme a identidade do cliente antes de compartilhar e proteja os dados pessoais.');
    } catch (cause) {setError(cause instanceof Error?cause.message:'Não foi possível exportar os dados.');}
    finally {setSaving(false);}
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest(editingId ? `/api/customers/${editingId}` : '/api/customers', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(draft) });
      await load();
      setNotice(editingId ? 'Cliente atualizado.' : 'Cliente cadastrado.'); setEditorOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }

  if (busy || (account && loading)) return <div className="page-state" role="status">Carregando clientes…</div>;
  if (!account) return <div className="page-state" role="alert">{accountError || 'Verificando sua conta…'}</div>;
  const filtered = items.filter((item) => `${item.fullName} ${item.email ?? ''} ${item.phone ?? ''}`.toLowerCase().includes(search.toLowerCase().trim()));

  return <WorkspaceLayout account={account}>
    <div className="management-heading"><div><p className="eyebrow">GESTÃO / CLIENTES</p><h1>Clientes</h1><p>Consulte os contatos cadastrados e o histórico de atendimentos.</p></div><button className="button button--primary" type="button" onClick={newCustomer}>Novo cliente <span aria-hidden="true">+</span></button></div>
    <div className="management-panel"><div className="management-toolbar"><div><strong>{items.length} clientes cadastrados</strong><small>Somente o nome é obrigatório.</small></div><label className="search-field"><span className="sr-only">Buscar clientes</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome ou contato" /></label></div>
      {notice && <p className="form-success" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      {filtered.length === 0 ? <div className="empty-records"><strong>{items.length ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado.'}</strong><p>{items.length ? 'Experimente outro termo de busca.' : 'Clique em Novo cliente para registrar os dados de contato.'}</p></div> : <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Nome</th><th>Contato</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td className="record-table__primary">{item.fullName}</td><td>{item.phone || item.email || 'Não informado'}</td><td><span className={`status-pill ${item.active ? 'status-pill--active' : ''}`}>{item.active ? 'Ativo' : 'Inativo'}</span></td><td><div className="table-actions"><button className="record-link" type="button" onClick={() => editCustomer(item)}>Editar</button><button className="record-link" type="button" onClick={() => void viewHistory(item)}>Histórico</button></div></td></tr>)}</tbody></table></div>}
    </div>
    {editorOpen && <section className="management-editor" aria-labelledby="customer-editor-title"><div className="management-editor__header"><div><p className="eyebrow">CADASTRO</p><h2 id="customer-editor-title">{editingId ? 'Editar cliente' : 'Adicionar cliente'}</h2></div><button className="close-editor" onClick={() => setEditorOpen(false)} type="button" aria-label="Fechar formulário">×</button></div><form className="management-form" onSubmit={save}>
      <label>Nome completo<input required minLength={2} maxLength={120} value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} placeholder="Nome do cliente" /></label>
      <label>Telefone (opcional)<input type="tel" maxLength={25} value={draft.phone ?? ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="(11) 99999-9999" /></label>
      <label className="management-form__wide">E-mail (opcional)<input type="email" maxLength={255} value={draft.email ?? ''} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="cliente@exemplo.com" /></label>
      <label className="management-form__wide">Observações operacionais (opcional)<textarea maxLength={500} rows={3} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Registre somente o necessário para o atendimento; evite dados sensíveis." /></label>
      <label className="form-checkbox management-form__wide"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Cadastro ativo</label>
      <div className="management-form__actions"><button className="button button--secondary" type="button" onClick={() => setEditorOpen(false)}>Cancelar</button><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar cliente'}</button></div>
    </form></section>}
    {historyFor && <section className="management-editor" aria-labelledby="customer-history-title">
      <div className="management-editor__header"><div><p className="eyebrow">CLIENTES / ATENDIMENTOS</p><h2 id="customer-history-title">Histórico de {historyFor.fullName}</h2></div><button className="close-editor" type="button" aria-label="Fechar histórico" onClick={() => setHistoryFor(null)}>×</button></div>
      <p className="management-hint">Últimos 100 agendamentos deste cliente, incluindo faltas e cancelamentos. O valor corresponde ao serviço registrado, não necessariamente a um pagamento recebido.</p>
      {historyLoading ? <p className="management-hint" role="status">Carregando histórico…</p> : historyItems.length ? <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Data</th><th>Serviço</th><th>Profissional</th><th>Valor do serviço</th><th>Situação</th></tr></thead><tbody>{historyItems.map((item) => <tr key={item.id}><td>{formatInZone(item.startsAt, account.establishmentTimezone)}</td><td className="record-table__primary">{item.serviceName}</td><td>{item.professionalName}</td><td>{money(item.priceCents)}</td><td>{statusLabels[item.status] || item.status}</td></tr>)}</tbody></table></div> : <p className="management-hint">Este cliente ainda não possui atendimentos registrados.</p>}
      {account.role==='owner' && <><h3 className="settings-subheading">Exportar dados deste cliente</h3>
        <p className="management-hint">A exportação inclui cadastro, agendamentos, histórico e recebimentos relacionados a este cliente. Exige sua senha e fica registrada. Antes de entregar o arquivo, confirme a identidade de quem solicitou e proteja os dados.</p>
        <form className="management-form" onSubmit={(event)=>void exportCustomer(event)}>
          <label>Confirme sua senha<input required type="password" autoComplete="current-password" value={exportPassword} onChange={(event)=>setExportPassword(event.target.value)} /></label>
          <div className="management-form__actions"><button className="button button--secondary" type="submit" disabled={saving}>{saving?'Preparando…':'Baixar dados do cliente'}</button></div>
        </form></>}
    </section>}
  </WorkspaceLayout>;
}

