import type { DuePreset } from '@/models/node';

type CalculatedDuePreset = Exclude<DuePreset, 'none' | 'custom'>;

const DUE_DATE_CALCULATORS: Record<CalculatedDuePreset, (date: Date) => void> = {
  morning: (date) => date.setHours(12, 0, 0, 0),
  afternoon: (date) => date.setHours(17, 0, 0, 0),
  today: (date) => date.setHours(23, 59, 0, 0),
  tomorrow: (date) => { date.setDate(date.getDate() + 1); date.setHours(23, 59, 0, 0); },
  thisWeek: (date) => { date.setDate(date.getDate() + ((7 - date.getDay()) % 7)); date.setHours(23, 59, 0, 0); },
  thisMonth: (date) => { date.setMonth(date.getMonth() + 1, 0); date.setHours(23, 59, 0, 0); },
  thisYear: (date) => { date.setMonth(11, 31); date.setHours(23, 59, 0, 0); },
};

export function dueDateForPreset(preset: DuePreset, from = new Date()) {
  if (preset === 'none') return null;
  const date = new Date(from);
  date.setSeconds(0, 0);
  if (preset !== 'custom') DUE_DATE_CALCULATORS[preset](date);
  return date;
}

export function parseLocalDateTime(value: string) {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const formatDateTimeInput = (date: Date) =>
  `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
