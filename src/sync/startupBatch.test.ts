import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { IndexedDbTaskMemoApplicationJournal } from './indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';
import { TaskMemoV2SyncController } from './taskMemoV2SyncController';
import type { SyncAdapter, VersionedNode } from './types';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null } }));
let factory: IDBFactory;
beforeEach(() => { factory = new IDBFactory(); });
const record = (id: string, revision = 1): VersionedNode => ({ value: { id, type: 'memo', memoType: 'task', parentId: null,
  sortKey: 'a0', title: id, body: '', status: 'active', completedAt: null, deletedAt: null, dueAt: null, duePreset: 'none',
  createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z' },
revision, lastOpId: `server:${id}:${revision}`, lastDeviceId: 'server', lastLocalSeq: revision, operationType: 'update' });
async function setup(scope = 'synthetic-startup') {
  const persistence = await IndexedDbTaskMemoApplicationJournal.open(scope, factory);
  const store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'startup-device', now: () => new Date('2026-11-04T00:00:00Z') });
  return { persistence, store };
}

it('persists an initial snapshot once, preserves Undo, and skips exact replays even outside the seen window', async () => {
  const { persistence, store } = await setup();
  const atomic = vi.spyOn(persistence, 'writeAtomic');
  const records = Array.from({ length: 600 }, (_, i) => record(`memo-${i}`));
  await store.receiveBatch(records);
  expect(atomic).toHaveBeenCalledTimes(1);
  expect(store.nodes).toHaveLength(600); expect(store.outbox).toEqual([]);
  expect(store.historyDepths).toEqual({ past: 0, future: 0 });
  const raw = await persistence.loadCommitted();
  atomic.mockClear();
  await store.receiveBatch(records);
  expect(atomic).not.toHaveBeenCalled(); expect(await persistence.loadCommitted()).toBe(raw);
  await store.receive(records[0]);
  expect(atomic).not.toHaveBeenCalled();
  await store.receiveBatch([record('memo-0', 2)]);
  expect(atomic).toHaveBeenCalledOnce(); expect(store.versionedNode('memo-0')!.revision).toBe(2);
});

it('does not suppress matching Outbox acknowledgement or subsequent Undo/Redo', async () => {
  const { persistence, store } = await setup(); await store.receive(record('memo'));
  await store.command('edit', 'update', nodes => nodes.map(node => ({ ...node, title: 'local edit' })));
  const pending = store.outbox[0], echo = store.versionedNode('memo')!;
  const atomic = vi.spyOn(persistence, 'writeAtomic');
  await store.receiveBatch([echo]);
  expect(atomic).toHaveBeenCalledOnce(); expect(store.outbox).toEqual([]);
  expect(store.historyDepths.past).toBe(1);
  expect(JSON.parse((await persistence.loadCommitted())!).sync.outbox).toEqual([]);
  expect(pending.opId).toBe(echo.lastOpId);
  await store.undo(); expect(store.nodes[0].title).toBe('memo');
  await store.redo(); expect(store.nodes[0].title).toBe('local edit');
});

it('merges same-revision Routine outcomes and retains tombstones and unknown fields in a batch', async () => {
  const { store } = await setup();
  const original = record('routine'); original.value.routineOutcomes = { '2026-11-03': { state: 'completed', version: 1, changedAt: '2026-11-03T00:00:00Z' } };
  await store.receive(original);
  const incoming = { ...original, value: { ...original.value, routineOutcomes: { '2026-11-03': { state: 'skipped', version: 2, changedAt: '2026-11-04T00:00:00Z' } } } };
  // The op ID alone is insufficient to identify a no-op outside the old seen guard.
  const raw = JSON.parse(JSON.stringify(original)) as VersionedNode;
  raw.lastOpId = 'server:other';
  incoming.lastOpId = 'server:other';
  const deleted = record('deleted', 3); deleted.value.deletedAt = '2026-11-04T00:00:00Z'; deleted.value.extra = { retained: true };
  await store.receiveBatch([raw, incoming, deleted, record('deleted', 1)]);
  expect(store.versionedNode('routine')!.value.routineOutcomes).toMatchObject({ '2026-11-03': { state: 'skipped', version: 2 } });
  expect(store.versionedNode('deleted')!.value).toMatchObject({ deletedAt: '2026-11-04T00:00:00Z', extra: { retained: true } });
});

