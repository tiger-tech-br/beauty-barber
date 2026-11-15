import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { apiRequest } from '../lib/api';

export function ForgotPasswordPage() {
  const [email,setEmail] = useState('');
  const [sending,setSending] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSending(true); setError('');
    try { const result = await apiRequest<{message:string}>('/api/auth/reset-request',{method:'POST',body:JSON.stringify({email})}); setMessage(result.message); }
    catch(cause) { setError(cause instanceof Error?cause.message:'Não foi possível processar.'); }
    finally { setSending(false); }
  }
  return <AuthLayout title="Vamos recuperar seu acesso." description="Se sua conta existir, enviaremos um link para criar uma nova senha.">
    <form className="auth-form" onSubmit={submit}><label htmlFor="reset-request-email">E-mail da conta</label><input id="reset-request-email" required type="email" autoComplete="email" value={email} onChange={(e)=>setEmail(e.target.value)} />
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
      <button className="button button--primary button--full" type="submit" disabled={sending}>{sending?'Enviando…':'Solicitar recuperação'}</button>
    </form><p className="auth-switch"><Link to="/entrar">Voltar ao login</Link></p>
  </AuthLayout>;
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password,setPassword] = useState('');
  const [confirmPassword,setConfirmPassword] = useState('');
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const token = params.get('token') ?? '';
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if(password!==confirmPassword){setError('As senhas informadas não são iguais.');return;}
    setSaving(true);
    try { await apiRequest('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token,password})}); navigate('/entrar',{replace:true,state:{passwordReset:true}}); }
    catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível alterar senha.');}
    finally{setSaving(false);}
  }
  return <AuthLayout title="Crie sua nova senha." description="Use pelo menos 12 caracteres e evite reutilizar senhas antigas.">
    <form className="auth-form" onSubmit={submit}><label>Nova senha<input required minLength={12} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(e)=>setPassword(e.target.value)} /></label><label>Confirmar nova senha<input required minLength={12} maxLength={128} type="password" autoComplete="new-password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} /></label>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button className="button button--primary button--full" disabled={saving||!token} type="submit">{saving?'Atualizando…':'Salvar nova senha'}</button>
    </form>
  </AuthLayout>;
}
