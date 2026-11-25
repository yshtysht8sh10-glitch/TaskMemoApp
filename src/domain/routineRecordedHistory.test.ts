import { expect, it, vi } from 'vitest';
import type { CategoryNode, MemoNode, Node, RepeatRule } from '../models/node';
import { clearRoutineCompletion, clearRoutineSkip, localDateKey, routineHistoryDays, routineOccurrenceDueAt } from './routine';
import { completionHistoryGroups } from './completionHistory';
import { parseNodeBackup, serializeNodeBackup } from '../services/nodeBackup';
import { IndexedDbTaskMemoApplicationJournal } from '../sync/indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import { InMemoryRevisionServer } from '../sync/revisionModel';
import { IDBFactory } from 'fake-indexeddb';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));

const now = new Date(2026, 10, 25, 12), changedAt = new Date(2026, 10, 24, 10).toISOString();
const root: CategoryNode = { id: 'r', type: 'category', categoryKind: 'routineRoot', parentId: null, sortKey: 'a0', title: 'Routine', createdAt: now, updatedAt: now, deletedAt: null };
const memo = (rule: RepeatRule | null = { frequency: 'week', interval: 1, startsOn: '2026-11-18' }): MemoNode => ({
  id: 'stable:r1', type: 'memo', title: '同名', body: '', parentId: 'r', sortKey: 'a0', createdAt: now, updatedAt: now, deletedAt: null,
  status: 'active', completedAt: null, dueAt: new Date(2026, 10, 25, 9), duePreset: 'custom', repeatRule: rule,
  routineHistory: { '2026-11-03': changedAt, '2026-11-04': changedAt, '2026-11-18': changedAt },
  routineOutcomes: { '2026-11-11': { state: 'skipped', changedAt, version: 1 } },
});

it.each(['day', 'week', 'month', 'year'] as const)('retains recorded dates after switching to %s rather than reconstructing the new rule', frequency => {
  const task = memo({ frequency, interval: 1, startsOn: '2026-11-25' });
  const before = JSON.stringify(task);
  expect(routineHistoryDays(task, now).map(d => d.key)).toEqual(['2026-11-25', '2026-11-18', '2026-11-11', '2026-11-04', '2026-11-03']);
  const saved = completionHistoryGroups([root, task], 'completedAt').flatMap(g => g.items).map(i => localDateKey(i.occurrenceDate!)).sort();
  expect(routineHistoryDays(task, now).filter(d => d.completed || d.outcome === 'skipped').map(d => d.key).sort()).toEqual(saved);
  expect(JSON.stringify(task)).toBe(before);
});
it('does not manufacture historical pending dates, and adds only the genuinely generated today row', () => {
  const task = { ...memo(), routineHistory: {}, routineOutcomes: {} };
  expect(routineHistoryDays(task, now).map(d => d.key)).toEqual(['2026-11-25']);
  expect(routineOccurrenceDueAt([root, task], task, now)).not.toBeNull();
  expect(routineHistoryDays({ ...task, repeatRule: { frequency: 'week', interval: 1, startsOn: '2026-11-26' } }, now)).toEqual([]);
});
it('preserves recorded history with no valid current rule and never displays future dates', () => {
  const task = memo(null); task.routineHistory!['2026-11-26'] = changedAt;
  expect(routineHistoryDays(task, now).map(d => d.key)).toEqual(['2026-11-18', '2026-11-11', '2026-11-04', '2026-11-03']);
});
it('deduplicates today and makes explicit pending cancellation override legacy completion', () => {
  const task = memo(); task.routineHistory!['2026-11-25'] = changedAt;
  task.routineOutcomes!['2026-11-04'] = { state: 'pending', changedAt, version: 2 };
  expect(routineHistoryDays(task, now).map(d => d.key)).toEqual(['2026-11-25', '2026-11-18', '2026-11-11', '2026-11-03']);
  expect(routineHistoryDays(task, now).filter(d => d.key === '2026-11-25')).toHaveLength(1);
});
it('does not confuse occurrence dates with changedAt or another same-name Routine', () => {
  const a = memo(), b = { ...memo(), id: 'another', routineHistory: { '2026-10-01': changedAt }, routineOutcomes: {} };
  expect(routineHistoryDays(a, now).some(d => d.key === '2026-10-01')).toBe(false);
  expect(routineHistoryDays(b, now).map(d => d.key)).toEqual(['2026-11-25', '2026-10-01']);
});
it('supports completion and skip cancellation without displaying cancelled records', () => {
  const task = memo({ frequency: 'day', interval: 1, startsOn: '2026-11-01' });
  let nodes: Node[] = clearRoutineCompletion([root, task], task.id, new Date(2026, 10, 3), now);
  nodes = clearRoutineSkip(nodes, task.id, new Date(2026, 10, 11), now);
  expect(routineHistoryDays(nodes[1] as MemoNode, now).map(d => d.key)).toEqual(['2026-11-25', '2026-11-18', '2026-11-04']);
});
it('keeps history through isolated restart, cycle Undo/Redo, revision delivery and backup restore', async () => {
  const journal = await IndexedDbTaskMemoApplicationJournal.open('issue137-synthetic', new IDBFactory());
  let store = await TaskMemoV2ApplicationStore.open(journal, [root, memo({ frequency: 'day', interval: 1, startsOn: '2026-11-01' })], { deviceId: 'history-a', now: () => now });
  await store.command('周期変更', 'update', nodes => nodes.map(n => n.id !== 'stable:r1' ? n : { ...n, repeatRule: { frequency: 'week', interval: 1, startsOn: '2026-11-25' }, updatedAt: now }));
  const dates = (nodes: Node[]) => routineHistoryDays(nodes.find(n => n.id === 'stable:r1') as MemoNode, now).map(d => d.key);
  const expected = ['2026-11-25', '2026-11-18', '2026-11-11', '2026-11-04', '2026-11-03'];
  store = await TaskMemoV2ApplicationStore.open(journal, [], { deviceId: 'ignored' });
  expect(dates(store.nodes)).toEqual(expected);
  await store.undo(); expect(dates(store.nodes)).toEqual(expected);
  await store.redo(); expect(dates(store.nodes)).toEqual(expected);
  const server = new InMemoryRevisionServer();
  for (const op of [...store.outbox]) await store.acknowledge(op.opId, server.apply(op).record);
  const peerJournal = await IndexedDbTaskMemoApplicationJournal.open('issue137-peer', new IDBFactory());
  const peer = await TaskMemoV2ApplicationStore.open(peerJournal, [root], { deviceId: 'history-b' });
  await peer.receive(server.get('stable:r1')!);
  expect(dates(peer.nodes)).toEqual(expected);
  expect(dates(parseNodeBackup(serializeNodeBackup(store.nodes)))).toEqual(expected);
  const committed = await journal.loadCommitted();
  const outbox = JSON.stringify(store.outbox);
  dates(store.nodes); dates(store.nodes);
  expect(await journal.loadCommitted()).toBe(committed); expect(JSON.stringify(store.outbox)).toBe(outbox);
});
