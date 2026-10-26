import { expect, it, vi } from 'vitest';
import type { CategoryNode, MemoNode, Node } from '../models/node';
import { deadlineGroups, moveMemoInDeadlineList } from './deadlineView';
import { parseNodeBackup, serializeNodeBackup } from '../services/nodeBackup';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTaskMemoApplicationJournal } from '../sync/indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import { InMemoryRevisionServer } from '../sync/revisionModel';
import { duplicateMemo } from './nodeOperations';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));

const now = new Date(2026, 9, 26, 8);
const root: CategoryNode = { id: 'root', type: 'category', categoryKind: 'routineRoot', parentId: null, title: 'Routine', sortKey: 'a0', createdAt: now, updatedAt: now, deletedAt: null };
const routine = (id: string, sortKey: string, hour = 10): MemoNode => ({ id, type: 'memo', memoType: 'task', parentId: root.id, title: id, body: '', sortKey, dueAt: new Date(2026, 9, 26, hour), duePreset: 'custom', repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-26' }, status: 'active', completedAt: null, createdAt: now, updatedAt: now, deletedAt: null });
const a = routine('z-A', 'a0'), b = routine('m-B', 'a1'), c = routine('a-C', 'a2');
const ids = (nodes: Node[], date = now) => deadlineGroups(nodes, date, undefined, 'today').find(g => g.key === 'today')!.memos.map(m => m.id);

it('uses tree order for equal inherited ranks instead of accidental IDs, and reflects tree moves', () => {
  const nodes: Node[] = [root, c, b, a].map(n => n.type === 'memo' ? { ...n, deadlineSortKey: 'a0' } : n);
  expect(ids(nodes)).toEqual([a.id, b.id, c.id]);
  expect(ids(nodes.map(n => n.id === c.id ? { ...n, sortKey: 'Zz' } : n))).toEqual([c.id, a.id, b.id]);
  expect(ids(nodes.map(n => n.id === c.id ? { ...n, dueAt: new Date(2026, 9, 26, 9) } : n))).toEqual([c.id, a.id, b.id]);
});

it('reproduces the real duplicate command retaining the source deadline rank', () => {
  const seed: Node[] = [root, { ...a, deadlineSortKey: 'a0' }];
  const duplicate = duplicateMemo(seed, a.id, now, 'a-duplicate');
  expect(ids(duplicate)).toEqual([a.id, 'a-duplicate']);
});

it('orders multiple unranked newcomers by deadline then tree after saved rows', () => {
  const saved = { ...a, routineDeadlineSortKeys: { '2026-10-26': 'a0' } };
  const early = { ...routine('early', 'a9', 9) };
  expect(ids([root, c, b, early, saved])).toEqual([a.id, early.id, b.id, c.id]);
});

it('derives hierarchy order through parent Categories without changing non-Routine Task slots', () => {
  const parent: CategoryNode = { ...root, id: 'parent', categoryKind: undefined };
  const earlyRoot: CategoryNode = { ...root, id: 'earlyRoot', parentId: parent.id, sortKey: 'a0' };
  const lateRoot: CategoryNode = { ...root, id: 'lateRoot', parentId: parent.id, sortKey: 'a1' };
  const first = { ...a, parentId: earlyRoot.id, sortKey: 'a9', deadlineSortKey: 'a0' };
  const last = { ...c, parentId: lateRoot.id, sortKey: 'a0', deadlineSortKey: 'a0' };
  const task = { ...b, id: 'n-task', parentId: parent.id, repeatRule: null, deadlineSortKey: 'a0' };
  const nodes: Node[] = [last, task, first, lateRoot, parent, earlyRoot];
  const original = structuredClone(nodes);
  expect(ids(nodes)).toEqual([a.id, task.id, c.id]);
  expect(ids([...nodes].reverse())).toEqual([a.id, task.id, c.id]);
  expect(nodes).toEqual(original);
  // A nested ordinary Category does not turn its children into Routine definitions.
  expect(ids([root, { ...parent, parentId: root.id }, task])).toEqual([task.id]);
});

it('keeps ordinary Task manual order and unranked Task order intact', () => {
  const tasks = [a, b, c].map(n => ({ ...n, parentId: null, repeatRule: null }));
  expect(ids([root, ...tasks])).toEqual([a.id, b.id, c.id]);
  const moved = moveMemoInDeadlineList([root, ...tasks], c.id, 'today', a.id, now, 'today');
  expect(ids(moved)).toEqual([c.id, a.id, b.id]);
});

it('keeps saved order before unranked newcomers regardless of snapshot array order', () => {
  const rankedA = { ...a, routineDeadlineSortKeys: { '2026-10-26': 'a1' } };
  const rankedC = { ...c, routineDeadlineSortKeys: { '2026-10-26': 'a0' }, dueAt: new Date(2026, 9, 26, 12) };
  const fresh = { ...b, dueAt: new Date(2026, 9, 26, 11) };
  for (const order of [[rankedA, fresh, rankedC], [fresh, rankedC, rankedA], [rankedC, rankedA, fresh]])
    expect(ids([root, ...order])).toEqual([c.id, a.id, b.id]);
});

it.each(['day', 'week', 'month', 'year'] as const)('keeps %s occurrence deadlines primary and same-time tree ties stable', frequency => {
  const nodes: Node[] = [root, c, b, a].map(n => n.type === 'memo' ? { ...n, repeatRule: { ...n.repeatRule!, frequency } } : n);
  expect(ids(nodes)).toEqual([a.id, b.id, c.id]);
  expect(ids(nodes.map(n => n.id === c.id ? { ...n, dueAt: new Date(2026, 9, 26, 9) } : n))).toEqual([c.id, a.id, b.id]);
  expect(ids(parseNodeBackup(serializeNodeBackup(nodes, now)))).toEqual([a.id, b.id, c.id]);
});

it('keeps manual ranks across tree moves, initializes newcomer ranks on DnD, and isolates occurrence dates', () => {
  const seed: Node[] = [root, a, c];
  const moved = moveMemoInDeadlineList(seed, c.id, 'today', a.id, now, 'today');
  const withNew = [...moved, b];
  expect(ids(withNew)).toEqual([c.id, a.id, b.id]);
  expect(ids(withNew.map(n => n.id === a.id ? { ...n, sortKey: 'a9' } : n))).toEqual([c.id, a.id, b.id]);
  const changed = moveMemoInDeadlineList(withNew, b.id, 'today', c.id, now, 'today');
  expect(ids(changed)).toEqual([b.id, c.id, a.id]);
  expect(ids(changed, new Date(2026, 9, 27, 8))).toEqual([a.id, b.id, c.id]);
  for (const node of changed.filter((n): n is MemoNode => n.type === 'memo')) {
    expect(node.routineDeadlineSortKeys?.['2026-10-26']).toBeTruthy();
    expect(node.repeatRule).toEqual(a.repeatRule);
    expect(node.dueAt).toEqual(a.dueAt);
  }
});

it('persists newcomer DnD through IndexedDB, V2 sync, reload and Undo/Redo without changing history', async () => {
  const factory = new IDBFactory();
  const p = await IndexedDbTaskMemoApplicationJournal.open('issue91', factory);
  const source: Node[] = [root, { ...a, routineHistory: { '2026-10-25': now.toISOString() },
    routineOutcomes: { '2026-10-24': { state: 'skipped', changedAt: now.toISOString(), version: 1 } },
    routineDueOverrides: { '2026-10-27': new Date(2026, 9, 27, 11).toISOString() } }, c];
  let store = await TaskMemoV2ApplicationStore.open(p, source, { deviceId: 'a' });
  const peer = await TaskMemoV2ApplicationStore.open(await IndexedDbTaskMemoApplicationJournal.open('peer91', factory), source, { deviceId: 'b' });
  const server = new InMemoryRevisionServer();
  const flush = async () => { for (const op of store.outbox) { const ack = server.apply(op); await store.acknowledge(op.opId, ack.record); await peer.receive(ack.record!); } };
  await store.command('DnD', 'update', nodes => moveMemoInDeadlineList(nodes, c.id, 'today', a.id, now, 'today'));
  await flush();
  await store.command('new', 'create', nodes => [...nodes, b]); await flush();
  expect(ids(peer.nodes)).toEqual([c.id, a.id, b.id]);
  await store.command('DnD newcomer', 'update', nodes => moveMemoInDeadlineList(nodes, b.id, 'today', c.id, now, 'today')); await flush();
  store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'a' });
  expect(ids(store.nodes)).toEqual([b.id, c.id, a.id]); expect(ids(peer.nodes)).toEqual(ids(store.nodes));
  await store.undo(new Date(now.getTime() + 1)); await flush(); expect(ids(peer.nodes)).toEqual([c.id, a.id, b.id]);
  await store.redo(new Date(now.getTime() + 2)); await flush(); expect(ids(peer.nodes)).toEqual([b.id, c.id, a.id]);
  expect((store.nodes.find(n => n.id === a.id) as MemoNode).routineHistory).toEqual((source[1] as MemoNode).routineHistory);
  const stored = store.nodes.find(n => n.id === a.id) as MemoNode;
  for (const field of ['routineOutcomes', 'routineDueOverrides', 'repeatRule', 'dueAt', 'parentId', 'sortKey'] as const)
    expect(stored[field]).toEqual((source[1] as MemoNode)[field]);
});
