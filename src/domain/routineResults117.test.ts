import { expect, it, vi } from 'vitest';
import type { MemoNode, Node, RepeatRule } from '../models/node';
import { clearRoutineCompletion, clearRoutineSkip, clearRoutineResult, setRoutineResult, routineHistoryDays, routineOccurrenceDueAt, missedRoutineOccurrences, nextRoutineOutcome } from './routine';
import { mergeRoutineOutcomes } from './routineOutcomeMerge';
import { completionHistoryGroups } from './completionHistory';
import { parseNodeBackup, serializeNodeBackup } from '../services/nodeBackup';
import { nodeToV2Value } from '../sync/nodeV2Codec';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import { TaskMemoV2SyncController } from '../sync/taskMemoV2SyncController';
import type { SyncAdapter, SyncNodeValue } from '../sync/types';
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
  let store = await TaskMemoV2ApplicationStore.open(p, seed(), { deviceId: 'a', now: () => now, isolatedRoutineResults: true });
  const raw = await p.loadCommitted(), nodes = JSON.stringify(store.nodes);
  const fail = vi.spyOn(p, 'writeAtomic').mockRejectedValueOnce(new Error(failure));
  await expect(store.command('未達', 'update', n => set(n, 'missed'))).rejects.toThrow(failure);
  expect(await p.loadCommitted()).toBe(raw); expect(await p.loadJournal()).toBeNull();
  expect(JSON.stringify(store.nodes)).toBe(nodes); expect(store.outbox).toEqual([]); expect(store.historyDepths.past).toBe(0);
  fail.mockRestore();
  await expect(store.command('未達', 'update', n => set(n, 'missed'))).rejects.toThrow(failure);
  store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'a', now: () => now, isolatedRoutineResults: true });
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

it.each([1, 2])('R145: an ACK introducing missed stops the running drain with %i original operations', async count => {
  const p = await IndexedDbTaskMemoApplicationJournal.open('synthetic-ack-fence', new IDBFactory());
  const store = await TaskMemoV2ApplicationStore.open(p, seed(), { deviceId: 'a', now: () => now });
  for (let i = 0; i < count; i++) await store.command('title', 'update', nodes => nodes.map(n => n.id === 'a' ? { ...n, title: String(i) } : n));
  const originals = JSON.parse(JSON.stringify(store.outbox));
  const upload = vi.fn<SyncAdapter['upload']>(async op => ({ opId: op.opId, record: {
    value: { ...op.payload.node as SyncNodeValue, routineOutcomes: { [key]: { state: 'missed', changedAt: now.toISOString(), version: 100 } } },
    revision: 100, lastOpId: 'remote:100', lastDeviceId: 'remote', lastLocalSeq: 100, operationType: 'update',
  } }));
  const unsubscribe = vi.fn();
  const controller = new TaskMemoV2SyncController(store, { connect: async () => {}, upload, subscribe: () => unsubscribe });
  await controller.start();
  expect(upload).toHaveBeenCalledTimes(1);
  expect(store.outbox).toEqual(originals.slice(1));
  expect(controller.state).toMatchObject({ phase: 'error', pendingCount: count - 1 });
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(memo(store.nodes).routineOutcomes?.[key].state).toBe('missed');
  const restarted = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'ignored' });
  expect(restarted.outbox).toEqual(originals.slice(1));
  expect(restarted.historyDepths.past).toBe(count);
});

