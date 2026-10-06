import { describe, expect, it } from 'vitest';
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';
import { TaskMemoV2SyncController } from './taskMemoV2SyncController';
import { InMemoryRevisionServer } from './revisionModel';
import type { ApplicationJournalPersistence } from './applicationStore';
import type { AnonymousSnapshot } from './ownershipReconcile';
import type { SyncAdapter, SyncOperation, VersionedNode } from './types';
class Memory implements ApplicationJournalPersistence {
  value: string | null = null; journal: string | null = null; fail = false;
  loadCommitted = async () => this.value; loadJournal = async () => this.journal;
  writeCommitted = async (value: string) => { this.value = value; }; writeJournal = async (value: string) => { this.journal = value; };
  clearJournal = async () => { this.journal = null; };
  writeAtomic = async (expected: string | null, value: string) => { if (this.fail || this.value !== expected) throw new Error('atomic failure'); this.value = value; };
}
const value = (id = 'a') => ({ id, type: 'category', title: id, parentId: null, sortKey: id === 'b' ? 'a1' : 'a0', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', deletedAt: null });
const source: AnonymousSnapshot = { scope: 'anonymous', nodes: { a: value() }, profile: { body: '', ideasEnabled: false } };
const versioned = (id = 'remote'): VersionedNode => ({ value: value(id), revision: 10, lastOpId: 'remote:10', lastDeviceId: 'remote', lastLocalSeq: 10, operationType: 'update' });
class Adapter implements SyncAdapter {
  server = new InMemoryRevisionServer(); records: VersionedNode[] = []; uploads: SyncOperation[] = [];
  reads = 0; failUpload = false;
  connect = async () => {};
  auditOutbox = async (ops: SyncOperation[]) => ({ received: 0, missing: ops.length });
  readRecoverySnapshot = async () => { this.reads++; return { nodes: this.records, receiptDocumentCount: this.server.processedOperationCount,
    pinnedNote: this.server.getPinnedNote(), features: this.server.getFeatures() }; };
  upload = async (op: SyncOperation) => { if (this.failUpload) throw { kind: 'temporary', message: '通信を確認してください。' };
    this.uploads.push(op); const ack = this.server.apply(op); if (ack.record) this.records = [...this.records.filter(r => r.value.id !== op.targetNodeId), ack.record]; return ack; };
}
const open = (p: Memory) => TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'account' });
const controller = (store: TaskMemoV2ApplicationStore, adapter: Adapter, snapshot = source, scope = 'accountA') =>
  new TaskMemoV2SyncController(store, adapter, () => {}, { initialOwnership: { source: () => snapshot, targetScope: scope } });
