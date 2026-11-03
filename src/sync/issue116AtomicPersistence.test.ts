import { IDBFactory, IDBObjectStore, IDBDatabase } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { IndexedDbTaskMemoApplicationJournal } from './indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';
import type { MemoNode } from '../models/node';
import { repairRedundantJournalAtStartup } from './redundantJournalRecovery';
import type { SyncAdapter } from './types';
import { TaskMemoV2SyncController } from './taskMemoV2SyncController';

const legacy = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => legacy.get(key) ?? null,
  setItem: async (key: string, value: string) => { legacy.set(key, value); },
  removeItem: async (key: string) => { legacy.delete(key); },
} }));
const at = new Date('2026-11-03T00:00:00Z');
const memo: MemoNode = { id: 'synthetic', type: 'memo', parentId: null, sortKey: 'a0', title: 'before', body: '', dueAt: null,
  duePreset: 'none', status: 'active', completedAt: null, createdAt: at, updatedAt: at, deletedAt: null };
let factory: IDBFactory;
beforeEach(() => { factory = new IDBFactory(); legacy.clear(); });
async function setup() {
  const persistence = await IndexedDbTaskMemoApplicationJournal.open('synthetic-account', factory);
  const store = await TaskMemoV2ApplicationStore.open(persistence, [memo], { deviceId: 'synthetic-device', now: () => at });
  return { persistence, store };
}
const edit = (store: TaskMemoV2ApplicationStore) => store.command('edit', 'update', nodes => nodes.map(node => ({ ...node, title: 'after' })));

it('ordinary save uses one CAS transaction without the three-step WAL', async () => {
  const { persistence, store } = await setup();
  const atomic = vi.spyOn(persistence, 'writeAtomic');
  const journal = vi.spyOn(persistence, 'writeJournal');
  const clear = vi.spyOn(persistence, 'clearJournal');
  const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
  await edit(store);
  expect(transactions.mock.calls.filter(call => call[1] === 'readwrite')).toHaveLength(1); transactions.mockRestore();
  expect(atomic).toHaveBeenCalledTimes(1);
  expect(journal).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
  expect(await persistence.loadJournal()).toBeNull();
  expect(store.outbox).toHaveLength(1); expect(store.historyDepths.past).toBe(1);
});

it('acknowledgement removes Outbox atomically without calling legacy Journal cleanup', async () => {
  const { persistence, store } = await setup();
  const cleanup = vi.spyOn(persistence, 'clearJournal').mockRejectedValue(new Error('legacy cleanup interrupted'));
  try {
    await edit(store);
    const operation = store.outbox[0];
    await store.acknowledge(operation.opId, store.versionedNode('synthetic'));
    expect(store.outbox).toEqual([]); expect(store.historyDepths.past).toBe(1);
    expect(JSON.parse((await persistence.loadCommitted())!).sync.outbox).toEqual([]);
    expect(await persistence.loadJournal()).toBeNull(); expect(cleanup).not.toHaveBeenCalled();
  } finally { cleanup.mockRestore(); }
});

it('aborted acknowledgement keeps the durable unsent operation and protects the writer', async () => {
  const { persistence, store } = await setup(); await edit(store);
  const raw = await persistence.loadCommitted(), outbox = store.outbox;
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    const request = put.apply(this, args); request.addEventListener('success', () => this.transaction.abort()); return request;
  });
  try { await expect(store.acknowledge(outbox[0].opId, store.versionedNode('synthetic'))).rejects.toThrow(); }
  finally { spy.mockRestore(); }
  expect(store.outbox).toEqual(outbox); expect(await persistence.loadCommitted()).toBe(raw);
  expect(await persistence.loadJournal()).toBeNull(); expect(store.protectionError).not.toBeNull();
});

