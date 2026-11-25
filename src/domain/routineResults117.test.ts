import { expect, it, vi } from 'vitest';
import type { MemoNode, Node, RepeatRule } from '../models/node';
import { clearRoutineCompletion, clearRoutineSkip, clearRoutineResult, setRoutineResult, routineHistoryDays, routineOccurrenceDueAt, missedRoutineOccurrences, nextRoutineOutcome } from './routine';
import { mergeRoutineOutcomes } from './routineOutcomeMerge';
import { completionHistoryGroups } from './completionHistory';
import { parseNodeBackup, serializeNodeBackup } from '../services/nodeBackup';
import { nodeToV2Value } from '../sync/nodeV2Codec';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import { TaskMemoV2SyncController } from '../sync/taskMemoV2SyncController';
import type { SyncAdapter } from '../sync/types';
import { InMemoryRevisionServer } from '../sync/revisionModel';
import { IndexedDbTaskMemoApplicationJournal } from '../sync/indexedDbApplicationStorage';
import { IDBFactory } from 'fake-indexeddb';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
const now = new Date(2026, 10, 26, 12), old = new Date(2026, 10, 25, 12), key = '2026-11-26';
function seed(frequency: RepeatRule['frequency'] = 'day'): Node[] {
  return [{ id: 'r', type: 'category', categoryKind: 'routineRoot', parentId: null, sortKey: 'a0', title: 'Routine', createdAt: now, updatedAt: now, deletedAt: null },
    { id: 'a', type: 'memo', memoType: 'task', parentId: 'r', sortKey: 'a0', title: 'same', body: '', status: 'active', completedAt: null, dueAt: now, duePreset: 'custom', repeatRule: { frequency, interval: 1, startsOn: '2026-11-26' }, createdAt: now, updatedAt: now, deletedAt: null }];
}
const memo = (nodes: Node[]) => nodes.find(n => n.id === 'a') as MemoNode;
const set = (nodes: Node[], state: 'completed' | 'skipped' | 'missed', date = now) => setRoutineResult(nodes, 'a', date, state, now);
it.each(['day', 'week', 'month', 'year'] as const)('R01/R09/R16 %s: explicit outcomes preserve identity/rule and do not generate finalized occurrences', frequency => {
  const before = seed(frequency);
  for (const state of ['completed', 'skipped', 'missed'] as const) {
    const after = set(before, state);
    expect(memo(after).repeatRule).toEqual(memo(before).repeatRule);
    expect(memo(after)).toMatchObject({ id: 'a', status: 'active', deletedAt: null });
    expect(routineOccurrenceDueAt(after, memo(after), now)).toBeNull();
    expect(missedRoutineOccurrences(after, memo(after), new Date(2026, 10, 27))).toEqual([]);
    expect(routineHistoryDays(memo(after), now)).toMatchObject([{ key, outcome: state }]);
    expect(completionHistoryGroups(after, 'completedAt')[0].items[0].outcome).toBe(state);
    expect(memo(clearRoutineResult(after, 'a', now, now)).routineOutcomes?.[key]).toMatchObject({ state: 'pending', version: 2 });
  }
  expect(memo(before).routineOutcomes).toBeUndefined();
});
it('R02: saved old-period results may be changed and cancelled without inventing a new pending occurrence', () => {
  const nodes = seed('month');
  memo(nodes).routineOutcomes = { '2026-11-25': { state: 'skipped', changedAt: old.toISOString(), version: 1 } };
  const after = set(nodes, 'missed', old);
  expect(memo(after).routineOutcomes?.['2026-11-25']).toMatchObject({ state: 'missed', version: 2 });
  const cancelled = clearRoutineResult(after, 'a', old, now);
  expect(routineHistoryDays(memo(cancelled), now).map(d => d.key)).toEqual([key]);
  expect(missedRoutineOccurrences(cancelled, memo(cancelled), now)).toEqual([]);
  expect(() => set(seed(), 'missed', old)).toThrow();
  expect(() => set(seed(), 'missed', new Date(2026, 10, 27))).toThrow();
});
it('R02/R04: legacy completion cancellation creates a pending register and old-period skip cancellation uses saved evidence', () => {
  const nodes = seed('month');
  memo(nodes).routineHistory = { '2026-11-25': old.toISOString() };
  const after = clearRoutineCompletion(nodes, 'a', old, now);
  expect(memo(after).routineOutcomes?.['2026-11-25']).toMatchObject({ state: 'pending', version: 1 });
  memo(nodes).routineOutcomes = { '2026-11-25': { state: 'skipped', changedAt: old.toISOString(), version: 1 } };
  expect(memo(clearRoutineSkip(nodes, 'a', old, now)).routineOutcomes?.['2026-11-25']).toMatchObject({ state: 'pending', version: 2 });
});
it('R03/R04: equal register ties converge; pending beats stale missed/completed in both orders', () => {
  const states = ['completed', 'missed', 'pending', 'skipped'] as const;
  for (const [i, a] of states.entries()) for (const [j, b] of states.entries()) {
    const x = { [key]: { state: a, changedAt: now.toISOString(), version: 2 } };
    const y = { [key]: { state: b, changedAt: now.toISOString(), version: 2 } };
    expect(mergeRoutineOutcomes(x, y)).toEqual(mergeRoutineOutcomes(y, x));
    expect(mergeRoutineOutcomes(x, y)[key].state).toBe(states[Math.max(i, j)]);
  }
  const ended = set(seed(), 'missed'), pending = clearRoutineResult(ended, 'a', now, now);
  expect(mergeRoutineOutcomes(memo(ended).routineOutcomes, memo(pending).routineOutcomes)[key].state).toBe('pending');
});
it('R07: backup/JSON retain missed, cancellation and target-date identity', () => {
  const nodes = set(seed(), 'missed');
  expect(parseNodeBackup(serializeNodeBackup(nodes, now))).toEqual(nodes);
  expect(JSON.parse(JSON.stringify(nodeToV2Value(memo(nodes))))).toMatchObject({ routineOutcomes: { [key]: { state: 'missed' } } });
});
it('R17: noncanonical existing timestamps and exhausted versions block a new result rather than normalizing old data', () => {
  const nodes = seed(), m = memo(nodes);
  for (const outcome of [
    { state: 'completed' as const, changedAt: '2026-11-26T09:00:00+09:00', version: 1 },
    { state: 'completed' as const, changedAt: now.toISOString(), version: Number.MAX_SAFE_INTEGER },
  ]) {
    m.routineOutcomes = { [key]: outcome };
    const raw = JSON.stringify(nodes);
    expect(() => nextRoutineOutcome(m, key, 'missed', now)).toThrow();
    expect(JSON.stringify(nodes)).toBe(raw);
  }
});
it('R05/R07: isolated atomic store preserves missed, Undo/Redo, Outbox and History across restart', async () => {
  const p = await IndexedDbTaskMemoApplicationJournal.open('synthetic-r117', new IDBFactory());
  let store = await TaskMemoV2ApplicationStore.open(p, seed(), { deviceId: 'a', now: () => now, isolatedRoutineResults: true });
  await store.command('未達', 'update', n => set(n, 'missed'));
  store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'a', now: () => now, isolatedRoutineResults: true });
  expect(memo(store.nodes).routineOutcomes?.[key].state).toBe('missed');
  await store.undo(); expect(memo(store.nodes).routineOutcomes?.[key].state).toBe('pending');
  await store.redo(); expect(memo(store.nodes).routineOutcomes?.[key].state).toBe('missed');
  expect(store.historyDepths.past).toBe(1); expect(store.outbox).toHaveLength(3);
  const server = new InMemoryRevisionServer();
  for (const op of store.outbox) server.apply(op);
  expect(server.get('a')?.value.routineOutcomes).toEqual(memo(store.nodes).routineOutcomes);
});
it('R08/R18: default product store never publishes new missed writes', async () => {
  const p = await IndexedDbTaskMemoApplicationJournal.open('synthetic-closed', new IDBFactory());
  const store = await TaskMemoV2ApplicationStore.open(p, seed(), { deviceId: 'closed', now: () => now });
  const before = await p.loadCommitted();
  await expect(store.command('未達', 'update', n => set(n, 'missed'))).rejects.toThrow(/未達.*閉鎖/);
  expect(await p.loadCommitted()).toBe(before); expect(store.outbox).toEqual([]);
});
it.each(['QuotaExceededError', 'AbortError', 'CAS mismatch'])('R06: %s leaves raw, memory, sequence and Outbox unchanged', async failure => {
  const p = await IndexedDbTaskMemoApplicationJournal.open('synthetic-failure', new IDBFactory());
  const store = await TaskMemoV2ApplicationStore.open(p, seed(), { deviceId: 'a', now: () => now, isolatedRoutineResults: true });
  const raw = await p.loadCommitted(), nodes = JSON.stringify(store.nodes);
  const fail = vi.spyOn(p, 'writeAtomic').mockRejectedValueOnce(new Error(failure));
  await expect(store.command('未達', 'update', n => set(n, 'missed'))).rejects.toThrow(failure);
  expect(await p.loadCommitted()).toBe(raw); expect(await p.loadJournal()).toBeNull();
  expect(JSON.stringify(store.nodes)).toBe(nodes); expect(store.outbox).toEqual([]); expect(store.historyDepths.past).toBe(0);
  fail.mockRestore();
  const [op] = await store.command('未達', 'update', n => set(n, 'missed'));
  expect(op.localSeq).toBe(1);
});
it('R06: a second stale writer cannot overwrite a successful atomic result', async () => {
  const factory = new IDBFactory();
  const p = await IndexedDbTaskMemoApplicationJournal.open('synthetic-cas', factory);
  const a = await TaskMemoV2ApplicationStore.open(p, seed(), { deviceId: 'a', now: () => now, isolatedRoutineResults: true });
  const b = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'b', now: () => now, isolatedRoutineResults: true });
  await a.command('未達', 'update', n => set(n, 'missed'));
  const raw = await p.loadCommitted();
  await expect(b.command('完了', 'complete', n => set(n, 'completed'))).rejects.toThrow(/別の操作/);
  expect(await p.loadCommitted()).toBe(raw); expect(b.outbox).toEqual([]);
});
it('R15: unknown Journal evidence stops before recovery writes or clearing the original', async () => {
  const p = await IndexedDbTaskMemoApplicationJournal.open('synthetic-unknown', new IDBFactory());
  await TaskMemoV2ApplicationStore.open(p, seed(), { deviceId: 'a', now: () => now });
  const committed = await p.loadCommitted(), invalid = JSON.parse(committed!);
  invalid.domain.a.value.routineOutcomes = { [key]: { state: 'unknown-future', changedAt: now.toISOString(), version: 1 } };
  const raw = JSON.stringify(invalid); await p.writeJournal(raw);
  await expect(TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'a' })).rejects.toThrow(/原本/);
  expect(await p.loadJournal()).toBe(raw); expect(await p.loadCommitted()).toBe(committed);
  expect(() => mergeRoutineOutcomes(undefined, invalid.domain.a.value.routineOutcomes)).toThrow();
});
it('R08/R18: isolated store cannot connect or flush any SDK adapter, including after restart without the harness option', async () => {
  const p = await IndexedDbTaskMemoApplicationJournal.open('synthetic-network-block', new IDBFactory());
  const store = await TaskMemoV2ApplicationStore.open(p, seed(), { deviceId: 'a', now: () => now, isolatedRoutineResults: true });
  await store.command('未達', 'update', n => set(n, 'missed'));
  const connect = vi.fn(), upload = vi.fn(), adapter = { connect, upload } as unknown as SyncAdapter;
  for (const s of [store, await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'a' })]) {
    const controller = new TaskMemoV2SyncController(s, adapter);
    await expect(controller.start()).rejects.toThrow(/未承認/);
    await expect(controller.flush()).rejects.toThrow(/未承認/);
    expect(controller.state).toMatchObject({ phase: 'error', pendingCount: 1 });
    expect(s.outbox).toHaveLength(1);
  }
  expect(connect).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
});
