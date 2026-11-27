import { expect, it } from 'vitest';
import type { MemoNode, Node } from '../models/node';
import { missedRoutineOccurrences, setRoutineResult } from '../domain/routine';
import { routineHistoryRows } from './routineHistoryRows';
const now = new Date(2026, 10, 27, 12);
function fixture(): Node[] {
  return [{ id: 'root', type: 'category', categoryKind: 'routineRoot', parentId: null, title: 'Routine', sortKey: 'a0', createdAt: now, updatedAt: now, deletedAt: null },
    { id: 'routine', type: 'memo', memoType: 'task', parentId: 'root', title: 'synthetic', body: '', sortKey: 'a0', status: 'active', completedAt: null,
      createdAt: now, updatedAt: now, deletedAt: null, dueAt: new Date(2026, 10, 26, 9), duePreset: 'custom',
      repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-11-26' } }];
}
it('shows the existing overdue 11/26 as pending alongside today, without changing any data', () => {
  const nodes = fixture(), memo = nodes[1] as MemoNode, before = JSON.stringify(nodes);
  expect(missedRoutineOccurrences(nodes, memo, now).map(n => n.routineOccurrenceKey)).toEqual(['2026-11-26']);
  expect(routineHistoryRows(nodes, memo, now)).toMatchObject([{ key: '2026-11-27', outcome: 'pending' }, { key: '2026-11-26', outcome: 'pending' }]);
  expect(JSON.stringify(nodes)).toBe(before);
});
it('selects missed for that exact past date, deduplicates it, and restores pending on cancellation', () => {
  const nodes = fixture(), date = new Date(2026, 10, 26);
  const changed = setRoutineResult(nodes, 'routine', date, 'missed', now);
  expect(routineHistoryRows(changed, changed[1] as MemoNode, now).filter(d => d.key === '2026-11-26')).toMatchObject([{ outcome: 'missed' }]);
  const cancelled = setRoutineResult(changed, 'routine', date, 'pending', now);
  expect(routineHistoryRows(cancelled, cancelled[1] as MemoNode, now).find(d => d.key === '2026-11-26')?.outcome).toBe('pending');
  expect((changed[1] as MemoNode).repeatRule).toEqual((nodes[1] as MemoNode).repeatRule);
});
it('does not invent dates before startsOn, future rows or another same-name Routine results', () => {
  const nodes = fixture(), memo = nodes[1] as MemoNode;
  memo.routineHistory = { '2026-11-20': now.toISOString(), '2026-11-28': now.toISOString() };
  expect(routineHistoryRows(nodes, memo, now, Infinity).map(d => d.key)).toEqual(['2026-11-27', '2026-11-26', '2026-11-20']);
  const other = { ...memo, id: 'other', routineHistory: { '2026-11-19': now.toISOString() } };
  expect(routineHistoryRows([...nodes, other], memo, now, Infinity).some(d => d.key === '2026-11-19')).toBe(false);
});
