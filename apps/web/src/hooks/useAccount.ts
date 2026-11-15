import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiRequest, ApiResponseError, type UserAccount } from '../lib/api';
import { hasAreaAccess, panelHome } from '../lib/panel-access';

export function useAccount() {
  const navigate = useNavigate();
  const location = useLocation();
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiRequest<{ account: UserAccount }>('/api/auth/me')
      .then((response) => {
        if (!active) return;
        if (!hasAreaAccess(response.account, location.pathname)) {
          navigate(panelHome(response.account), { replace: true });
          return;
        }
        setAccount(response.account);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof ApiResponseError && cause.status === 401) navigate('/entrar', { replace: true });
        else setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a conta.');
      })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [navigate, location.pathname]);

  return { account, busy, error };
}
