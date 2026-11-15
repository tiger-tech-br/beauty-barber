import { z } from 'zod';

export const serviceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.enum(['cabelo', 'barba', 'unhas', 'estetica', 'personalizada']),
  description: z.string().trim().max(500).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(600),
  priceCents: z.number().int().min(0).max(10_000_000),
  active: z.boolean().default(true)
}).strict();

export const professionalSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  specialty: z.string().trim().max(120).nullable().optional(),
  active: z.boolean().default(true),
  serviceIds: z.array(z.uuid()).max(100).refine((ids) => new Set(ids).size === ids.length)
}).strict();

export const customerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.union([z.email().max(255), z.literal('')]).transform((v) => v ? v.toLowerCase() : null).nullable().optional(),
  phone: z.string().trim().max(25).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().default(true)
}).strict();

export const workingHoursSchema = z.object({
  periods: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1439)
  }).strict().refine((v) => v.startMinute < v.endMinute)).max(28)
}).strict().refine(({ periods }) => {
  const byDay = new Map<number, { startMinute: number; endMinute: number }[]>();
  for (const period of periods) {
    const entries = byDay.get(period.weekday) ?? [];
    entries.push(period);
    byDay.set(period.weekday, entries);
  }
  return [...byDay.values()].every((entries) => {
    entries.sort((a, b) => a.startMinute - b.startMinute);
    return entries.every((item, index) => index === 0 || entries[index - 1]!.endMinute <= item.startMinute);
  });
}, 'Horários não podem se sobrepor no mesmo dia.');