it.each([
  { laterCancellation: false, observation: 'display' },
  { laterCancellation: true, observation: 'display' },
  { laterCancellation: true, observation: 'transport' },
])('R145: queued protection, pending=$laterCancellation first observed by $observation', async ({ laterCancellation, observation }) => {
  const p = await IndexedDbTaskMemoApplicationJournal.open('synthetic-queued-fence', new IDBFactory());
  const store = await TaskMemoV2ApplicationStore.open(p, seed(), { deviceId: 'a', now: () => now });
  await store.command('title', 'update', nodes => nodes.map(n => n.id === 'a' ? { ...n, title: 'draft' } : n));
  const original = JSON.parse(JSON.stringify(store.outbox));
  let resolveStarted!: () => void, release!: () => void;
  const started = new Promise<void>(r => { resolveStarted = r; }), wait = new Promise<void>(r => { release = r; });
  let allowed: boolean | undefined;
  let queuedMayStart: (() => boolean) | undefined;
  const controller = new TaskMemoV2SyncController(store, { connect: async () => {}, upload: async (_op, _expected, _current, mayStart) => {
    queuedMayStart = mayStart; resolveStarted(); await wait; allowed = mayStart?.();
    throw { kind: 'offline', message: 'queued operation not started' };
  } });
  const running = controller.start(); await started;
  const record = store.versionedNode('a')!;
  await store.receive({ ...record, revision: 100, lastOpId: 'remote:100', lastDeviceId: 'remote',
    value: { ...record.value, routineOutcomes: { [key]: { state: 'missed', changedAt: now.toISOString(), version: 100 } } } });
  if (observation === 'display') expect(controller.state.phase).toBe('error');
  else expect(queuedMayStart?.()).toBe(false);
  if (laterCancellation) {
    await store.receive({ ...record, revision: 101, lastOpId: 'remote:101', lastDeviceId: 'remote',
      value: { ...record.value, routineOutcomes: { [key]: { state: 'pending', changedAt: now.toISOString(), version: 101 } } } });
    expect(store.restrictedRoutineResults).toBe(false);
  }
  release(); await running;
  expect(allowed).toBe(false); expect(store.outbox).toEqual(original);
  expect(controller.state.phase).toBe('error');
});

it('R145: listener reception during an in-flight upload preserves the remaining original operation', async () => {
  const p = await IndexedDbTaskMemoApplicationJournal.open('synthetic-listener-fence', new IDBFactory());
  const store = await TaskMemoV2ApplicationStore.open(p, seed(), { deviceId: 'a', now: () => now });
  for (const title of ['one', 'two']) await store.command('title', 'update', nodes => nodes.map(n => n.id === 'a' ? { ...n, title } : n));
  const original = JSON.parse(JSON.stringify(store.outbox));
  let listener!: Parameters<NonNullable<SyncAdapter['subscribe']>>[0];
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(r => { release = r; }), began = new Promise<void>(r => { started = r; });
  const upload = vi.fn<SyncAdapter['upload']>(async op => {
    started(); await waiting;
    return { opId: op.opId, record: { ...store.versionedNode('a')!, value: op.payload.node as SyncNodeValue, revision: 1,
      lastOpId: op.opId, lastDeviceId: op.deviceId, lastLocalSeq: op.localSeq } };
  });
  const controller = new TaskMemoV2SyncController(store, { connect: async () => {}, upload, subscribe: receive => { listener = receive; return () => {}; } });
  const running = controller.start(); await began;
  const current = store.versionedNode('a')!;
  await expect(Promise.resolve(listener({ ...current, revision: 100, lastOpId: 'remote:100', lastDeviceId: 'remote',
    value: { ...current.value, routineOutcomes: { [key]: { state: 'missed', changedAt: now.toISOString(), version: 100 } } } }))).rejects.toThrow(/未承認/);
  release(); await running;
  expect(upload).toHaveBeenCalledTimes(1); expect(store.outbox).toEqual(original.slice(1));
  expect(memo(store.nodes).routineOutcomes?.[key].state).toBe('missed');
  expect(controller.state).toMatchObject({ phase: 'error', pendingCount: 1 });
});

it('R145: localOnly retains isolated results and operations without connecting, and resume never opens the network', async () => {
  const p = await IndexedDbTaskMemoApplicationJournal.open('synthetic-local-only', new IDBFactory());
  const store = await TaskMemoV2ApplicationStore.open(p, seed(), { deviceId: 'a', now: () => now, isolatedRoutineResults: true });
  await store.command('未達', 'update', n => set(n, 'missed'));
  const original = await p.loadCommitted(), connect = vi.fn(), upload = vi.fn();
  const controller = new TaskMemoV2SyncController(store, { connect, upload }, undefined, { localOnly: true });
  await controller.start(); await controller.flush(); await controller.resume();
  expect(controller.state.phase).toBe('offline');
  expect(connect).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  expect(await p.loadCommitted()).toBe(original); expect(store.outbox).toHaveLength(1);
});

