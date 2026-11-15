import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { apiRequest } from '../lib/api';

export function PublicBookingActionPage({ action }: { action: 'confirm' | 'cancel' }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const started = useRef(false);
  const [working, setWorking] = useState(action === 'confirm');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    if (!token) { setError('Este link está incompleto ou inválido.'); setWorking(false); return; }
    setWorking(true); setError('');
    try {
      await apiRequest(`/api/public/${action}`, { method: 'POST', body: JSON.stringify({ token }) });
      setResult(action === 'confirm'
        ? 'Seu agendamento foi registrado! A equipe do estabelecimento poderá confirmar o atendimento. Você receberá os detalhes por e-mail.'
        : 'Agendamento cancelado. O horário foi liberado na agenda.');
      window.history.replaceState(null, '', window.location.pathname);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.'); }
    finally { setWorking(false); }
  }

  useEffect(() => {
    if (action === 'confirm' && !started.current) { started.current = true; void submit(); }
  // A confirmação acontece apenas uma vez para evitar dupla requisição no StrictMode.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  return <div className="public-booking"><header className="public-booking__header"><Logo /></header><main className="public-booking__main"><div className="public-booking__panel">
    <p className="eyebrow">BEAUTYBARBER</p><h1>{action === 'confirm' ? 'Confirmação de agendamento' : 'Cancelamento de agendamento'}</h1>
    {working && <p role="status">Processando sua solicitação…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && <p className="form-success" role="status">{result}</p>}
    {action === 'cancel' && !result && <><p>Deseja cancelar este atendimento? A operação libera o horário e não poderá ser desfeita por este link.</p><button className="button button--primary" disabled={working || !token} type="button" onClick={() => void submit()}>Confirmar cancelamento</button></>}
  </div></main></div>;
}
