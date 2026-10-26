import { expect, it, vi } from 'vitest';
import type { MemoNode } from '../models/node';
import { deadlineGroups, moveMemoInDeadlineList } from './deadlineView';
import { IndexedDbTaskMemoApplicationJournal } from '../sync/indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import { InMemoryRevisionServer } from '../sync/revisionModel';
import { IDBFactory } from 'fake-indexeddb';
import { nodeFromV2Value, nodeToV2Value } from '../sync/nodeV2Codec';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
const now = new Date(2026, 9, 26, 10);
const memo: MemoNode = { id: 'm', type: 'memo', parentId: null, sortKey: 'a0', title: 'fixture', body: 'keep',
  dueAt: new Date(2026, 11, 31, 23, 59), duePreset: 'custom', status: 'active', completedAt: null,
  createdAt: now, updatedAt: now, deletedAt: null, routineHistory: { '2026-10-01': now.toISOString() } };
it.each([new Date(2027, 0, 1, 23, 59), new Date(2032, 1, 29, 15, 30)])(
  'moves to later only with an explicitly confirmed deadline %s (#102)', dueAt => {
    const source = [memo], original = structuredClone(source);
    expect(moveMemoInDeadlineList(source, 'm', 'later', undefined, now)).toBe(source);
    const moved = moveMemoInDeadlineList(source, 'm', 'later', undefined, now, 'amPm', dueAt);
    expect(moved[0]).toMatchObject({ dueAt, duePreset: 'custom', title: memo.title, body: memo.body, routineHistory: memo.routineHistory });
    expect(deadlineGroups(moved, now).find(g => g.key === 'later')?.memos.map(m => m.id)).toEqual(['m']);
    const year = moveMemoInDeadlineList(moved, 'm', 'thisYear', undefined, now);
    expect((year[0] as MemoNode).dueAt).toEqual(new Date(2026, 11, 31, 23, 59, 59, 999));
    const none = moveMemoInDeadlineList(moved, 'm', 'none', undefined, now);
    expect((none[0] as MemoNode).dueAt).toBeNull();
    expect(source).toEqual(original);
  },
);

it('keeps confirmed moves, Undo/Redo and multiple-year dates through IndexedDB and revision sync (#102)', async () => {
  const factory = new IDBFactory();
  const p = await IndexedDbTaskMemoApplicationJournal.open('102-a', factory);
  let a = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'a', now: () => now });
  const b = await TaskMemoV2ApplicationStore.open(await IndexedDbTaskMemoApplicationJournal.open('102-b', factory), [], { deviceId: 'b' });
  const server = new InMemoryRevisionServer();
  const flush = async () => { for (const op of a.outbox) { const ack = server.apply(op); await a.acknowledge(op.opId, ack.record); await b.receive(ack.record!); } };
  await a.command('create', 'create', n => [...n, memo]); await flush();
  const depth = a.historyDepths.past;
  const dueAt = new Date(2027, 0, 1, 23, 59);
  await a.command('drop', 'update', n => moveMemoInDeadlineList(n, 'm', 'later', undefined, now, 'amPm', dueAt));
  expect(a.historyDepths.past).toBe(depth + 1); expect(a.outbox).toHaveLength(1); await flush();
  expect((b.nodes[0] as MemoNode).dueAt).toEqual(dueAt);
  a = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'ignored' });
  expect((a.nodes[0] as MemoNode).dueAt).toEqual(dueAt);
  await a.undo(new Date(now.getTime() + 1)); await flush(); expect((b.nodes[0] as MemoNode).dueAt).toEqual(memo.dueAt);
  await a.redo(new Date(now.getTime() + 2)); await flush(); expect((b.nodes[0] as MemoNode).dueAt).toEqual(dueAt);
  const custom = new Date(2032, 1, 29, 15, 30);
  await a.command('edit date', 'update', n => moveMemoInDeadlineList(n, 'm', 'later', undefined, now, 'amPm', custom)); await flush();
  const encoded = JSON.parse(JSON.stringify(nodeToV2Value(b.nodes[0])));
  expect(nodeFromV2Value(encoded)).toMatchObject({ dueAt: custom, routineHistory: memo.routineHistory });
});

it('rejects year-end overlap and invalid dates before saving, and allows later dates (#102)', () => {
  const yearEnd = new Date(2026, 11, 31, 10), source = [memo];
  for (const due of [new Date(2027, 0, 1, 23, 59), new Date(NaN)])
    expect(() => moveMemoInDeadlineList(source, 'm', 'later', undefined, yearEnd, 'amPm', due)).toThrow('期間');
  const moved = moveMemoInDeadlineList(source, 'm', 'later', undefined, yearEnd, 'amPm', new Date(2027, 0, 20, 23, 59));
  expect(deadlineGroups(moved, yearEnd).find(g => g.key === 'later')?.memos).toHaveLength(1);
  expect(source).toEqual([memo]);
});

it('does not change Routine definitions or occurrence histories for future-year drops (#102)', () => {
  const root = { id: 'r', type: 'category' as const, categoryKind: 'routineRoot' as const, title: 'r', parentId: null, sortKey: 'a0', createdAt: now, updatedAt: now, deletedAt: null };
  const routine = { ...memo, parentId: 'r', repeatRule: { frequency: 'day' as const, interval: 1, startsOn: '2026-10-25' } };
  const source = [root, routine];
  const original = structuredClone(source);
  for (const id of ['m', 'routine-overdue:m:2026-10-25'])
    expect(moveMemoInDeadlineList(source, id, 'later', undefined, now, 'amPm', new Date(2027, 0, 1, 23, 59))).toBe(source);
  expect(source).toEqual(original);
});
