import { DateTime } from 'luxon';

export type AppointmentStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
export type TimeRange = { startsAt: string | Date; endsAt: string | Date };
export type WeeklyPeriod = { weekday: number; startMinute: number; endMinute: number };
export type AvailableSlot = { time: string; startsAt: string; endsAt: string };
export type SpecialHours = { closed: boolean; periods: { startMinute: number; endMinute: number }[] };

/** Retorna a regra do negócio válida na data: exceção pontual substitui a escala semanal. */
export function establishmentHoursForDate(date: string, zone: string, weekly: WeeklyPeriod[], special?: SpecialHours | null): WeeklyPeriod[] {
  const local = DateTime.fromISO(date, { zone });
  if (!local.isValid || local.toISODate() !== date) return [];
  const weekday = local.weekday % 7;
  if (!special) return weekly.filter((period) => period.weekday === weekday);
  if (special.closed) return [];
  return special.periods.map((period) => ({ weekday, startMinute: period.startMinute, endMinute: period.endMinute }));
}

/** Um horário só é oferecido quando salão E profissional estão trabalhando. */
export function intersectWeeklyPeriods(professional: WeeklyPeriod[], establishment: WeeklyPeriod[]): WeeklyPeriod[] {
  return professional.flatMap((shift) => establishment
    .filter((open) => open.weekday === shift.weekday)
    .map((open) => ({ weekday: shift.weekday,
      startMinute: Math.max(shift.startMinute, open.startMinute),
      endMinute: Math.min(shift.endMinute, open.endMinute) }))
    .filter((period) => period.startMinute < period.endMinute));
}

/** Uma mudança de expediente não pode deixar reservas futuras fora do novo horário. */
export function appointmentFitsPeriods(
  startsAt: Date | string, endsAt: Date | string, zone: string, periods: WeeklyPeriod[]
): boolean {
  const start = DateTime.fromJSDate(new Date(startsAt)).setZone(zone);
  const end = DateTime.fromJSDate(new Date(endsAt)).setZone(zone);
  if (!start.isValid || !end.isValid || start.toISODate() !== end.toISODate() || end <= start) return false;
  const weekday = start.weekday % 7;
  const startMinute = start.hour * 60 + start.minute;
  const endMinute = end.hour * 60 + end.minute;
  if (start.second || end.second || start.millisecond || end.millisecond) return false;
  return periods.some((period) => period.weekday === weekday &&
    period.startMinute <= startMinute && endMinute <= period.endMinute);
}

const transitions: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  pending: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: []
};

export function canChangeStatus(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return transitions[from].includes(to);
}

export function validBookingDate(date: string, zone: string, now: DateTime = DateTime.now()): boolean {
  const target = DateTime.fromISO(date, { zone });
  if (!target.isValid || target.toFormat('yyyy-MM-dd') !== date || !DateTime.local().setZone(zone).isValid) return false;
  const today = now.setZone(zone).startOf('day');
  return target >= today && target <= today.plus({ days: 90 });
}

export function generateSlots(input: {
  date: string;
  zone: string;
  durationMinutes: number;
  periods: WeeklyPeriod[];
  appointments: TimeRange[];
  blocks: TimeRange[];
  nowMillis?: number;
}): AvailableSlot[] {
  const { date, zone, durationMinutes, periods, appointments, blocks } = input;
  const base = DateTime.fromISO(date, { zone }).startOf('day');
  if (!base.isValid || durationMinutes < 5 || durationMinutes > 600) return [];
  const weekday = base.weekday % 7; // Luxon: domingo 7; banco: domingo 0.
  const occupied = [...appointments, ...blocks].map((range) => ({
    start: new Date(range.startsAt).getTime(), end: new Date(range.endsAt).getTime()
  }));
  const now = input.nowMillis ?? Date.now();
  const slots: AvailableSlot[] = [];

  for (const period of periods.filter((item) => item.weekday === weekday)) {
    for (let minute = period.startMinute; minute + durationMinutes <= period.endMinute; minute += 15) {
      const start = base.plus({ minutes: minute });
      const end = start.plus({ minutes: durationMinutes });
      if (!start.isValid || !end.isValid) continue;
      const startMs = start.toMillis();
      const endMs = end.toMillis();
      if (startMs <= now) continue;
      if (occupied.some((range) => startMs < range.end && endMs > range.start)) continue;
      const startsAt = start.toUTC().toISO();
      const endsAt = end.toUTC().toISO();
      if (!startsAt || !endsAt) continue;
      slots.push({ time: start.toFormat('HH:mm'), startsAt, endsAt });
    }
  }

  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

