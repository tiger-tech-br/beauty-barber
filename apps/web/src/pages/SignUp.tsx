import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { apiRequest } from '../lib/api';

export function SignUp() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [establishmentName, setEstablishmentName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiRequest('/api/auth/register', { method: 'POST', body: JSON.stringify({ fullName, establishmentName, email, password }) });
      navigate('/painel', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível cadastrar sua conta.');
    } finally { setLoading(false); }
  }

  return <AuthLayout title="Vamos organizar seu espaço." description="Comece criando sua conta e o perfil do seu estabelecimento.">
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="register-name">Seu nome</label><input id="register-name" type="text" autoComplete="name" required minLength={2} maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Como podemos chamar você?" />
      <label htmlFor="register-establishment">Nome do estabelecimento</label><input id="register-establishment" type="text" required minLength={2} maxLength={160} value={establishmentName} onChange={(e) => setEstablishmentName(e.target.value)} placeholder="Ex.: Salão Aurora" />
      <label htmlFor="register-email">E-mail</label><input id="register-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seuemail@exemplo.com" />
      <label htmlFor="register-password">Senha <span className="label-hint">(mínimo 12 caracteres)</span></label><input id="register-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Crie uma senha segura" />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button--primary button--full" type="submit" disabled={loading}>{loading ? 'Criando sua conta…' : 'Criar meu estabelecimento'} <span aria-hidden="true">↗</span></button>
    </form>
    <p className="auth-switch">Já tem uma conta? <Link to="/entrar">Entrar</Link></p>
    <p className="auth-pending">Após cadastrar o estabelecimento, você poderá escolher uma assinatura recorrente no painel. A liberação do pagamento requer conferência.</p>
  </AuthLayout>;
}

