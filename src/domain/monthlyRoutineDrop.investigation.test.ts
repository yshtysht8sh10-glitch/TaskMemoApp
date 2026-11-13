import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { CategoryNode, MemoNode, Node } from '../models/node';
import { IndexedDbTaskMemoApplicationJournal } from '../sync/indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import { deadlineDisplayGroups, deadlineGroups, moveMemoInDeadlineList, updateMemoDeadline } from './deadlineView';
import { localDateKey } from './routine';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
// Synthetic data only. These characterize e18c4d1, not desired cross-day behavior.
const now = new Date(2026, 10, 13, 10);
const root: CategoryNode = { id: 'r', type: 'category', categoryKind: 'routineRoot', parentId: null,
  sortKey: 'a0', title: 'synthetic routine', createdAt: now, updatedAt: now, deletedAt: null };
const monthly: MemoNode = { id: 'monthly', type: 'memo', memoType: 'task', parentId: 'r', sortKey: 'a0',
  title: 'synthetic monthly photo', body: 'keep', dueAt: new Date(2026, 10, 13, 23, 59, 59, 999),
  duePreset: 'custom', status: 'active', completedAt: null, createdAt: now, updatedAt: now, deletedAt: null,
  repeatRule: { frequency: 'month', interval: 1, startsOn: '2026-11-13' },
  routineHistory: { '2026-10-13': new Date(2026, 9, 13, 20).toISOString() } };
const seed = (): Node[] => [root, monthly];
const groupOf = (nodes: Node[], id = monthly.id, date = now) =>
  deadlineGroups(nodes, date, undefined, 'threePart').find(g => g.memos.some(m => m.id === id))?.key;

it('reported date merges tomorrow and thisWeek into the 11/14 heading', () => {
  expect(groupOf(seed())).toBe('evening');
  expect(deadlineDisplayGroups(deadlineGroups(seed(), now, undefined, 'threePart'), now, 'threePart').find(g => g.key === 'tomorrow')?.label)
    .toBe('明日・今週（11/14）');
});
it.each(['tomorrow', 'thisWeek'] as const)('monthly drop to %s is rejected before any storage or synchronization', target => {
  const nodes = seed(), before = structuredClone(nodes);
  expect(updateMemoDeadline(nodes, monthly.id, target, now, 'threePart')).toBe(nodes);
  expect(moveMemoInDeadlineList(nodes, monthly.id, target, undefined, now, 'threePart')).toBe(nodes);
  expect(nodes).toEqual(before); expect(groupOf(nodes)).toBe('evening');
});
it('an ordinary task reaches tomorrow with the same target and current date', () => {
  const task = { ...monthly, id: 'task', parentId: null, repeatRule: null };
  const nodes: Node[] = [task], moved = moveMemoInDeadlineList(nodes, task.id, 'tomorrow', undefined, now, 'threePart');
  expect(groupOf(moved, task.id)).toBe('tomorrow');
  expect(localDateKey((moved[0] as MemoNode).dueAt!)).toBe('2026-11-14');
});
it('same-day monthly move is supported and preserves definition and history', () => {
  const moved = moveMemoInDeadlineList(seed(), monthly.id, 'daytime', undefined, now, 'dayNight');
  const memo = moved[1] as MemoNode;
  expect(deadlineGroups(moved, now, undefined, 'dayNight').find(g => g.memos.some(m => m.id === monthly.id))?.key).toBe('daytime');
  expect(memo.repeatRule).toEqual(monthly.repeatRule); expect(memo.dueAt).toEqual(monthly.dueAt);
  expect(memo.routineHistory).toEqual(monthly.routineHistory);
  expect(memo.routineDueOverrides?.['2026-11-13']).toBeTruthy();
});
it.each(['day', 'week'] as const)('the cross-day restriction also affects %s routines, not only monthly', frequency => {
  const nodes: Node[] = [root, { ...monthly, repeatRule: { ...monthly.repeatRule!, frequency } }];
  expect(moveMemoInDeadlineList(nodes, monthly.id, 'tomorrow', undefined, now, 'threePart')).toBe(nodes);
});
it('isolated Application produces no save, History, Outbox or changed UI state for rejected monthly drop', async () => {
  const journal = await IndexedDbTaskMemoApplicationJournal.open('synthetic-monthly-drop-investigation', new IDBFactory());
  const store = await TaskMemoV2ApplicationStore.open(journal, seed(), { deviceId: 'synthetic', now: () => now });
  const before = await journal.loadCommitted(), depths = store.historyDepths, outbox = structuredClone(store.outbox);
  const result = await store.command('synthetic drop', 'update', nodes =>
    moveMemoInDeadlineList(nodes, monthly.id, 'tomorrow', undefined, now, 'threePart'));
  expect(result).toEqual([]);
  expect(await journal.loadCommitted()).toEqual(before); expect(store.historyDepths).toEqual(depths);
  expect(store.outbox).toEqual(outbox); expect(groupOf(store.nodes)).toBe('evening');
});