it('rolls back an aborted batch and stops all uploads from the protected writer', async () => {
  const { persistence, store } = await setup(); const before = await persistence.loadCommitted();
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    const request = put.apply(this, args); request.addEventListener('success', () => this.transaction.abort()); return request;
  });
  try { await expect(store.receiveBatch([record('a'), record('b')])).rejects.toThrow(); }
  finally { spy.mockRestore(); }
  expect(await persistence.loadCommitted()).toBe(before); expect(store.nodes).toEqual([]);
  expect(store.protectionError).not.toBeNull();
  const adapter: SyncAdapter = { connect: vi.fn(), upload: vi.fn() };
  await new TaskMemoV2SyncController(store, adapter).start();
  expect(adapter.connect).not.toHaveBeenCalled(); expect(adapter.upload).not.toHaveBeenCalled();
});

it('rejects a stale writer instead of replacing a concurrently committed envelope', async () => {
  const { persistence, store } = await setup();
  const other = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
  await other.receive(record('other')); const concurrent = await persistence.loadCommitted();
  await expect(store.receiveBatch([record('a'), record('b')])).rejects.toThrow();
  expect(await persistence.loadCommitted()).toBe(concurrent); expect(store.nodes).toEqual([]);
});

it('serializes a queued local command after the whole batch and preserves both results', async () => {
  const { persistence, store } = await setup();
  const b = record('b'); b.value.sortKey = 'a1';
  const receiving = store.receiveBatch([record('a'), b]);
  const editing = store.command('edit', 'update', nodes => nodes.map(node => node.id === 'a' ? { ...node, title: 'edited' } : node));
  await Promise.all([receiving, editing]);
  const saved = JSON.parse((await persistence.loadCommitted())!);
  expect(saved.domain.a.value.title).toBe('edited'); expect(saved.domain.b.value.title).toBe('b');
  expect(saved.sync.outbox).toHaveLength(1); expect(saved.history.past).toHaveLength(1);
});

it('produces the same durable Domain, History, profile, sequence and Outbox as ordered scalar delivery', async () => {
  const scalar = await setup('scalar'), batch = await setup('batch');
  const first = record('a'), second = record('b'); second.value.sortKey = 'a1';
  for (const { store } of [scalar, batch]) {
    await store.receiveBatch([first, second]);
    await store.command('local edit', 'update', nodes => nodes.map(n => n.id === 'a' ? { ...n, title: 'local' } : n));
  }
  const echo = scalar.store.versionedNode('a')!;
  const remote = record('b', 5); remote.value.sortKey = 'a1'; remote.value.extra = { retain: ['unknown'] };
  const records = [echo, remote, second, record('new')];
  for (const value of records) await scalar.store.receive(value);
  const writes = vi.spyOn(batch.persistence, 'writeAtomic'); await batch.store.receiveBatch(records);
  expect(writes).toHaveBeenCalledOnce();
  expect(JSON.parse((await batch.persistence.loadCommitted())!)).toEqual(JSON.parse((await scalar.persistence.loadCommitted())!));
});

it('does not republish identical batches/metadata and ignores a stopped generation', async () => {
  const { store } = await setup(); const original = record('a'); await store.receive(original);
  let batch!: NonNullable<Parameters<NonNullable<SyncAdapter['subscribe']>>[3]>;
  let applied!: NonNullable<Parameters<NonNullable<SyncAdapter['subscribe']>>[2]>;
  const changed = vi.fn();
  const controller = new TaskMemoV2SyncController(store, { connect: async () => {}, upload: vi.fn(),
    subscribe: (_receive, _error, onApplied, onRecords) => { batch = onRecords!; applied = onApplied!; return () => {}; } }, changed);
  await controller.start(); applied('server'); changed.mockClear();
  await batch([original]); applied('server');
  expect(changed).not.toHaveBeenCalled();
  controller.stop(); await batch([record('a', 9)]); applied('server');
  expect(store.versionedNode('a')!.revision).toBe(1); expect(controller.snapshotSource).toBe('checking');
});

it('does not silently deduplicate an unrelated malformed Outbox while receiving a batch', async () => {
  const { persistence, store } = await setup(); await store.receive(record('a'));
  await store.command('edit', 'update', nodes => nodes.map(n => ({ ...n, title: 'local' })));
  const raw = (await persistence.loadCommitted())!, envelope = JSON.parse(raw);
  envelope.sync.outbox.push(envelope.sync.outbox[0]);
  await persistence.writeAtomic(raw, JSON.stringify(envelope));
  const reopened = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
  await reopened.receiveBatch([record('remote')]);
  // The normal adapter's receipt audit must reject this; reception must not repair it by data loss.
  expect(reopened.outbox).toHaveLength(2);
  expect(JSON.parse((await persistence.loadCommitted())!).sync.outbox).toEqual(envelope.sync.outbox);
});