it.each(['before-put', 'after-put'] as const)('abort %s preserves disk, memory, profile, history and outbox', async stage => {
  const { persistence, store } = await setup();
  const original = await persistence.loadCommitted();
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    if (stage === 'before-put') throw new DOMException('synthetic quota', 'QuotaExceededError');
    const result = put.apply(this, args); this.transaction.abort(); return result;
  });
  try { await expect(edit(store)).rejects.toThrow(); } finally { failure.mockRestore(); }
  expect(await persistence.loadCommitted()).toBe(original); expect(await persistence.loadJournal()).toBeNull();
  expect(store.nodes[0].title).toBe('before'); expect(store.outbox).toEqual([]); expect(store.historyDepths.past).toBe(0);
  const reopened = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
  expect(reopened.nodes).toEqual(store.nodes);
});

it.each(['before-read', 'after-read', 'after-write-success'] as const)('interruption %s rolls back the entire save', async stage => {
  const { persistence, store } = await setup();
  const original = await persistence.loadCommitted();
  const transaction = IDBDatabase.prototype.transaction, get = IDBObjectStore.prototype.get, put = IDBObjectStore.prototype.put;
  const spy = stage === 'before-read'
    ? vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
      const tx = transaction.apply(this, args); if (tx.mode === 'readwrite') queueMicrotask(() => tx.abort()); return tx;
    })
    : stage === 'after-read'
      ? vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, ...args) {
        const request = get.apply(this, args); if (this.transaction.mode === 'readwrite') request.addEventListener('success', () => this.transaction.abort()); return request;
      })
      : vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
        const request = put.apply(this, args); request.addEventListener('success', () => this.transaction.abort()); return request;
      });
  try { await expect(edit(store)).rejects.toThrow(); } finally { spy.mockRestore(); }
  expect(await persistence.loadCommitted()).toBe(original); expect(await persistence.loadJournal()).toBeNull();
  expect(store.nodes[0].title).toBe('before'); expect(store.historyDepths.past).toBe(0); expect(store.outbox).toEqual([]);
});

it('two account stores cannot overwrite each other and the stale writer retains memory', async () => {
  const { persistence, store } = await setup();
  const other = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
  const results = await Promise.allSettled([edit(store), edit(other)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const stale = results[0].status === 'rejected' ? store : other;
  expect(stale.nodes[0].title).toBe('before'); expect(stale.outbox).toEqual([]);
  await expect(stale.setIdeasEnabled(true)).rejects.toThrow();
  expect(await persistence.loadJournal()).toBeNull();
});

it('a failed atomic save protects the writer and prevents subsequent sync until explicit reopen', async () => {
  const { persistence, store } = await setup();
  await edit(store); // Existing durable outbox must not upload after a later storage failure.
  const original = await persistence.loadCommitted();
  const failure = vi.spyOn(persistence, 'writeAtomic').mockRejectedValueOnce(new Error('synthetic abort'));
  await expect(store.setIdeasEnabled(true)).rejects.toThrow(); failure.mockRestore();
  await expect(store.setIdeasEnabled(true)).rejects.toThrow();
  const adapter = { connect: vi.fn(), upload: vi.fn() } as unknown as SyncAdapter;
  const controller = new TaskMemoV2SyncController(store, adapter);
  await controller.start(); await controller.flush();
  expect(adapter.connect).not.toHaveBeenCalled(); expect(adapter.upload).not.toHaveBeenCalled();
  expect(controller.state.phase).toBe('error');
  expect(await persistence.loadCommitted()).toBe(original);
});

it('debounced profile save failure stops sync and reports the error without an unhandled rejection', async () => {
  const { persistence, store } = await setup();
  const adapter = { connect: vi.fn(), upload: vi.fn() } as unknown as SyncAdapter;
  const controller = new TaskMemoV2SyncController(store, adapter);
  let fire!: () => void;
  const realSetTimeout = globalThis.setTimeout;
  const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
    fire = callback; const handle = realSetTimeout(() => {}, 60_000); clearTimeout(handle); return handle;
  }) as typeof setTimeout);
  try { await controller.updatePinnedNote('synthetic draft'); } finally { timer.mockRestore(); }
  const draft = await persistence.loadCommitted();
  const failure = vi.spyOn(persistence, 'writeAtomic').mockRejectedValue(new Error('synthetic profile abort'));
  try {
    fire();
    await vi.waitFor(() => expect(controller.state.phase).toBe('error'));
    expect(await persistence.loadCommitted()).toBe(draft); expect(store.pinnedNote.body).toBe('synthetic draft');
    expect(adapter.upload).not.toHaveBeenCalled();
  } finally { failure.mockRestore(); controller.stop(); }
});

