import type { DuePreset } from '../models/node';
import { RELATIVE_DUE_VALUES, type ResolvedDue, type TextContext } from './syntax';

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number };
export function zonedParts(iso: string, timeZone: string): Parts {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid session time');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const read = (key: string) => Number(parts.find(part => part.type === key)?.value);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second'), millisecond: date.getUTCMilliseconds() };
}
const utc = (p: Parts) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.millisecond);
/** Reject nonexistent and ambiguous local times; never depend on the host timezone. */
function instant(p: Parts, zone: string): string | null {
  const calendar = new Date(utc(p));
  if (calendar.getUTCFullYear() !== p.year || calendar.getUTCMonth() + 1 !== p.month || calendar.getUTCDate() !== p.day || p.hour > 23 || p.minute > 59 || p.second > 59) return null;
  let guess = utc(p);
  for (let i = 0; i < 5; i++) guess += utc(p) - utc(zonedParts(new Date(guess).toISOString(), zone));
  if (utc(zonedParts(new Date(guess).toISOString(), zone)) !== utc(p)) return null;
  // Includes half-hour DST transitions. An explicit ISO offset can disambiguate.
  for (const offset of [-120, -90, -60, -30, 30, 60, 90, 120])
    if (utc(zonedParts(new Date(guess + offset * 60_000).toISOString(), zone)) === utc(p)) return null;
  return new Date(guess).toISOString();
}

export function resolveDeadline(value: string, context: TextContext): ResolvedDue | null {
  try {
    const base = zonedParts(context.now, context.timeZone);
    if (value === '期限なし') return { dueAt: null, duePreset: 'none' };
    const relative = (RELATIVE_DUE_VALUES as readonly string[]).includes(value);
    if (relative) {
      const date = new Date(Date.UTC(base.year, base.month - 1, base.day));
      let preset: DuePreset = 'custom';
      if (value === '今日') preset = 'today';
      if (value === '明日' || value === '明後日') { date.setUTCDate(date.getUTCDate() + (value === '明日' ? 1 : 2)); if (value === '明日') preset = 'tomorrow'; }
      if (value === '今週' || value === '来週') { date.setUTCDate(date.getUTCDate() + ((7 - date.getUTCDay()) % 7) + (value === '来週' ? 7 : 0)); if (value === '今週') preset = 'thisWeek'; }
      if (value === '今月' || value === '来月') { date.setUTCMonth(date.getUTCMonth() + (value === '来月' ? 2 : 1), 0); if (value === '今月') preset = 'thisMonth'; }
      if (value === '今年') { date.setUTCMonth(11, 31); preset = 'thisYear'; }
      if (value === '午前') preset = 'morning';
      if (value === '午後') preset = 'afternoon';
      const dueAt = instant({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: value === '午前' ? 12 : value === '午後' ? 17 : 23, minute: value === '午前' || value === '午後' ? 0 : 59, second: 0, millisecond: 0 }, context.timeZone);
      return dueAt ? { dueAt, duePreset: preset } : null;
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (iso) {
      // Validate the written calendar before Date.parse (which accepts Feb 30).
      const [, y, m, d, h, min, s] = iso;
      const check = new Date(Date.UTC(+y, +m - 1, +d));
      if (check.getUTCFullYear() !== +y || check.getUTCMonth() + 1 !== +m || check.getUTCDate() !== +d || +h > 23 || +min > 59 || +s > 59 || !Number.isFinite(Date.parse(value))) return null;
      return { dueAt: new Date(value).toISOString(), duePreset: 'custom' };
    }
    const match = /^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})(?: (\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(value);
    if (!match) return null;
    const dueAt = instant({ year: match[1] ? +match[1] : base.year, month: +match[2], day: +match[3], hour: match[4] ? +match[4] : 23, minute: match[5] ? +match[5] : 59, second: match[6] ? +match[6] : 0, millisecond: match[7] ? +(match[7].padEnd(3, '0')) : 0 }, context.timeZone);
    return dueAt ? { dueAt, duePreset: 'custom' } : null;
  } catch { return null; }
}

export function deadlineCell(dueAt: string | null, duePreset: string, context: TextContext): string {
  if (!dueAt) return '期限なし';
  for (const value of RELATIVE_DUE_VALUES) {
    const candidate = resolveDeadline(value, context);
    if (candidate?.dueAt === new Date(dueAt).toISOString() && candidate.duePreset === duePreset) return value;
  }
  const p = zonedParts(dueAt, context.timeZone);
  const date = `${p.year}/${p.month}/${p.day}`;
  const pad = (n: number) => String(n).padStart(2, '0');
  // Omit time only when the exact default instant matches.
  if (p.hour === 23 && p.minute === 59 && !p.second && !p.millisecond) return date;
  const result = `${date} ${pad(p.hour)}:${pad(p.minute)}`;
  // ISO with offset avoids an ambiguous DST clock time during round-trip.
  if (!resolveDeadline(`${result}:${pad(p.second)}.${String(p.millisecond).padStart(3, '0')}`, context)) return new Date(dueAt).toISOString();
  return result + (p.second || p.millisecond ? `:${pad(p.second)}${p.millisecond ? `.${String(p.millisecond).padStart(3, '0')}` : ''}` : '');
}

export const sessionDate = (context: TextContext) => {
  const p = zonedParts(context.now, context.timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};
