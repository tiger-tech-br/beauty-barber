import { DateTime } from 'luxon';

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export function todayInZone(timezone = DEFAULT_TIMEZONE, reference = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(reference);
}

export function monthBoundsInZone(timezone = DEFAULT_TIMEZONE, reference = new Date()): { from: string; to: string } {
  const today = todayInZone(timezone, reference);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${today.slice(0,7)}-01`, to: `${today.slice(0,7)}-${String(dayCount).padStart(2, '0')}` };
}

export function shiftMonth(month: string, amount: number): string {
  const date = DateTime.fromISO(`${month}-01`, { zone: 'UTC' });
  return date.plus({ months: amount }).toFormat('yyyy-MM');
}

/** A agenda operacional nunca navega para dias anteriores ao atual no fuso do estabelecimento. */
export function shiftCalendarDate(date: string, view: 'day' | 'week' | 'month', step: number, today: string): string {
  const start = DateTime.fromISO(date, { zone: 'UTC' });
  const candidate = view === 'month'
    ? start.startOf('month').plus({ months: step }).toISODate()
    : start.plus({ days: step * (view === 'week' ? 7 : 1) }).toISODate();
  return candidate && candidate >= today ? candidate : today;
}

export function formatInZone(
  value: string | Date,
  timezone = DEFAULT_TIMEZONE,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' }
): string {
  return new Date(value).toLocaleString('pt-BR', { timeZone: timezone, ...options });
}

/** Recebe o horário do formulário no fuso do salão, independentemente do computador do usuário. */
export function businessLocalToUtcIso(value: string, timezone = DEFAULT_TIMEZONE): string | null {
  const local = DateTime.fromISO(value, { zone: timezone });
  // Rejeita datas inválidas e horas inexistentes na mudança de horário de verão.
  if (!local.isValid || local.toFormat("yyyy-MM-dd'T'HH:mm") !== value) return null;
  return local.toUTC().toISO({ suppressMilliseconds: true });
}