it('direct IndexedDB startup refuses a pending Journal without changing either snapshot', async () => {
  const { persistence } = await setup();
  const committed = (await persistence.loadCommitted())!;
  await persistence.writeJournal(committed);
  await expect(TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' })).rejects.toThrow();
  expect(await persistence.loadCommitted()).toBe(committed); expect(await persistence.loadJournal()).toBe(committed);
});

async function redundant() {
  const { persistence } = await setup();
  const envelope = JSON.parse((await persistence.loadCommitted())!);
  envelope.profile.features.migrationPending = false;
  const raw = JSON.stringify(envelope);
  await persistence.writeCommitted(raw); await persistence.writeJournal(raw);
  const snapshot = { nodes: Object.values(envelope.domain), receiptDocumentCount: 0 };
  const adapter = { connect: vi.fn(), upload: vi.fn(), readRecoverySnapshot: vi.fn(async () => snapshot) } as unknown as SyncAdapter;
  return { persistence, raw, envelope, adapter };
}

async function scopeRecord(change?: (record: Record<string, unknown>) => Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const opening = factory.open('taskmemo-v2-local-application');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, tx = db.transaction('scopes', change ? 'readwrite' : 'readonly');
      const store = tx.objectStore('scopes'), request = store.get('synthetic-account');
      let result: Record<string, unknown>;
      request.onsuccess = () => { result = request.result; if (change) { result = change(result); store.put(result); } };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

it('startup clears only the redundant Journal after two read-only Cloud comparisons', async () => {
  const { persistence, raw, adapter } = await redundant();
  const before = await scopeRecord(record => ({ ...record, recoveryCompleted: true, authoritativeRecoveryPlan: 'synthetic old plan',
    preservedRecoveryJournal: 'synthetic archived journal', preservedRecoveryCommitted: 'synthetic archived committed',
    preservedSelfRepairCommitted: 'synthetic old self repair', unknownFutureField: { keep: ['unchanged'] } }));
  expect(await repairRedundantJournalAtStartup(persistence, adapter, 'synthetic-account')).toBe(true);
  expect(await scopeRecord()).toEqual({ ...before, journal: null });
  expect(await persistence.loadCommitted()).toBe(raw); expect(await persistence.loadJournal()).toBeNull();
  expect(adapter.readRecoverySnapshot).toHaveBeenCalledTimes(2);
  expect(adapter.connect).not.toHaveBeenCalled(); expect(adapter.upload).not.toHaveBeenCalled(); expect(legacy.size).toBe(0);
});

it('cleanup transaction abort preserves every scope field and both raw snapshots', async () => {
  const { persistence, adapter } = await redundant();
  const before = await scopeRecord();
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    const request = put.apply(this, args); request.addEventListener('success', () => this.transaction.abort()); return request;
  });
  try { await expect(repairRedundantJournalAtStartup(persistence, adapter, 'synthetic-account')).rejects.toThrow(); }
  finally { spy.mockRestore(); }
  expect(await scopeRecord()).toEqual(before);
});