describe('initial anonymous adoption uses verified state, not signup identity', () => {
  it('manual review pause is not presented as a simulated network error', async () => {
    const sync = controller(await open(new Memory()), new Adapter()); await sync.start();
    sync.pause('ownership'); await sync.flush(); expect(sync.state.lastError).toBeNull(); expect(sync.state.phase).toBe('synced');
  });
  it.each(['deletedAt', 'purgedAt', 'routineOccurrenceKey', 'routineSourceId'])('requires review for ambiguous source metadata %s', async field => {
    const store = await open(new Memory()), adapter = new Adapter();
    const snapshot = { ...source, nodes: { a: { ...source.nodes.a, [field]: '2026-10-03' } } };
    const sync = controller(store, adapter, snapshot); await sync.start();
    expect(adapter.uploads).toEqual([]); expect(store.nodes).toEqual([]); sync.stop();
  });
  it('does not treat profile-only Cloud or previous receipt history as empty', async () => {
    for (const field of ['pinnedNote', 'features', 'receiptDocumentCount'] as const) {
      const store = await open(new Memory()), adapter = new Adapter(); const read = adapter.readRecoverySnapshot;
      adapter.readRecoverySnapshot = async () => ({ ...await read(), [field]: field === 'receiptDocumentCount' ? 1 : { revision: 1, value: {} } });
      const sync = controller(store, adapter); await sync.start();
      expect(adapter.uploads).toEqual([]); expect(store.nodes).toEqual([]); sync.stop();
    }
  });
  it('does not adopt a source changed while the server confirmation is pending', async () => {
    const store = await open(new Memory()), adapter = new Adapter(); let snapshot = source; const read = adapter.readRecoverySnapshot;
    adapter.readRecoverySnapshot = async () => { if (adapter.reads) snapshot = { ...source, nodes: { a: { ...source.nodes.a, title: 'Concurrent' } } }; return read(); };
    const sync = new TaskMemoV2SyncController(store, adapter, () => {}, { initialOwnership: { source: () => snapshot, targetScope: 'accountA' } });
    await sync.start(); expect(adapter.uploads).toEqual([]); expect(store.nodes).toEqual([]); sync.stop();
  });
  it('respects an Account-only decision and requires confirmation for later anonymous edits', async () => {
    const store = await open(new Memory()), adapter = new Adapter();
    await store.skipOwnership(source, 'accountA');
    const changed = { ...source, nodes: { a: { ...source.nodes.a, title: 'Later' } } };
    const sync = controller(store, adapter, changed); await sync.start();
    expect(adapter.uploads).toEqual([]); expect(store.nodes).toEqual([]); sync.stop();
  });
  it('automatically adopts into an empty account using new account commands and one History', async () => {
    const p = new Memory(), store = await open(p), adapter = new Adapter(); const sync = controller(store, adapter);
    await sync.start();
    expect(adapter.uploads).toHaveLength(1); expect(adapter.uploads[0].deviceId).toBe('account');
    expect(adapter.uploads[0].ownership?.expectedCurrent).toBeNull();
    expect(store.nodes[0]?.id).toBe('a'); expect(store.historyDepths.past).toBe(1);
    expect(store.unreconciledIds(source, 'accountA')).toEqual([]); expect(sync.state.phase).toBe('synced');
    sync.stop(); const restarted = controller(await open(p), adapter); await restarted.start();
    expect(adapter.uploads).toHaveLength(1); restarted.stop();
  });
  it('automatically adopts the single profile-only anonymous change reported by signup', async () => {
    const store = await open(new Memory()), adapter = new Adapter();
    const snapshot = { ...source, nodes: {}, profile: { body: '', ideasEnabled: true } };
    const sync = controller(store, adapter, snapshot); await sync.start();
    expect(adapter.uploads).toHaveLength(1); expect(adapter.uploads[0].targetType).toBe('features');
    expect(store.ideasEnabled).toBe(true); expect(store.unreconciledIds(snapshot, 'accountA')).toEqual([]); sync.stop();
  });
  it('retains review for non-empty cloud and detects a change between initial reads', async () => {
    for (const race of [false, true]) {
      const store = await open(new Memory()), adapter = new Adapter();
      if (!race) adapter.records = [versioned()];
      else { const read = adapter.readRecoverySnapshot; adapter.readRecoverySnapshot = async () => { if (adapter.reads) adapter.records = [versioned()]; return read(); }; }
      const sync = controller(store, adapter); await sync.start();
      expect(adapter.uploads).toEqual([]); expect(store.nodes).toEqual([]);
      expect(store.unreconciledIds(source, 'accountA')).toEqual(['a']); expect(sync.state.phase).toBe('synced'); sync.stop();
    }
  });
  it('never adopts without compatibility/connect permission and preserves the actual error message', async () => {
    const store = await open(new Memory()), adapter = new Adapter();
    adapter.connect = async () => { throw { kind: 'permanent', message: '同期compatibility gateがありません。安全のため同期を停止しました。' }; };
    const sync = controller(store, adapter); await sync.start();
    expect(sync.state.lastError).toContain('compatibility gate'); expect(adapter.reads).toBe(0);
    expect(store.nodes).toEqual([]); expect(adapter.uploads).toEqual([]); sync.stop();
  });
  it('retains durable initial import on response loss, and restart does not duplicate it', async () => {
    const p = new Memory(), store = await open(p), adapter = new Adapter(); const upload = adapter.upload;
    adapter.upload = async op => { await upload(op); throw { kind: 'temporary', message: 'response lost' }; };
    const sync = controller(store, adapter); await sync.start(); sync.stop();
    expect(store.pendingOwnership).toBeDefined(); expect(store.historyDepths.past).toBe(0);
    const restarted = await open(p); expect(restarted.pendingOwnership).toBeDefined();
    const plan = await restarted.reconfirmOwnership(Object.fromEntries(adapter.records.map(r => [r.value.id, r])), { pinnedNote: null, features: null }, [adapter.uploads[0].opId]);
    await restarted.commitOwnership(plan, {});
    expect(adapter.server.processedOperationCount).toBe(1); expect(restarted.historyDepths.past).toBe(1);
  });
  it('failed atomic save preserves source and account and allows retry', async () => {
    const p = new Memory(), store = await open(p), adapter = new Adapter(); p.fail = true;
    const sync = controller(store, adapter); await sync.start();
    expect(store.nodes).toEqual([]); expect(adapter.uploads).toEqual([]); expect(p.journal).toBeNull(); sync.stop();
    p.fail = false; const retry = controller(await open(p), adapter); await retry.start();
    expect(adapter.uploads).toHaveLength(1); expect(source.nodes.a).toEqual(value()); retry.stop();
  });
  it('rejects a same-ID remote change after final preflight without losing source or overwriting Cloud', async () => {
    const store = await open(new Memory()), adapter = new Adapter(); const upload = adapter.upload;
    adapter.upload = async op => {
      const { ownership: _ownership, ...ordinary } = op;
      const remote = adapter.server.apply({ ...ordinary, opId: 'remote:1', deviceId: 'remote', payload: { node: { ...source.nodes.a, title: 'Remote' } } });
      adapter.records = [remote.record!]; return upload(op);
    };
    const sync = controller(store, adapter); await sync.start();
    expect(store.pendingOwnership?.state).toBe('conflict'); expect(store.historyDepths.past).toBe(0);
    expect(adapter.records[0].value.title).toBe('Remote'); expect(source.nodes.a.title).toBe('a'); sync.stop();
  });
});
