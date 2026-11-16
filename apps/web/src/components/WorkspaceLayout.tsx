import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { apiRequest, type UserAccount } from '../lib/api';
import { usePanelTheme } from '../hooks/usePanelTheme';
import { useResponsiveTables } from '../hooks/useResponsiveTables';
import { Logo } from './Logo';
import { ThemeSwitch } from './ThemeSwitch';

const links = [
  { label: 'Visão geral', to: '/painel', end: true },
  { label: 'Agenda', to: '/painel/agenda' },
  { label: 'Histórico de agendamentos', to: '/painel/historico' },
  { label: 'Minha agenda', to: '/painel/minha-agenda' },
  { label: 'Serviços', to: '/painel/servicos' },
  { label: 'Profissionais', to: '/painel/profissionais' },
  { label: 'Clientes', to: '/painel/clientes' },
  { label: 'Recebimentos', to: '/painel/recebimentos' },
  { label: 'Relatórios', to: '/painel/relatorios' },
  { label: 'Configurações', to: '/painel/configuracoes' }
];

export function WorkspaceLayout({ account, children }: { account: UserAccount; children: ReactNode }) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = usePanelTheme();
  const tableContentRef = useResponsiveTables();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');
  const [establishments, setEstablishments] = useState<{id:string;name:string;role:string}[]>([]);

  useEffect(() => {
    let active = true;
    apiRequest<{items:{id:string;name:string;role:string}[]}>('/api/auth/establishments')
      .then((result) => {if(active)setEstablishments(result.items);})
      .catch(() => undefined);
    return () => {active=false;};
  }, [account.userId]);

  async function switchBusiness(establishmentId:string) {
    setError('');
    try {
      await apiRequest('/api/auth/switch-establishment',{method:'POST',body:JSON.stringify({establishmentId})});
      window.location.assign('/painel');
    } catch (cause) {setError(cause instanceof Error?cause.message:'Não foi possível trocar estabelecimento.');}
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      navigate('/entrar', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível sair da conta.');
    } finally { setLoggingOut(false); }
  }

  return <div className="dashboard-layout" data-theme={theme}>
    <aside className="dashboard-sidebar" aria-label="Menu do painel">
      <div className="dashboard-sidebar__brand"><Logo inverse link={false} /><span>PAINEL DE GESTÃO</span></div>
      <nav className="dashboard-sidebar__navigation" aria-label="Módulos do estabelecimento">
        <p>ESPAÇO DE TRABALHO</p>
        {links.filter((item) => account.role === 'professional'
          ? ['/painel', '/painel/minha-agenda', '/painel/configuracoes'].includes(item.to)
          : item.to !== '/painel/minha-agenda').map(({ label, to, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'dashboard-sidebar__active' : 'dashboard-sidebar__link'}>{label}</NavLink>)}
        {account.role === 'owner' && <NavLink to="/painel/assinatura" className={({ isActive }) => isActive ? 'dashboard-sidebar__active' : 'dashboard-sidebar__link'}>Assinatura</NavLink>}
      </nav>
      <div className="dashboard-sidebar__bottom"><div className="avatar">{account.fullName.charAt(0).toUpperCase()}</div><div><strong>{account.fullName}</strong><small>{account.role === 'owner' ? 'Responsável' : account.role === 'receptionist' ? 'Recepção' : 'Profissional'}</small></div></div>
    </aside>
    <main className="dashboard-main">
      <header className="dashboard-topbar"><div className="dashboard-topbar__label"><span className="status-dot" /> {establishments.length > 1 ? <><label className="sr-only" htmlFor="switch-business">Estabelecimento ativo</label><select id="switch-business" className="dashboard-business-select" value={account.establishmentId} onChange={(e)=>void switchBusiness(e.target.value)}>{establishments.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></> : account.establishmentName}</div><div className="dashboard-topbar__actions"><ThemeSwitch theme={theme} onToggle={toggleTheme} /><button className="text-button" onClick={logout} disabled={loggingOut}>{loggingOut ? 'Saindo…' : 'Sair da conta'} <span aria-hidden="true">↗</span></button></div></header>
      <div className="dashboard-content" ref={tableContentRef}>{error && <p className="form-error" role="alert">{error}</p>}{children}<footer className="dashboard-footer">Beauty Barber Studio · Gestão do estabelecimento · Seus dados ficam separados por empresa.</footer></div>
    </main>
  </div>;
}
