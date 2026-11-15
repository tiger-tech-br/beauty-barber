import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';

type Service = {
  id: string; name: string; category: 'cabelo' | 'barba' | 'unhas' | 'estetica' | 'personalizada';
  description: string | null; durationMinutes: number; priceCents: number; active: boolean;
};
type Draft = Omit<Service, 'id' | 'priceCents'> & { price: string };
const empty: Draft = { name: '', category: 'cabelo', description: '', durationMinutes: 45, price: '', active: true };
const categories = { cabelo: 'Cabelo', barba: 'Barba', unhas: 'Unhas', estetica: 'Estética', personalizada: 'Personalizada' };
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);

export function ServicesPage() {
  const { account, busy, error: accountError } = useAccount();
  const [items, setItems] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const result = await apiRequest<{ items: Service[] }>('/api/services');
    setItems(result.items);
  }, []);

  useEffect(() => {
    if (!account) return;
    let active = true;
    load().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Erro ao carregar serviços.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, load]);

  function openNew() { setEditingId(null); setDraft({ ...empty }); setEditorOpen(true); setError(''); setNotice(''); }
  function openEdit(service: Service) {
    setEditingId(service.id);
    setDraft({ name: service.name, category: service.category, description: service.description, durationMinutes: service.durationMinutes, price: (service.priceCents / 100).toFixed(2), active: service.active });
    setEditorOpen(true); setError(''); setNotice('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setNotice('');
    try {
      const value = Number(draft.price.replace(',', '.'));
      if (!Number.isFinite(value) || value < 0 || value > 100000) throw new Error('Informe um preço válido.');
      const payload = { name: draft.name, category: draft.category, description: draft.description || null, durationMinutes: Number(draft.durationMinutes), priceCents: Math.round(value * 100), active: draft.active };
      await apiRequest(editingId ? `/api/services/${editingId}` : '/api/services', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      await load();
      setNotice(editingId ? 'Serviço atualizado.' : 'Serviço cadastrado.');
      setEditorOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }

  if (busy || (account && loading)) return <div className="page-state" role="status">Carregando catálogo…</div>;
  if (!account) return <div className="page-state" role="alert">{accountError || 'Verificando sua conta…'}</div>;

  const filtered = items.filter((item) => `${item.name} ${categories[item.category]}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <WorkspaceLayout account={account}>
    <div className="management-heading"><div><p className="eyebrow">GESTÃO / SERVIÇOS</p><h1>Serviços</h1><p>Defina a duração e o preço de cada serviço oferecido pelo estabelecimento.</p></div><button className="button button--primary" type="button" onClick={openNew}>Novo serviço <span aria-hidden="true">+</span></button></div>
    <div className="management-panel"><div className="management-toolbar"><div><strong>{items.length} serviços cadastrados</strong><small>Os inativos ficam preservados no histórico.</small></div><label className="search-field"><span className="sr-only">Buscar serviços</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar serviço ou categoria" type="search" /></label></div>
      {notice && <p className="form-success" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p className="empty-records">Carregando serviços…</p> : filtered.length === 0 ? <div className="empty-records"><strong>{items.length ? 'Nenhum serviço encontrado.' : 'Nenhum serviço cadastrado.'}</strong><p>{items.length ? 'Tente outro termo de busca.' : 'Clique em Novo serviço para informar nome, duração e preço.'}</p></div> : <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Serviço</th><th>Categoria</th><th>Duração</th><th>Preço</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td className="record-table__primary">{item.name}{item.description && <small>{item.description}</small>}</td><td>{categories[item.category]}</td><td>{item.durationMinutes} min</td><td>{money(item.priceCents)}</td><td><span className={`status-pill ${item.active ? 'status-pill--active' : ''}`}>{item.active ? 'Ativo' : 'Inativo'}</span></td><td><button className="record-link" type="button" onClick={() => openEdit(item)}>Editar</button></td></tr>)}</tbody></table></div>}
    </div>
    {editorOpen && <section className="management-editor" aria-labelledby="service-editor-title"><div className="management-editor__header"><div><p className="eyebrow">CATÁLOGO</p><h2 id="service-editor-title">{editingId ? 'Editar serviço' : 'Adicionar serviço'}</h2></div><button type="button" className="close-editor" onClick={() => setEditorOpen(false)} aria-label="Fechar formulário">×</button></div><form className="management-form" onSubmit={save}>
      <label>Nome do serviço<input required minLength={2} maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ex.: Corte feminino" /></label>
      <label>Categoria<select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Service['category'] })}>{Object.entries(categories).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <label className="management-form__wide">Descrição (opcional)<textarea maxLength={500} rows={2} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Detalhes que ajudam a equipe a entender o serviço" /></label>
      <label>Duração em minutos<input required type="number" min={5} max={600} step={5} value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })} /></label>
      <label>Preço em R$<input required type="number" min={0} max={100000} step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="Ex.: 50,00" /></label>
      <label className="form-checkbox management-form__wide"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Serviço ativo para novos atendimentos</label>
      <div className="management-form__actions"><button type="button" className="button button--secondary" onClick={() => setEditorOpen(false)}>Cancelar</button><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar serviço'}</button></div>
    </form></section>}
  </WorkspaceLayout>;
}

