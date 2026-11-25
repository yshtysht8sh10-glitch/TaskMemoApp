import { expect, it } from 'vitest';
import type { MemoNode } from '../models/node';
import { localDateKey, routineHistoryDays } from './routine';

it('exposes all 5000 saved dates in the same descending sequence as compact mode, without mutation', () => {
  const now = new Date(2026, 10, 25, 12);
  const keys = Array.from({ length: 5000 }, (_, i) => localDateKey(new Date(2026, 10, 25 - i)));
  const memo: MemoNode = { id: 'large', type: 'memo', title: '合成Routine', body: '', parentId: 'r', sortKey: 'a0',
    createdAt: now, updatedAt: now, deletedAt: null, dueAt: null, duePreset: 'none', status: 'active', completedAt: null,
    repeatRule: { frequency: 'year', interval: 1, startsOn: '2026-11-25' },
    routineHistory: Object.fromEntries(keys.map(key => [key, now.toISOString()])) };
  const before = JSON.stringify(memo);
  const all = routineHistoryDays(memo, now, Infinity);
  expect(all.map(day => day.key)).toEqual(keys);
  expect(new Set(all.map(day => day.key)).size).toBe(5000);
  expect(routineHistoryDays(memo, now)).toEqual(all.slice(0, 7));
  for (let limit = 50; limit <= 5000; limit += 50)
    expect(all.slice(0, limit).map(day => day.key)).toEqual(keys.slice(0, limit));
  expect(JSON.stringify(memo)).toBe(before);
});

it('keeps cancelled, invalid, and future dates out of expanded history just as in compact mode', () => {
  const now = new Date(2026, 10, 25, 12), timestamp = now.toISOString();
  const memo: MemoNode = { id: 'r', type: 'memo', title: '合成', body: '', parentId: 'root', sortKey: 'a0',
    createdAt: now, updatedAt: now, deletedAt: null, dueAt: null, duePreset: 'none', status: 'active', completedAt: null,
    routineHistory: { '2026-11-03': timestamp, '2026-11-04': timestamp, '2026-11-26': timestamp, bad: timestamp, '2026-11-31': timestamp },
    routineOutcomes: { '2026-11-03': { state: 'pending', changedAt: timestamp, version: 2 } } };
  expect(routineHistoryDays(memo, now, Infinity).map(day => day.key)).toEqual(['2026-11-04']);
});