it.each((['pinned', 'features'] as const).flatMap(kind =>
  (['node-first', 'profile-first'] as const).flatMap(order => [false, true].map(duplicate => ({ kind, order, duplicate }))))
)('R145-2: $kind $order duplicate=$duplicate cannot clear protection', async ({ kind, order, duplicate }) => {
  const p = await IndexedDbTaskMemoApplicationJournal.open('synthetic-profile-race', new IDBFactory());
  const store = await TaskMemoV2ApplicationStore.open(p, seed(), { deviceId: 'a', now: () => now });
  let receiveNode!: Parameters<NonNullable<SyncAdapter['subscribe']>>[0], receiveProfile!: () => void | Promise<void>;
  let reportError!: (error: unknown) => void;
  const upload = vi.fn();
  const stamp = { revision: 1, lastOpId: 'profile:1', lastDeviceId: 'profile', lastLocalSeq: 1 };
  const controller = new TaskMemoV2SyncController(store, { connect: async () => {}, upload,
    subscribe: (onRecord, onError) => { receiveNode = onRecord; reportError = onError; return () => {}; },
    subscribePinnedNote: onRecord => { if (kind === 'pinned') receiveProfile = () => onRecord({ ...stamp, value: { body: 'synthetic' } }); return () => {}; },
    subscribeFeatures: onRecord => { if (kind === 'features') receiveProfile = () => onRecord({ ...stamp, value: { ideasEnabled: true } }); return () => {}; },
  });
  await controller.start();
  const current = store.versionedNode('a')!;
  const record = { ...current, revision: 100, lastOpId: 'remote:100', lastDeviceId: 'remote',
    value: { ...current.value, routineOutcomes: { [key]: { state: 'missed', changedAt: now.toISOString(), version: 100 } } } };
  const notifications: Promise<unknown>[] = [];
  const profileNotifications: Promise<void>[] = [];
  const node = () => notifications.push(Promise.resolve(receiveNode(record)));
  const profile = () => { const promise = Promise.resolve(receiveProfile()); profileNotifications.push(promise); notifications.push(promise); };
  const first = order === 'node-first' ? node : profile, second = order === 'node-first' ? profile : node;
  first(); second(); if (duplicate) { second(); first(); }
  await Promise.allSettled(notifications);
  expect((await Promise.allSettled(profileNotifications)).every(result => result.status === 'fulfilled')).toBe(true);
  expect(controller.state).toMatchObject({ phase: 'error', pendingCount: 0 });
  expect(controller.state.lastError).toMatch(/未承認/);
  reportError({ kind: 'offline', message: 'stale subscription error' });
  controller.pause('ownership');
  expect(controller.state.phase).toBe('error');
  await expect(controller.resume()).rejects.toMatchObject({ kind: 'permanent' });
  expect(upload).not.toHaveBeenCalled(); expect(store.outbox).toEqual([]);
  const envelope = JSON.parse((await p.loadCommitted())!);
  expect(envelope.domain.a.value.routineOutcomes[key].state).toBe('missed');
  if (kind === 'pinned') expect(envelope.profile.pinnedNote.synced.value.body).toBe('synthetic');
  else expect(envelope.profile.features.localIdeasEnabled).toBe(true);
  // A later valid server cancellation is not authority to unlock this controller.
  await store.receive({ ...record, revision: 101, lastOpId: 'remote:101', lastLocalSeq: 101,
    value: { ...record.value, routineOutcomes: { [key]: { state: 'pending', changedAt: now.toISOString(), version: 101 } } } });
  expect(store.restrictedRoutineResults).toBe(false);
  expect(controller.state.phase).toBe('error');
  await expect(controller.resume()).rejects.toMatchObject({ kind: 'permanent' });
});
