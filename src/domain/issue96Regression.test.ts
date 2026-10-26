import { expect, it, vi } from 'vitest';
import type { CategoryNode, MemoNode, Node } from '../models/node';
import { deadlineGroups, moveMemoInDeadlineList } from './deadlineView';
import { parseNodeBackup, serializeNodeBackup } from '../services/nodeBackup';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTaskMemoApplicationJournal } from '../sync/indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import { InMemoryRevisionServer } from '../sync/revisionModel';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));

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

it('reorders occurrences from two Routine definitions among ordinary overdue Tasks', () => {
  const second: MemoNode = { ...routine, id: 'm2', sortKey: 'a1',
    repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-04' } };
  const source = [...seed, second], original = structuredClone(source);
  const occurrence = 'routine-overdue:m2:2026-10-04';
  expect(ids(source)).toEqual([old, next, occurrence, 'task']);
  const moved = moveMemoInDeadlineList(source, occurrence, 'overdue', old, now);
  expect(ids(moved)).toEqual([occurrence, old, next, 'task']);
  expect(ids(moved, 'am')).toEqual(ids(source, 'am'));
  for (const id of ['m', 'm2']) {
    const before = source.find(n => n.id === id) as MemoNode, after = moved.find(n => n.id === id) as MemoNode;
    for (const field of ['repeatRule', 'dueAt', 'duePreset', 'routineHistory', 'routineOutcomes', 'sortKey', 'parentId'] as const)
      expect(after[field]).toEqual(before[field]);
  }
  expect(source).toEqual(original);
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

it('keeps mixed past/current overdue occurrences through IndexedDB, sync and Undo/Redo without changing Routine data', async () => {
  const current = new Date(2026, 9, 5, 11);
  const source: Node[] = seed.map(n => n.id === 'm' ? { ...routine,
    routineHistory: { '2026-10-02': start.toISOString() },
    routineOutcomes: { '2026-10-01': { state: 'skipped' as const, changedAt: start.toISOString(), version: 1 } },
    routineDueOverrides: { '2026-10-06': new Date(2026, 9, 6, 15).toISOString() },
    routineDeadlineSortKeys: { '2026-10-06': 'z0' },
  } : n.id === 'today' ? { ...n, dueAt: new Date(2026, 9, 6, 10) } : n)
    .map(n => n.type === 'memo' ? { ...n, memoType: 'task' as const } : n);
  const original = structuredClone(source), factory = new IDBFactory();
  const p = await IndexedDbTaskMemoApplicationJournal.open('96-mixed-a', factory);
  let a = await TaskMemoV2ApplicationStore.open(p, source, { deviceId: 'a', now: () => current });
  const b = await TaskMemoV2ApplicationStore.open(await IndexedDbTaskMemoApplicationJournal.open('96-mixed-b', factory), source, { deviceId: 'b' });
  const server = new InMemoryRevisionServer();
  const flush = async () => { for (const op of a.outbox) { const ack = server.apply(op); await a.acknowledge(op.opId, ack.record); await b.receive(ack.record!); } };
  const order = (store: TaskMemoV2ApplicationStore) => deadlineGroups(store.nodes, current).find(g => g.key === 'overdue')!.memos.map(n => n.id);
  const before = order(a), depth = a.historyDepths.past;
  expect(before).toEqual([old, next, 'task', 'm']);
  await a.command('一覧でMemoを移動', 'update', nodes => moveMemoInDeadlineList(nodes, old, 'overdue', undefined, current));
  const after = [next, 'task', 'm', old];
  expect(order(a)).toEqual(after); expect(a.historyDepths.past).toBe(depth + 1);
  expect(a.outbox.map(op => op.targetNodeId).sort()).toEqual(['m', 'task']);
  await flush(); expect(order(b)).toEqual(after);
  a = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'ignored' });
  expect(order(a)).toEqual(after);
  await a.undo(new Date(current.getTime() + 1)); await flush(); expect(order(b)).toEqual(before);
  await a.redo(new Date(current.getTime() + 2)); await flush(); expect(order(b)).toEqual(after);
  const stored = a.nodes.find(n => n.id === 'm') as MemoNode;
  const initial = source.find(n => n.id === 'm') as MemoNode;
  for (const field of ['title', 'body', 'parentId', 'sortKey', 'repeatRule', 'dueAt', 'duePreset', 'status', 'completedAt', 'routineHistory', 'routineOutcomes', 'routineDueOverrides'] as const)
    expect(stored[field]).toEqual(initial[field]);
  expect(stored.routineDeadlineSortKeys?.['2026-10-06']).toBe('z0');
  expect(a.nodes.find(n => n.id === 'today')).toEqual(source.find(n => n.id === 'today'));
  expect(source).toEqual(original);
});
