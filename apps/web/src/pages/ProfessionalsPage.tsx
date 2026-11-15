import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';
import { businessLocalToUtcIso, DEFAULT_TIMEZONE, formatInZone } from '../lib/dates';

type Professional = { id: string; fullName: string; specialty: string | null; active: boolean; serviceIds: string[]; userId: string | null };
type Service = { id: string; name: string; active: boolean };
type Draft = Pick<Professional, 'fullName' | 'specialty' | 'active' | 'serviceIds'>;
type Period = { weekday: number; startMinute: number; endMinute: number };
type ScheduleBlock = { id: string; startsAt: string; endsAt: string; reason: string | null };
type TeamMember = { id: string; fullName: string; role: string; active: boolean };
const empty: Draft = { fullName: '', specialty: '', active: true, serviceIds: [] };
const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const minuteToTime = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const timeToMinute = (v: string) => { const [hour, minute] = v.split(':').map(Number); return hour * 60 + minute; };

export function ProfessionalsPage() {
  const { account, busy, error: accountError } = useAccount();
  const timezone = account?.establishmentTimezone ?? DEFAULT_TIMEZONE;
  const [items, setItems] = useState<Professional[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [scheduleFor, setScheduleFor] = useState<Professional | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [blocksFor, setBlocksFor] = useState<Professional | null>(null);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [linkFor, setLinkFor] = useState<Professional | null>(null);
  const [linkedUserId, setLinkedUserId] = useState('');

  const load = useCallback(async () => {
    const [team, catalog] = await Promise.all([
      apiRequest<{ items: Professional[] }>('/api/professionals'),
      apiRequest<{ items: Service[] }>('/api/services')
    ]);
    setItems(team.items); setServices(catalog.items);
  }, []);

  useEffect(() => {
    if (!account) return;
    let active = true;
    load().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Erro ao carregar equipe.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [account, load]);

  useEffect(() => {
    if (account?.role !== 'owner') return;
    let active = true;
    apiRequest<{ users: TeamMember[] }>('/api/team')
      .then((data) => { if (active) setTeamMembers(data.users); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [account]);

  function newProfessional() { setDraft({ ...empty, serviceIds: [] }); setEditingId(null); setEditorOpen(true); setScheduleFor(null); setBlocksFor(null); setLinkFor(null); setError(''); setNotice(''); }
  function editProfessional(item: Professional) { setDraft({ fullName: item.fullName, specialty: item.specialty, active: item.active, serviceIds: [...item.serviceIds] }); setEditingId(item.id); setEditorOpen(true); setScheduleFor(null); setBlocksFor(null); setLinkFor(null); setError(''); setNotice(''); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest(editingId ? `/api/professionals/${editingId}` : '/api/professionals', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(draft) });
      await load();
      setNotice(editingId ? 'Profissional atualizado.' : 'Profissional cadastrado.'); setEditorOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }

  async function openHours(item: Professional) {
    setError(''); setNotice(''); setEditorOpen(false); setBlocksFor(null); setLinkFor(null); setScheduleFor(item); setScheduleLoading(true);
    try {
      const data = await apiRequest<{ periods: Period[] }>(`/api/professionals/${item.id}/working-hours`);
      setPeriods(data.periods);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível buscar expediente.'); }
    finally { setScheduleLoading(false); }
  }

  async function saveHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!scheduleFor) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/professionals/${scheduleFor.id}/working-hours`, { method: 'PUT', body: JSON.stringify({ periods }) });
      setNotice('Expediente salvo. Os horários serão usados no cálculo de disponibilidade da agenda.'); setScheduleFor(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar expediente.'); }
    finally { setSaving(false); }
  }

  async function loadBlocks(professionalId: string) {
    const response = await apiRequest<{ items: ScheduleBlock[] }>(`/api/calendar/blocks?professionalId=${encodeURIComponent(professionalId)}`);
    setBlocks(response.items);
  }

  async function openBlocks(item: Professional) {
    setError(''); setNotice(''); setEditorOpen(false); setScheduleFor(null); setLinkFor(null); setBlocksFor(item);
    setBlockStart(''); setBlockEnd(''); setBlockReason(''); setBlocksLoading(true);
    try { await loadBlocks(item.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível buscar folgas.'); }
    finally { setBlocksLoading(false); }
  }

  async function addBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!blocksFor) return;
    const startIso = businessLocalToUtcIso(blockStart, timezone);
    const endIso = businessLocalToUtcIso(blockEnd, timezone);
    if (!startIso || !endIso || Date.parse(endIso) <= Date.parse(startIso)) {
      setError('Informe datas válidas; o fim do bloqueio precisa ser posterior ao início.'); return;
    }
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest('/api/calendar/blocks', { method: 'POST', body: JSON.stringify({
        professionalId: blocksFor.id,
        startsAt: startIso, endsAt: endIso, reason: blockReason
      }) });
      await loadBlocks(blocksFor.id);
      setNotice('Período bloqueado. Não serão oferecidos novos horários durante a folga.');
      setBlockStart(''); setBlockEnd(''); setBlockReason('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível bloquear o período.'); }
    finally { setSaving(false); }
  }

  async function removeBlock(blockId: string) {
    if (!blocksFor || !window.confirm('Remover este bloqueio e voltar a disponibilizar o período na agenda?')) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/calendar/blocks/${blockId}`, { method: 'DELETE' });
      await loadBlocks(blocksFor.id);
      setNotice('Bloqueio removido. Os horários poderão ficar disponíveis novamente.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível remover o bloqueio.'); }
    finally { setSaving(false); }
  }

  function openAccountLink(item: Professional) {
    setError(''); setNotice(''); setEditorOpen(false); setScheduleFor(null); setBlocksFor(null);
    setLinkFor(item); setLinkedUserId(item.userId ?? '');
  }

  async function saveAccountLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!linkFor) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/professionals/${linkFor.id}/account`, {
        method: 'PUT', body: JSON.stringify({ userId: linkedUserId || null })
      });
      await load(); setLinkFor(null); setNotice('Conta vinculada. O profissional poderá consultar somente seus próprios atendimentos.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível vincular a conta.'); }
    finally { setSaving(false); }
  }

  if (busy || (account && loading)) return <div className="page-state" role="status">Carregando equipe…</div>;
  if (!account) return <div className="page-state" role="alert">{accountError || 'Verificando sua conta…'}</div>;

  return <WorkspaceLayout account={account}>
    <div className="management-heading"><div><p className="eyebrow">GESTÃO / PROFISSIONAIS</p><h1>Pessoas que fazem acontecer</h1><p>Organize sua equipe, defina especialidades, serviços, expedientes e folgas.</p></div><button className="button button--primary" type="button" onClick={newProfessional}>Novo profissional <span aria-hidden="true">+</span></button></div>
    <div className="management-panel"><div className="management-toolbar"><div><strong>{items.length} profissionais cadastrados</strong><small>Defina o expediente de cada profissional separadamente.</small></div></div>
      {notice && <p className="form-success" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      {items.length === 0 ? <div className="empty-records"><strong>Comece pela sua equipe.</strong><p>Cadastre quem atende no estabelecimento para depois configurar a agenda.</p></div> : <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Nome</th><th>Especialidade</th><th>Serviços habilitados</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className="record-table__primary">{item.fullName}</td><td>{item.specialty || 'Não informada'}</td><td>{item.serviceIds.length} serviço(s)</td><td><span className={`status-pill ${item.active ? 'status-pill--active' : ''}`}>{item.active ? 'Ativo' : 'Inativo'}</span></td><td><div className="table-actions"><button className="record-link" type="button" onClick={() => editProfessional(item)}>Editar</button><button className="record-link" type="button" onClick={() => void openHours(item)}>Expediente</button><button className="record-link" type="button" onClick={() => void openBlocks(item)}>Folgas</button>{account.role === 'owner' && <button className="record-link" type="button" onClick={() => openAccountLink(item)}>{item.userId ? 'Trocar conta' : 'Vincular conta'}</button>}</div></td></tr>)}</tbody></table></div>}
    </div>
    {editorOpen && <section className="management-editor" aria-labelledby="professional-editor-title"><div className="management-editor__header"><div><p className="eyebrow">EQUIPE</p><h2 id="professional-editor-title">{editingId ? 'Editar profissional' : 'Adicionar profissional'}</h2></div><button className="close-editor" onClick={() => setEditorOpen(false)} type="button" aria-label="Fechar formulário">×</button></div><form className="management-form" onSubmit={save}>
      <label>Nome completo<input required minLength={2} maxLength={120} value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} placeholder="Ex.: Camila Oliveira" /></label>
      <label>Especialidade (opcional)<input maxLength={120} value={draft.specialty ?? ''} onChange={(e) => setDraft({ ...draft, specialty: e.target.value })} placeholder="Ex.: Cabeleireira e colorista" /></label>
      <fieldset className="management-form__wide service-select"><legend>Serviços que pode realizar</legend>{services.filter((service) => service.active || draft.serviceIds.includes(service.id)).map((service) => <label className="form-checkbox" key={service.id}><input type="checkbox" disabled={!service.active} checked={draft.serviceIds.includes(service.id)} onChange={(e) => setDraft({ ...draft, serviceIds: e.target.checked ? [...draft.serviceIds, service.id] : draft.serviceIds.filter((id) => id !== service.id) })} />{service.name}{!service.active && ' (inativo)'}</label>)}{services.length === 0 && <p>Cadastre serviços antes de vinculá-los à equipe.</p>}</fieldset>
      <label className="form-checkbox management-form__wide"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Profissional ativo</label>
      <div className="management-form__actions"><button className="button button--secondary" type="button" onClick={() => setEditorOpen(false)}>Cancelar</button><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar profissional'}</button></div>
    </form></section>}
    {scheduleFor && <section className="management-editor" aria-labelledby="hours-editor-title"><div className="management-editor__header"><div><p className="eyebrow">HORÁRIOS DE TRABALHO</p><h2 id="hours-editor-title">Expediente de {scheduleFor.fullName}</h2></div><button className="close-editor" onClick={() => setScheduleFor(null)} type="button" aria-label="Fechar expediente">×</button></div>{scheduleLoading ? <p>Carregando expediente…</p> : <form onSubmit={saveHours} className="hours-form"><p>Defina os dias em que este profissional trabalha. Para o intervalo de almoço, crie dois períodos no mesmo dia (ex.: 09h–12h e 13h–18h). Dias sem expediente não oferecem horários na agenda.</p><label className="form-checkbox"><input type="checkbox" checked={periods.some((period) => period.weekday === 0)} onChange={(event) => setPeriods(event.target.checked ? [...periods, { weekday: 0, startMinute: 540, endMinute: 1080 }] : periods.filter((period) => period.weekday !== 0))} disabled={saving || (periods.length >= 28 && !periods.some((period) => period.weekday === 0))} />Atender aos domingos (opcional)</label><p className="management-hint">{periods.some((period) => period.weekday === 0) ? 'Domingo aberto. Ajuste os horários abaixo conforme o atendimento.' : 'Domingo fechado. Nenhum agendamento será oferecido nesse dia.'}</p>{periods.map((period, index) => <div className="hours-row" key={`${index}-${period.weekday}`}><label>Dia<select value={period.weekday} onChange={(e) => setPeriods(periods.map((p, i) => i === index ? { ...p, weekday: Number(e.target.value) } : p))}>{days.map((day, dayIndex) => <option value={dayIndex} key={day}>{day}</option>)}</select></label><label>Início<input type="time" required value={minuteToTime(period.startMinute)} onChange={(e) => setPeriods(periods.map((p, i) => i === index ? { ...p, startMinute: timeToMinute(e.target.value) } : p))} /></label><label>Fim<input type="time" required value={minuteToTime(period.endMinute)} onChange={(e) => setPeriods(periods.map((p, i) => i === index ? { ...p, endMinute: timeToMinute(e.target.value) } : p))} /></label><button className="record-link" type="button" onClick={() => setPeriods(periods.filter((_, i) => i !== index))}>Remover</button></div>)}<div className="management-form__actions"><button type="button" className="button button--secondary" disabled={periods.length >= 28} onClick={() => setPeriods([...periods, { weekday: 1, startMinute: 540, endMinute: 1080 }])}>Adicionar período</button><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar expediente'}</button></div></form>}</section>}
    {blocksFor && <section className="management-editor" aria-labelledby="blocks-editor-title">
      <div className="management-editor__header"><div><p className="eyebrow">AGENDA / AUSÊNCIAS</p><h2 id="blocks-editor-title">Folgas de {blocksFor.fullName}</h2></div><button type="button" className="close-editor" aria-label="Fechar bloqueios" onClick={() => setBlocksFor(null)}>×</button></div>
      <p className="management-hint">Cadastre férias, folgas, consultas ou outras ausências. Os horários são interpretados no fuso do estabelecimento ({timezone}). O sistema não permitirá bloquear um período que já tenha agendamentos ativos: primeiro remarque os atendimentos existentes.</p>
      <form className="management-form" onSubmit={addBlock}>
        <label>Início da ausência<input type="datetime-local" required value={blockStart} onChange={(e) => setBlockStart(e.target.value)} /></label>
        <label>Fim da ausência<input type="datetime-local" required min={blockStart} value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} /></label>
        <label className="management-form__wide">Motivo (opcional)<input maxLength={160} placeholder="Ex.: Férias ou consulta" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} /></label>
        <div className="management-form__actions"><button className="button button--primary" type="submit" disabled={saving || !blockStart || !blockEnd}>{saving ? 'Salvando…' : 'Bloquear período'}</button></div>
      </form>
      <h3 className="management-subtitle">Bloqueios cadastrados</h3>
      {blocksLoading ? <p className="management-hint" role="status">Carregando folgas…</p> : blocks.length === 0 ? <p className="management-hint">Nenhuma folga futura ou recente cadastrada para este profissional.</p> : <div className="block-list">{blocks.map((block) => <div className="block-list__item" key={block.id}><div><strong>{formatInZone(block.startsAt, timezone)} até {formatInZone(block.endsAt, timezone)}</strong><small>{block.reason || 'Ausência sem motivo informado'}</small></div><button className="record-link" type="button" disabled={saving} onClick={() => void removeBlock(block.id)}>Remover</button></div>)}</div>}
    </section>}
    {linkFor && account.role === 'owner' && <section className="management-editor" aria-labelledby="professional-account-title">
      <div className="management-editor__header"><div><p className="eyebrow">ACESSO À AGENDA</p><h2 id="professional-account-title">Conta de {linkFor.fullName}</h2></div><button className="close-editor" type="button" aria-label="Fechar vínculo" onClick={() => setLinkFor(null)}>×</button></div>
      <p className="management-hint">Primeiro convide o usuário com o perfil “Profissional” na página Configurações. Depois de aceitar o convite, associe a conta ao cadastro profissional correspondente.</p>
      <form className="management-form" onSubmit={saveAccountLink}>
        <label className="management-form__wide">Conta do usuário<select value={linkedUserId} onChange={(e) => setLinkedUserId(e.target.value)}><option value="">Sem conta vinculada</option>{teamMembers.filter((member) => member.role === 'professional' && member.active).map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label>
        <div className="management-form__actions"><button type="button" className="button button--secondary" onClick={() => setLinkFor(null)}>Cancelar</button><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar vínculo'}</button></div>
      </form>
    </section>}
  </WorkspaceLayout>;
}

