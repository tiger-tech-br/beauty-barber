import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, ApiResponseError, type UserAccount } from '../lib/api';

export function useAccount() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiRequest<{ account: UserAccount }>('/api/auth/me')
      .then((response) => { if (active) setAccount(response.account); })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof ApiResponseError && cause.status === 401) navigate('/entrar', { replace: true });
        else setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a conta.');
      })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [navigate]);

  return { account, busy, error };
}
