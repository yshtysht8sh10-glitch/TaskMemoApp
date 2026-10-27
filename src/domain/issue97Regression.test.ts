import { expect, it } from 'vitest';
import type { CategoryNode, MemoNode } from '../models/node';
import { deadlineCreateContext, deadlineDisplayGroups, deadlineGroupDefinitions, deadlineGroupForDueAt, deadlineGroups } from './deadlineView';
import { dueDateForPreset } from '../utils/dueDates';
import { resolveDeadline } from '../textFormat/deadlines';
import { localDateKey } from './routine';

const memo = (id: string, dueAt: Date): MemoNode => ({ id, type: 'memo', parentId: null,
  sortKey: 'a0', title: id, body: '', dueAt, duePreset: 'custom', status: 'active', completedAt: null,
  createdAt: new Date(2026, 9, 1), updatedAt: new Date(2026, 9, 1), deletedAt: null });

it('matches the October 11 Sunday example, with short-horizon display disabled (#97)', () => {
  const now = new Date(2026, 9, 11, 8);
  const visible = new Set(deadlineGroupDefinitions('today').map(g => g.id).filter(id => id !== 'twoThreeDays'));
  const nodes = Array.from({ length: 21 }, (_, offset) => memo(String(offset), new Date(2026, 9, 11 + offset, 23, 59)));
  const before = structuredClone(nodes);
  const display = deadlineDisplayGroups(deadlineGroups(nodes, now, visible, 'today'), now, 'today');
  expect(display.slice(1, 6).map(g => [g.key, g.label, g.memos.map(m => m.id)])).toEqual([
    ['today', '今日', ['0']], ['tomorrow', '明日（10/12）', ['1']],
    ['thisWeek', '今週（10/13〜10/17）', ['2', '3', '4', '5', '6']],
    ['nextWeek', '来週（10/18〜10/24）', ['7', '8', '9', '10', '11', '12', '13']],
    ['thisMonth', '今月（10/25〜10/31）', ['14', '15', '16', '17', '18', '19', '20']],
  ]);
  expect(display.flatMap(g => g.memos).map(m => m.id)).toHaveLength(21);
  expect(new Set(display.flatMap(g => g.memos).map(m => m.id)).size).toBe(21);
  expect(nodes).toEqual(before);
});

it.each([
  [2026, 9, 10, 10], [2026, 9, 11, 17], [2026, 9, 12, 17],
  [2026, 9, 31, 31], [2026, 10, 1, 7], [2026, 10, 2, 7],
  [2026, 11, 26, 26], [2026, 11, 27, 2], [2026, 11, 28, 2],
  [2026, 11, 31, 2], [2027, 0, 1, 2], [2027, 0, 2, 2], [2027, 0, 3, 9], [2027, 0, 4, 9],
])('uses Saturday endpoints for %i/%i/%i (#97)', (year, month, day, saturday) => {
  const now = new Date(year, month, day, 8);
  const offset = 6 - now.getDay();
  const weekEnd = new Date(year, month, day + offset, 23, 59, 59, 999);
  expect(weekEnd.getDate()).toBe(saturday);
  const nextWeekEnd = new Date(year, month, day + offset + 7, 23, 59, 59, 999);
  for (const [key, expected] of [['thisWeek', weekEnd], ['nextWeek', nextWeekEnd]] as const) {
    const definition = deadlineGroupDefinitions('today').find(g => g.id === key)!;
    expect(deadlineCreateContext(definition, now, 'today')!.initialDueAt).toEqual(expected);
  }
  expect(dueDateForPreset('thisWeek', now)).toEqual(new Date(year, month, day + offset, 23, 59));
  // Tomorrow and the 2–3 day horizon retain priority over calendar-week groups.
  for (let days = 2; days <= 21; days++) {
    const due = new Date(year, month, day + days, 12);
    const expected = days <= Math.min(3, offset) ? 'twoThreeDays' : days <= offset ? 'thisWeek'
      : days <= offset + 7 ? 'nextWeek' : due.getFullYear() === year && due.getMonth() === month ? 'thisMonth'
      : due.getFullYear() === new Date(year, month + 1, 1).getFullYear() && due.getMonth() === (month + 1) % 12 ? 'nextMonth'
      : due.getFullYear() === year ? 'thisYear' : due.getFullYear() === year + 1 ? 'nextYear' : 'later';
    expect(deadlineGroupForDueAt(due, now), localDateKey(due)).toBe(expected);
  }
  expect(deadlineGroupForDueAt(new Date(year, month, day + 1, 12), now)).toBe('tomorrow');
});

