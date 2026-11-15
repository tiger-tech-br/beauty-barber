// Aplica-se apenas às escritas operacionais; acesso à conta e cobrança continua
// disponível mesmo para clientes cuja assinatura esteja suspensa.
export function isRestrictedMutation(method: string, path: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return false;
  return /^\/(services|professionals|customers|calendar|finance|team)(?:\/|$)/.test(path);
}
