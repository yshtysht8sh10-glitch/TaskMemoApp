import { expect, it } from 'vitest';
import type { CategoryNode, MemoNode, Node } from '../models/node';
import { deadlineGroups, moveMemoInDeadlineList } from './deadlineView';
import { parseNodeBackup, serializeNodeBackup } from '../services/nodeBackup';

const start = new Date(2026, 9, 3, 9);
const now = new Date(2026, 9, 5, 8);
const root: CategoryNode = { id: 'r', type: 'category', categoryKind: 'routineRoot', parentId: null, sortKey: 'a0', title: 'routine', createdAt: start, updatedAt: start, deletedAt: null };
const routine: MemoNode = { id: 'm', type: 'memo', parentId: 'r', sortKey: 'a0', title: 'daily', body: '', dueAt: start, duePreset: 'custom', repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-03' }, status: 'active', completedAt: null, createdAt: start, updatedAt: start, deletedAt: null };
const task: MemoNode = { ...routine, id: 'task', parentId: null, repeatRule: null, dueAt: new Date(2026, 9, 4, 10), sortKey: 'a1' };
const seed: Node[] = [root, routine, task, { ...task, id: 'today', dueAt: new Date(2026, 9, 5, 10), sortKey: 'a2', deadlineSortKey: 'a5' }];
const ids = (nodes: Node[], group = 'overdue') => deadlineGroups(nodes, now).find(g => g.key === group)!.memos.map(m => m.id);
const old = 'routine-overdue:m:2026-10-03';
const next = 'routine-overdue:m:2026-10-04';

it('reorders one missed occurrence independently of siblings, today and tree, through backup restart', () => {
  expect(ids(seed)).toEqual([old, next, 'task']);
  const moved = moveMemoInDeadlineList(seed, old, 'overdue', undefined, now);
  expect(ids(moved)).toEqual([next, 'task', old]);
  expect(ids(moved, 'am')).toEqual(ids(seed, 'am'));
  expect(moved.find(n => n.id === 'today')).toEqual(seed.find(n => n.id === 'today'));
  const stored = moved.find(n => n.id === 'm') as MemoNode;
  for (const field of ['parentId', 'sortKey', 'repeatRule', 'dueAt', 'duePreset', 'status', 'completedAt', 'routineHistory', 'routineDueOverrides'] as const) expect(stored[field]).toEqual(routine[field]);
  expect(moved.map(n => n.id)).toEqual(seed.map(n => n.id));
  const restored = parseNodeBackup(serializeNodeBackup(moved, now));
  expect(ids(restored)).toEqual([next, 'task', old]);
  expect(ids(moveMemoInDeadlineList(restored, 'task', 'overdue', next, now))).toEqual(['task', next, old]);
});

it('rejects cross-group drops of virtual occurrences without touching data', () => {
  expect(moveMemoInDeadlineList(seed, old, 'am', undefined, now)).toBe(seed);
});

it('today Routine reordering does not reorder its past occurrences', () => {
  const moved = moveMemoInDeadlineList(seed, 'm', 'am', undefined, now);
  expect(ids(moved, 'am')).toEqual(['today', 'm']);
  expect(ids(moved)).toEqual(ids(seed));
});

it('repairs duplicate inherited ranks only in the reordered group and preserves history/overrides', () => {
  const source: Node[] = seed.map(node => node.id === 'm' ? { ...routine, deadlineSortKey: 'a0',
    routineHistory: { '2026-10-02': start.toISOString(), '2026-10-03': null },
    routineDueOverrides: { '2026-10-05': new Date(2026, 9, 5, 9).toISOString() } } : node);
  const before = ids(source), todayBefore = ids(source, 'am');
  const moved = moveMemoInDeadlineList(source, before[0], 'overdue', undefined, now);
  expect(ids(moved)).toEqual([...before.slice(1), before[0]]);
  expect(ids(moved, 'am')).toEqual(todayBefore);
  const stored = moved.find(n => n.id === 'm') as MemoNode, original = source.find(n => n.id === 'm') as MemoNode;
  expect(stored.routineHistory).toEqual(original.routineHistory);
  expect(stored.routineDueOverrides).toEqual(original.routineDueOverrides);
  expect(new Set(deadlineGroups(moved, now).find(g => g.key === 'overdue')!.memos.map(m => m.deadlineSortKey)).size).toBe(3);
  expect(moveMemoInDeadlineList(moved, before[0], 'overdue', undefined, now)).toBe(moved);
});
