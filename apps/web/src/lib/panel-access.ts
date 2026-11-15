import type { UserAccount } from './api';

export function panelHome(account: Pick<UserAccount, 'isPlatformAdmin'>): string {
  return account.isPlatformAdmin ? '/plataforma/estabelecimentos' : '/painel';
}

export function hasAreaAccess(account: Pick<UserAccount, 'isPlatformAdmin'>, path: string): boolean {
  if (path.startsWith('/plataforma/')) return account.isPlatformAdmin;
  if (path === '/painel' || path.startsWith('/painel/')) return !account.isPlatformAdmin;
  return true;
}
