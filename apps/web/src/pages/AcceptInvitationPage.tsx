import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { apiRequest } from '../lib/api';

type Invite = { email:string; role:string; establishmentName:string };

export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [invite,setInvite] = useState<Invite|null>(null);
  const [name,setName] = useState('');
  const [password,setPassword] = useState('');
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');

  useEffect(()=>{
    if(!token){setLoading(false);setError('Convite incompleto ou inválido.');return;}
    let active=true;
    apiRequest<{invitation:Invite}>(`/api/public/invitations/${encodeURIComponent(token)}`)
      .then((result)=>{if(active)setInvite(result.invitation);})
      .catch((cause:unknown)=>{if(active)setError(cause instanceof Error?cause.message:'Convite indisponível.');})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[token]);

  async function accept(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError('');
    try{await apiRequest('/api/public/invitations/accept',{method:'POST',body:JSON.stringify({token,fullName:name,password})});navigate('/entrar',{replace:true,state:{inviteAccepted:true}});}
    catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível aceitar convite.');}
    finally{setSaving(false);}
  }

  return <AuthLayout title="Você foi convidado(a)." description={invite?`Equipe de ${invite.establishmentName}`:'Confira seus dados para aceitar o convite.'}>
    {loading?<p role="status">Verificando convite…</p>:invite?<><p className="auth-pending">E-mail convidado: <strong>{invite.email}</strong> · Função: {invite.role==='receptionist'?'Recepção':'Profissional'}.</p>
      <form className="auth-form" onSubmit={accept}><label>Seu nome completo<input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={(e)=>setName(e.target.value)} /></label><label>Senha<input required minLength={12} maxLength={128} type="password" autoComplete="current-password" value={password} onChange={(e)=>setPassword(e.target.value)} /></label>
        <p className="auth-pending">Se você já usa o Beauty Barber Studio com este e-mail, informe a senha atual. Se é sua primeira conta, crie uma senha com pelo menos 12 caracteres.</p>
        {error&&<p className="form-error" role="alert">{error}</p>}
        <button className="button button--primary button--full" type="submit" disabled={saving}>{saving?'Aceitando…':'Aceitar convite'}</button>
      </form></>:<p className="form-error" role="alert">{error}</p>}
    <p className="auth-switch"><Link to="/entrar">Já tenho acesso</Link></p>
  </AuthLayout>;
}