it.each(['cloud-unstable', 'identity-changed', 'archive-changed', 'legacy-changed', 'corrupt-json', 'corrupt-node', 'duplicate-sortKey'])(
  'startup refuses %s without overwriting evidence', async condition => {
    const { persistence, raw, adapter, envelope } = await redundant();
    let current = true, reads = 0;
    if (condition === 'corrupt-json') { await persistence.writeCommitted('{'); await persistence.writeJournal('{'); }
    if (condition === 'corrupt-node') {
      envelope.domain.synthetic.value.body = 42;
      await persistence.writeCommitted(JSON.stringify(envelope)); await persistence.writeJournal(JSON.stringify(envelope));
    }
    if (condition === 'duplicate-sortKey') {
      envelope.domain.second = { ...envelope.domain.synthetic, value: { ...envelope.domain.synthetic.value, id: 'second' } };
      await persistence.writeCommitted(JSON.stringify(envelope)); await persistence.writeJournal(JSON.stringify(envelope));
    }
    vi.mocked(adapter.readRecoverySnapshot!).mockImplementation(async () => {
      reads++;
      if (condition === 'identity-changed') current = false;
      if (condition === 'archive-changed') await scopeRecord(record => ({ ...record, preservedRecoveryJournal: 'concurrent archive' }));
      if (condition === 'legacy-changed') legacy.set('@taskmemo/sync-v2/taskmemo-application/v2/synthetic-account', raw);
      return { nodes: Object.values(envelope.domain), receiptDocumentCount: condition === 'cloud-unstable' ? reads : 0 };
    });
    const committed = await persistence.loadCommitted(), journal = await persistence.loadJournal();
    await expect(repairRedundantJournalAtStartup(persistence, adapter, 'synthetic-account', () => current)).rejects.toThrow();
    expect(await persistence.loadCommitted()).toBe(committed); expect(await persistence.loadJournal()).toBe(journal);
    if (condition === 'archive-changed') expect((await scopeRecord()).preservedRecoveryJournal).toBe('concurrent archive');
    expect(adapter.connect).not.toHaveBeenCalled(); expect(adapter.upload).not.toHaveBeenCalled();
  });

it('no Journal starts no Cloud inspection or readwrite transaction', async () => {
  const { persistence } = await setup();
  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
  const adapter = { readRecoverySnapshot: vi.fn() } as unknown as SyncAdapter;
  expect(await repairRedundantJournalAtStartup(persistence, adapter, 'synthetic-account')).toBe(false);
  expect(adapter.readRecoverySnapshot).not.toHaveBeenCalled();
  expect(transaction.mock.calls.every(call => call[1] === 'readonly')).toBe(true); transaction.mockRestore();
});

it.each(['raw-mismatch', 'outbox', 'profile', 'sequence', 'structure', 'cloud-mismatch', 'offline', 'scope', 'concurrent'])(
  'startup protects originals on %s', async condition => {
    const { persistence, raw, envelope, adapter } = await redundant();
    if (condition === 'outbox') envelope.sync.outbox.push({ opId: 'synthetic:1' });
    if (condition === 'profile') envelope.profile.pinnedNote.dirtySince = at.toISOString();
    if (condition === 'sequence') envelope.nextLocalSeq = -1;
    if (condition === 'structure') envelope.domain.synthetic.value.parentId = 'absent';
    if (['outbox', 'profile', 'sequence', 'structure'].includes(condition)) {
      await persistence.writeCommitted(JSON.stringify(envelope)); await persistence.writeJournal(JSON.stringify(envelope));
    }
    if (condition === 'raw-mismatch') await persistence.writeJournal(raw + ' ');
    if (condition === 'cloud-mismatch') vi.mocked(adapter.readRecoverySnapshot!).mockResolvedValue({ nodes: [], receiptDocumentCount: 0 });
    if (condition === 'offline') vi.mocked(adapter.readRecoverySnapshot!).mockRejectedValue(new Error('offline'));
    if (condition === 'concurrent') vi.mocked(adapter.readRecoverySnapshot!).mockImplementation(async () => {
      await persistence.writeJournal(raw + ' '); return { nodes: Object.values(envelope.domain), receiptDocumentCount: 0 };
    });
    const committed = await persistence.loadCommitted(), journal = await persistence.loadJournal();
    await expect(repairRedundantJournalAtStartup(persistence, adapter, condition === 'scope' ? 'other' : 'synthetic-account')).rejects.toThrow();
    expect(await persistence.loadCommitted()).toBe(committed);
    expect(await persistence.loadJournal()).toBe(condition === 'concurrent' ? raw + ' ' : journal);
    expect(adapter.connect).not.toHaveBeenCalled(); expect(adapter.upload).not.toHaveBeenCalled();
  });