it('retains short-horizon buckets without allowing them into the next week (#97)', () => {
  const now = new Date(2026, 9, 11, 8);
  const labels = new Map(deadlineDisplayGroups(deadlineGroups([], now), now).map(g => [g.key, g.label]));
  expect(labels.get('twoThreeDays')).toBe('2〜3日以内（10/13〜10/14）');
  expect(labels.get('thisWeek')).toBe('今週（10/15〜10/17）');
  expect(labels.get('nextWeek')).toBe('来週（10/18〜10/24）');
});

it('classifies both sides of each Saturday midnight boundary exactly once (#97)', () => {
  const now = new Date(2026, 9, 11, 0);
  expect(deadlineGroupForDueAt(new Date(2026, 9, 17, 23, 59, 59, 999), now)).toBe('thisWeek');
  expect(deadlineGroupForDueAt(new Date(2026, 9, 18, 0), now)).toBe('nextWeek');
  expect(deadlineGroupForDueAt(new Date(2026, 9, 24, 23, 59, 59, 999), now)).toBe('nextWeek');
  expect(deadlineGroupForDueAt(new Date(2026, 9, 25, 0), now)).toBe('thisMonth');
  const midnight = new Date(2026, 9, 11, 0);
  expect(deadlineGroupForDueAt(midnight, new Date(2026, 9, 10, 23, 59, 59, 999), 'today')).toBe('tomorrow');
  expect(deadlineGroupForDueAt(midnight, midnight, 'today')).toBe('today');
});

it('uses the session calendar weekday when UTC and local dates differ (#97)', () => {
  const now = '2026-10-10T15:00:00.000Z';
  expect(resolveDeadline('今週', { now, timeZone: 'Asia/Tokyo' })?.dueAt).toBe('2026-10-17T14:59:00.000Z');
  expect(resolveDeadline('今週', { now, timeZone: 'America/Los_Angeles' })?.dueAt).toBe('2026-10-11T06:59:00.000Z');
});

it('classifies old Sunday thisWeek deadlines by their stored date without rewriting them (#97)', () => {
  const now = new Date(2026, 9, 11, 8);
  const old = { ...memo('old', new Date(2026, 9, 11, 23, 59)), duePreset: 'thisWeek' as const };
  const before = structuredClone(old);
  const display = deadlineDisplayGroups(deadlineGroups([old], now, undefined, 'today'), now, 'today');
  expect(display.find(g => g.memos.length)?.key).toBe('today');
  expect(old).toEqual(before);
});

it.each(['Asia/Tokyo', 'America/Los_Angeles'])(
  'resolves textual week dates in the session timezone %s (#97)', timeZone => {
    const context = { now: '2026-10-11T07:30:00.000Z', timeZone };
    const offset = timeZone === 'Asia/Tokyo' ? '+09:00' : '-07:00';
    expect(resolveDeadline('今週', context)?.dueAt).toBe(new Date(`2026-10-17T23:59:00${offset}`).toISOString());
    expect(resolveDeadline('来週', context)?.dueAt).toBe(new Date(`2026-10-24T23:59:00${offset}`).toISOString());
  },
);

it.each([10, 11, 12])('keeps Routine outcomes and deadlines intact across week boundary October %i (#97)', day => {
  const now = new Date(2026, 9, day, 8);
  const root: CategoryNode = { id: 'r', type: 'category', categoryKind: 'routineRoot', title: 'R', parentId: null,
    sortKey: 'a0', createdAt: now, updatedAt: now, deletedAt: null };
  const task = { ...memo('routine', new Date(2026, 9, 1, 23, 59)), parentId: root.id,
    repeatRule: { frequency: 'day' as const, interval: 1, startsOn: '2026-10-09' },
    routineHistory: { '2026-10-09': new Date(2026, 9, 9).toISOString() } };
  const nodes = [root, task], before = structuredClone(nodes);
  const display = deadlineDisplayGroups(deadlineGroups(nodes, now, undefined, 'today'), now, 'today');
  expect(display.find(g => g.key === 'today')?.memos.map(m => m.id)).toEqual(['routine']);
  expect(display.flatMap(g => g.memos).filter(m => m.routineOccurrenceKey).every(m => m.routineOccurrenceKey! < localDateKey(now))).toBe(true);
  expect(nodes).toEqual(before);
});
