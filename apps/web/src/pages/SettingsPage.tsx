import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAccount } from '../hooks/useAccount';
import { apiRequest } from '../lib/api';
import { OpeningHoursEditor, type OpeningPeriod } from '../components/OpeningHoursEditor';
import { SpecialHoursEditor, type SpecialDay, type SpecialPeriod } from '../components/SpecialHoursEditor';

type Business = { name:string; slug:string; timezone:string; contactEmail:string; contactPhone:string; addressLine:string; city:string; stateCode:string; hasLogo:boolean };
type Member = { id:string; fullName:string; email:string; role:'owner'|'receptionist'|'professional'; active:boolean };
type Invite = { id:string; email:string; role:string; createdAt:string; expiresAt:string; consumedAt:string|null; revokedAt:string|null };
type Team = { users: Member[]; invitations: Invite[]; emailEnabled:boolean };
const timezones = [
  ['America/Sao_Paulo','Brasília / São Paulo'], ['America/Bahia','Bahia'], ['America/Fortaleza','Fortaleza'],
  ['America/Recife','Recife'], ['America/Belem','Belém'], ['America/Manaus','Manaus'],
  ['America/Cuiaba','Cuiabá'], ['America/Campo_Grande','Campo Grande'], ['America/Porto_Velho','Porto Velho'],
  ['America/Rio_Branco','Rio Branco']
];

