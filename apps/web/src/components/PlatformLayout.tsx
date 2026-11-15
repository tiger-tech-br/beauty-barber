import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { usePanelTheme } from '../hooks/usePanelTheme';
import { apiRequest, type UserAccount } from '../lib/api';
import { Logo } from './Logo';
import { ThemeSwitch } from './ThemeSwitch';

const platformLinks = [
  { to: '/plataforma/estabelecimentos', label: 'Estabelecimentos' },
  { to: '/plataforma/cobrancas', label: 'Conferência PagBank' }
];

export function PlatformLayout({ account, children }: { account: UserAccount; children: ReactNode }) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = usePanelTheme();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');

  async function logout() {
    setLoggingOut(true);
    setError('');
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      navigate('/entrar', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível sair da conta.');
      setLoggingOut(false);
    }
  }

  return <div className="dashboard-layout platform-layout" data-theme={theme}>
    <aside className="dashboard-sidebar" aria-label="Menu administrativo">
      <div className="dashboard-sidebar__brand"><Logo inverse link={false} /><span>ADMINISTRAÇÃO DA PLATAFORMA</span></div>
      <nav className="dashboard-sidebar__navigation" aria-label="Módulos da plataforma">
        <p>CONTROLE BEAUTYBARBER</p>
        {platformLinks.map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'dashboard-sidebar__active' : 'dashboard-sidebar__link'}>{item.label}</NavLink>)}
      </nav>
      <div className="dashboard-sidebar__bottom"><div className="avatar">{account.fullName.charAt(0).toUpperCase()}</div><div><strong>{account.fullName}</strong><small>Administrador da plataforma</small></div></div>
    </aside>
    <main className="dashboard-main">
      <header className="dashboard-topbar"><div className="dashboard-topbar__label"><span className="platform-security-mark" aria-hidden="true">◆</span> Acesso exclusivo do administrador</div><div className="dashboard-topbar__actions"><ThemeSwitch theme={theme} onToggle={toggleTheme} /><button className="text-button" type="button" onClick={logout} disabled={loggingOut}>{loggingOut ? 'Saindo…' : 'Sair da conta'} <span aria-hidden="true">↗</span></button></div></header>
      <div className="dashboard-content">{error && <p className="form-error" role="alert">{error}</p>}{children}<footer className="dashboard-footer">BeautyBarber · Administração da plataforma · Acesso restrito.</footer></div>
    </main>
  </div>;
}
