import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { apiRequest, type UserAccount } from '../lib/api';
import { panelHome } from '../lib/panel-access';

export function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      const { account } = await apiRequest<{ account: UserAccount }>('/api/auth/me');
      navigate(panelHome(account), { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível entrar.');
    } finally { setLoading(false); }
  }

  return <AuthLayout title="É bom ter você de volta." description="Entre para acompanhar a rotina do seu estabelecimento.">
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="login-email">E-mail</label><input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seuemail@exemplo.com" />
      <label htmlFor="login-password">Senha</label><input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Digite sua senha" />
      {error && <p className="form-error" role="alert">{error}</p>}
      {(location.state as {inviteAccepted?:boolean;passwordReset?:boolean}|null)?.inviteAccepted && <p className="form-success" role="status">Convite aceito. Entre com suas credenciais.</p>}
      {(location.state as {inviteAccepted?:boolean;passwordReset?:boolean}|null)?.passwordReset && <p className="form-success" role="status">Senha atualizada. Faça login novamente.</p>}
      <button className="button button--primary button--full" type="submit" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'} <span aria-hidden="true">↗</span></button>
    </form>
    <p className="auth-switch">Ainda não tem uma conta? <Link to="/cadastro">Criar conta</Link></p>
    <p className="auth-pending"><Link to="/esqueci-senha">Esqueci minha senha</Link></p>
  </AuthLayout>;
}