export function SettingsPage() {
  const { account, busy, error: accountError } = useAccount();
  const navigate = useNavigate();
  const [business, setBusiness] = useState<Business|null>(null);
  const [openingHours, setOpeningHours] = useState<OpeningPeriod[]|null>(null);
  const [specialDays, setSpecialDays] = useState<SpecialDay[]>([]);
  const [team, setTeam] = useState<Team|null>(null);
  const [newInviteEmail, setNewInviteEmail] = useState('');
  const [newInviteRole, setNewInviteRole] = useState<'receptionist'|'professional'>('receptionist');
  const [inviteUrl, setInviteUrl] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [logoFile, setLogoFile] = useState<File|null>(null);
  const [logoRevision, setLogoRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async (role: string) => {
    const [company, people, schedule, exceptions] = await Promise.all([
      apiRequest<{ business:Business }>('/api/account/business'),
      role === 'owner' ? apiRequest<Team>('/api/team') : Promise.resolve(null),
      apiRequest<{ periods: OpeningPeriod[] }>('/api/account/opening-hours'),
      apiRequest<{ items: SpecialDay[] }>('/api/account/special-hours')
    ]);
    setBusiness(company.business); setTeam(people); setOpeningHours(schedule.periods); setSpecialDays(exceptions.items);
  }, []);

  useEffect(() => {
    if (!account) return;
    let active = true;
    refresh(account.role).catch((cause:unknown)=>{ if(active) setError(cause instanceof Error?cause.message:'Não foi possível consultar configurações.'); })
      .finally(()=>{ if(active) setLoading(false); });
    return ()=>{active=false;};
  }, [account,refresh]);

  async function saveBusiness(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!business) return;
    const changedTimezone = business.timezone !== account?.establishmentTimezone;
    if (changedTimezone && !window.confirm('A troca de fuso pode mudar a exibição dos horários. Se houver agendamentos futuros ativos, o sistema bloqueará a alteração. Deseja tentar?')) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const { slug: _slug, hasLogo: _hasLogo, ...editable } = business;
      void _slug;
      void _hasLogo;
      await apiRequest('/api/account/business',{method:'PUT',body:JSON.stringify(editable)});
      if (changedTimezone) { window.location.reload(); return; }
      setNotice('Dados do estabelecimento atualizados.');
    } catch (cause) { setError(cause instanceof Error?cause.message:'Não foi possível atualizar dados.'); }
    finally { setSaving(false); }
  }

  async function uploadBusinessLogo(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!logoFile || account?.role!=='owner') return;
    if (logoFile.type!=='image/png' || logoFile.size>256*1024 || logoFile.size===0) {
      setError('Escolha uma imagem PNG de até 256 KB.'); return;
    }
    const form = event.currentTarget;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/account/logo',{
        method:'PUT',credentials:'same-origin',headers:{'Content-Type':'image/png'},body:await logoFile.arrayBuffer()
      });
      if (!response.ok) {
        const data = await response.json().catch(()=>({error:'Não foi possível enviar o logotipo.'})) as {error?:string};
        throw new Error(data.error||'Não foi possível enviar o logotipo.');
      }
      setBusiness((current)=>current?{...current,hasLogo:true}:current);
      setLogoRevision(Date.now());
      setLogoFile(null);
      form.reset();
      setNotice('Logotipo do estabelecimento salvo. Ele aparecerá na página pública de agendamento.');
    } catch (cause) {setError(cause instanceof Error?cause.message:'Não foi possível enviar o logotipo.');}
    finally {setSaving(false);}
  }

  async function removeBusinessLogo() {
    if (account?.role!=='owner' || !window.confirm('Remover o logotipo personalizado deste estabelecimento?')) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest('/api/account/logo',{method:'DELETE'});
      setBusiness((current)=>current?{...current,hasLogo:false}:current);
      setLogoFile(null);
      setNotice('Logotipo removido. A marca BeautyBarber continuará na plataforma.');
    } catch (cause) {setError(cause instanceof Error?cause.message:'Não foi possível remover o logotipo.');}
    finally {setSaving(false);}
  }

  async function saveOpeningHours(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (openingHours === null || account?.role !== 'owner') return;
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest('/api/account/opening-hours',{method:'PUT',body:JSON.stringify({periods:openingHours})});
      setNotice('Horário de funcionamento salvo. As disponibilidades foram atualizadas.');
    } catch(cause) { setError(cause instanceof Error?cause.message:'Não foi possível salvar o horário de funcionamento.'); }
    finally { setSaving(false); }
  }

  async function saveSpecialHours(date: string, details: {closed: boolean;periods: SpecialPeriod[]}) {
    if (account?.role !== 'owner') return;
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/account/special-hours/${encodeURIComponent(date)}`,{method:'PUT',body:JSON.stringify(details)});
      const data = await apiRequest<{ items: SpecialDay[] }>('/api/account/special-hours');
      setSpecialDays(data.items);
      setNotice('Horário especial salvo. Os demais dias continuam com o funcionamento semanal.');
    } catch(cause) { setError(cause instanceof Error?cause.message:'Não foi possível salvar o horário especial.'); }
    finally { setSaving(false); }
  }

  async function restoreSpecialHours(date: string) {
    if (account?.role !== 'owner') return;
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/account/special-hours/${encodeURIComponent(date)}`,{method:'DELETE'});
      const data = await apiRequest<{ items: SpecialDay[] }>('/api/account/special-hours');
      setSpecialDays(data.items);
      setNotice('Data restaurada ao horário de funcionamento semanal.');
    } catch(cause) { setError(cause instanceof Error?cause.message:'Não foi possível restaurar o horário semanal.'); }
    finally { setSaving(false); }
  }

  async function invite(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice(''); setInviteUrl('');
    try {
      const result = await apiRequest<{ emailed:boolean; invitationUrl:string|null }>('/api/team/invitations',{
        method:'POST',body:JSON.stringify({email:newInviteEmail,role:newInviteRole})
      });
      await refresh('owner');
      setNewInviteEmail(''); setNotice(result.emailed?'Convite enviado por e-mail.':'Convite criado. Copie o link abaixo e envie à pessoa convidada.');
      if (result.invitationUrl) setInviteUrl(result.invitationUrl);
    } catch (cause) { setError(cause instanceof Error?cause.message:'Não foi possível criar convite.'); }
    finally { setSaving(false); }
  }

  async function saveMember(member:Member, updates:Partial<Member>) {
    setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/team/${member.id}`,{method:'PUT',body:JSON.stringify({role:updates.role??member.role,active:updates.active??member.active})});
      await refresh('owner'); setNotice('Membro da equipe atualizado.');
    } catch (cause) { setError(cause instanceof Error?cause.message:'Não foi possível atualizar membro.'); }
    finally { setSaving(false); }
  }

  async function revoke(id:string) {
    setSaving(true); setError(''); setNotice('');
    try { await apiRequest(`/api/team/invitations/${id}/revoke`,{method:'POST'}); await refresh('owner'); setNotice('Convite revogado.'); }
    catch (cause) { setError(cause instanceof Error?cause.message:'Não foi possível revogar convite.'); }
    finally { setSaving(false); }
  }

  async function changePassword(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      await apiRequest('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});
      navigate('/entrar',{replace:true});
    } catch(cause) {setError(cause instanceof Error?cause.message:'Não foi possível alterar senha.');}
    finally{setSaving(false);}
  }

  async function exportBusinessData(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/account/export',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({password:exportPassword})
      });
      if (!response.ok) {
        const result = await response.json().catch(()=>({error:'Não foi possível exportar os dados.'})) as {error?:string};
        throw new Error(result.error||'Não foi possível exportar os dados.');
      }
      const blob = await response.blob();
      const fileUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = `beautybarber-dados-${new Date().toISOString().slice(0,10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(fileUrl),1000);
      setExportPassword('');
      setNotice('Exportação preparada. Guarde o arquivo em local seguro: ele contém dados pessoais de clientes e equipe.');
    } catch(cause) { setError(cause instanceof Error?cause.message:'Não foi possível exportar dados.'); }
    finally { setSaving(false); }
  }

  if (busy || loading) return <div className="page-state" role="status">Carregando configurações…</div>;
  if (!account) return <div className="page-state" role="alert">{accountError||'Entre na conta para continuar.'}</div>;

  return <WorkspaceLayout account={account}>
    <header className="management-heading"><div><p className="eyebrow">MINHA CONTA</p><h1>Configurações</h1><p>Dados do estabelecimento, equipe e segurança de acesso.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
    {business && <section className="management-editor settings-section"><div className="management-editor__header"><div><p className="eyebrow">ESTABELECIMENTO</p><h2>Informações comerciais</h2></div></div><p className="settings-description">Seu endereço público de agendamento é <code>/agendar/{business.slug}</code>.</p>
      <form className="management-form" onSubmit={saveBusiness}>
        <label>Nome do estabelecimento<input required minLength={2} maxLength={160} disabled={account.role!=='owner'} value={business.name} onChange={(e)=>setBusiness({...business,name:e.target.value})} /></label>
        <label>Fuso horário<select disabled={account.role!=='owner'} value={business.timezone} onChange={(e)=>setBusiness({...business,timezone:e.target.value})}>{timezones.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>E-mail comercial<input type="email" maxLength={255} disabled={account.role!=='owner'} value={business.contactEmail} onChange={(e)=>setBusiness({...business,contactEmail:e.target.value})} /></label>
        <label>Telefone comercial<input maxLength={25} disabled={account.role!=='owner'} value={business.contactPhone} onChange={(e)=>setBusiness({...business,contactPhone:e.target.value})} /></label>
        <label className="management-form__wide">Endereço<input maxLength={240} disabled={account.role!=='owner'} value={business.addressLine} onChange={(e)=>setBusiness({...business,addressLine:e.target.value})} /></label>
        <label>Cidade<input maxLength={100} disabled={account.role!=='owner'} value={business.city} onChange={(e)=>setBusiness({...business,city:e.target.value})} /></label>
        <label>UF<input maxLength={2} disabled={account.role!=='owner'} value={business.stateCode} onChange={(e)=>setBusiness({...business,stateCode:e.target.value.toUpperCase()})} placeholder="SP" /></label>
        {account.role==='owner' && <div className="management-form__actions"><button className="button button--primary" disabled={saving} type="submit">Salvar informações</button></div>}
      </form>
    </section>}

    {business && <section className="management-editor settings-section" aria-labelledby="branding-title">
      <div className="management-editor__header"><div><p className="eyebrow">IDENTIDADE DO ESTABELECIMENTO</p><h2 id="branding-title">Logotipo do salão ou barbearia</h2></div></div>
      <p className="settings-description">Use o logotipo do seu negócio na página pública de agendamento. A identidade e o ícone do BeautyBarber permanecem iguais no sistema. Aceitamos PNG com até 256 KB e 1024 × 1024 pixels.</p>
      <div className="settings-logo-preview">{business.hasLogo ? <img key={logoRevision} src={`/api/branding/${encodeURIComponent(business.slug)}/logo?v=${logoRevision}`} alt={`Logotipo de ${business.name}`} /> : <p>Nenhum logotipo personalizado cadastrado.</p>}</div>
      {account.role==='owner' && <form className="management-form" onSubmit={(event)=>void uploadBusinessLogo(event)}>
        <label className="management-form__wide">Escolha um arquivo PNG<input type="file" accept="image/png,.png" disabled={saving} onChange={(event)=>setLogoFile(event.target.files?.[0]??null)} /></label>
        <div className="management-form__actions">
          {business.hasLogo && <button className="button button--secondary" type="button" disabled={saving} onClick={()=>void removeBusinessLogo()}>Remover logotipo</button>}
          <button className="button button--primary" type="submit" disabled={saving||!logoFile}>{saving?'Salvando…':'Salvar logotipo'}</button>
        </div>
      </form>}
    </section>}

    {openingHours !== null && <section className="management-editor settings-section" aria-labelledby="opening-hours-title">
      <div className="management-editor__header"><div><p className="eyebrow">AGENDA / FUNCIONAMENTO</p><h2 id="opening-hours-title">Horário do salão ou barbearia</h2></div></div>
      <form onSubmit={saveOpeningHours}>
        <OpeningHoursEditor periods={openingHours} onChange={setOpeningHours} disabled={account.role !== 'owner' || saving} />
        {account.role === 'owner' && <div className="management-form__actions"><button className="button button--primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar funcionamento'}</button></div>}
      </form>
    </section>}

    {openingHours !== null && <section className="management-editor settings-section" aria-labelledby="special-hours-title">
      <div className="management-editor__header"><div><p className="eyebrow">AGENDA / EXCEÇÕES</p><h2 id="special-hours-title">Horários especiais por data</h2></div></div>
      <SpecialHoursEditor weekly={openingHours} exceptions={specialDays} timezone={business?.timezone??account.establishmentTimezone}
        disabled={account.role!=='owner'||saving} onSave={saveSpecialHours} onRestore={restoreSpecialHours} />
    </section>}

    {account.role==='owner' && team && <section className="management-editor settings-section"><div className="management-editor__header"><div><p className="eyebrow">ACESSOS</p><h2>Equipe e permissões</h2></div></div>
      <p className="settings-description">Recepção administra cadastros e agenda. O perfil profissional possui acesso restrito. Convites expiram em 48 horas.</p>
      <div className="record-table-wrap"><table className="record-table"><thead><tr><th>Nome</th><th>E-mail</th><th>Função</th><th>Situação</th></tr></thead><tbody>{team.users.map((member)=><tr key={member.id}><td>{member.fullName}</td><td>{member.email}</td><td>{member.role==='owner'?'Responsável':<select className="settings-select" disabled={saving} value={member.role} onChange={(e)=>void saveMember(member,{role:e.target.value as Member['role']})}><option value="receptionist">Recepção</option><option value="professional">Profissional</option></select>}</td><td>{member.role==='owner'?'Ativo':<button className="record-link" disabled={saving} type="button" onClick={()=>void saveMember(member,{active:!member.active})}>{member.active?'Desativar':'Reativar'}</button>}</td></tr>)}</tbody></table></div>
      <h3 className="settings-subheading">Convidar pessoa</h3><form className="settings-invite" onSubmit={invite}><label>E-mail<input required type="email" value={newInviteEmail} onChange={(e)=>setNewInviteEmail(e.target.value)} placeholder="pessoa@exemplo.com" /></label><label>Função<select value={newInviteRole} onChange={(e)=>setNewInviteRole(e.target.value as typeof newInviteRole)}><option value="receptionist">Recepção</option><option value="professional">Profissional</option></select></label><button className="button button--primary" type="submit" disabled={saving}>Criar convite</button></form>
      {inviteUrl && <div className="settings-invite-link"><label>Link de convite<input type="text" readOnly value={inviteUrl} onFocus={(e)=>e.target.select()} /></label><button className="button button--secondary" type="button" onClick={()=>void navigator.clipboard.writeText(inviteUrl).then(()=>setNotice('Link copiado.')).catch(()=>setError('Não foi possível copiar. Selecione o endereço e copie manualmente.'))}>Copiar link</button></div>}
      {team.invitations.some((item)=>!item.consumedAt&&!item.revokedAt) && <><h3 className="settings-subheading">Convites criados</h3><div className="record-table-wrap"><table className="record-table"><thead><tr><th>E-mail</th><th>Função</th><th>Expira</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{team.invitations.filter((item)=>!item.consumedAt&&!item.revokedAt).map((item)=><tr key={item.id}><td>{item.email}</td><td>{item.role==='receptionist'?'Recepção':'Profissional'}</td><td>{new Date(item.expiresAt).toLocaleDateString('pt-BR')}</td><td><button className="record-link" type="button" onClick={()=>void revoke(item.id)} disabled={saving}>Revogar</button></td></tr>)}</tbody></table></div></>}
    </section>}

    {account.role==='owner' && <section className="management-editor settings-section"><div className="management-editor__header"><div><p className="eyebrow">PRIVACIDADE</p><h2>Exportar dados do estabelecimento</h2></div></div>
      <p className="settings-description">Baixe um arquivo JSON com cadastros, clientes, equipe, serviços, agenda e recebimentos deste estabelecimento. A exportação exige sua senha e fica registrada para auditoria. O arquivo contém dados pessoais: proteja-o e não compartilhe publicamente.</p>
      <form className="management-form" onSubmit={exportBusinessData}>
        <label>Confirme sua senha<input type="password" required autoComplete="current-password" value={exportPassword} onChange={(e)=>setExportPassword(e.target.value)} /></label>
        <div className="management-form__actions"><button className="button button--secondary" disabled={saving} type="submit">Baixar dados do estabelecimento</button></div>
      </form>
    </section>}

    <section className="management-editor settings-section"><div className="management-editor__header"><div><p className="eyebrow">SEGURANÇA</p><h2>Alterar minha senha</h2></div></div><form className="management-form" onSubmit={changePassword}>
      <label>Senha atual<input required type="password" autoComplete="current-password" value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} /></label>
      <label>Nova senha (mínimo 12 caracteres)<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} /></label>
      <div className="management-form__actions"><button className="button button--secondary" disabled={saving} type="submit">Alterar senha e sair</button></div>
    </form></section>
  </WorkspaceLayout>;
}
