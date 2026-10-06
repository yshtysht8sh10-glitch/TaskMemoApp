import { createNode } from '../domain/nodeOperations';
import { initialRoutineFrequency, routineRuleForSave } from '../utils/routineEditor';
import { repeatRuleLabel } from '../domain/routine';
import { nodeFromV2Value, nodeToV2Value } from './nodeV2Codec';
import { migrateLocalApplication } from './localApplication';
import { serializeText } from '../textFormat/session';
import { TaskMemoV2SyncController } from './taskMemoV2SyncController';
import { applyRevisionOperation, candidateForOperation, InMemoryRevisionServer } from './revisionModel';
import { newRoutineRoot } from '../domain/routineRoot';
import type { SyncAdapter, SyncNodeValue, VersionedNode } from './types';
import { expect, it, vi } from 'vitest';
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';
import type { ApplicationJournalPersistence } from './applicationStore';
class Memory implements ApplicationJournalPersistence {
  value: string | null = null; fail = false;
  loadCommitted = async () => this.value; loadJournal = async () => null;
  writeJournal = async () => {}; clearJournal = async () => {};
  writeCommitted = async (value: string) => { this.value = value; };
  writeAtomic = async (expected: string | null, value: string) => {
    if (this.fail || expected !== this.value) throw new Error('atomic'); this.value = value;
  };
}
it('prepares one persistent system root with no user History and one ordinary Outbox create', async () => {
  const persistence = new Memory();
  const store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'local' });
  await Promise.all([store.ensureRoutineRoot(), store.ensureRoutineRoot()]);
  expect(store.nodes).toHaveLength(1);
  expect(store.nodes[0]).toMatchObject({ id: 'system-routine', type: 'category', categoryKind: 'routineRoot', parentId: null });
  expect(store.outbox).toHaveLength(1); expect(store.outbox[0].type).toBe('create');
  expect(store.historyDepths).toEqual({ past: 0, future: 0 });
  await store.undo(); expect(store.nodes[0].deletedAt).toBeNull();
  const reopened = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
  await reopened.ensureRoutineRoot(); expect(reopened.outbox).toHaveLength(1);
});

const date = new Date('2026-10-06T00:00:00.000Z');
const root = (patch: Partial<SyncNodeValue> = {}) => ({ ...newRoutineRoot([], date), ...patch });
const record = (value: SyncNodeValue): VersionedNode => ({ value, revision: 7, lastOpId: 'remote:7', lastDeviceId: 'remote', lastLocalSeq: 7, operationType: 'create' });
it.each(['day', 'week', 'month', 'year'] as const)('ordinary editor %s rule survives Application, V2 codec, restart and no-edit Text save', async frequency => {
  const p = new Memory();
  let store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'local' });
  const parentId = await store.ensureRoutineRoot();
  expect(initialRoutineFrequency(null, true)).toBe('day');
  const repeatRule = routineRuleForSave(frequency, '2', '2026-10-06');
  await store.command('Routine', 'create', nodes => createNode(nodes, 'memo', {
    parentId, title: 'R', repeatRule, dueAt: date, duePreset: 'custom', memoType: 'task',
  }, date, 'routine'));
  expect(store.historyDepths.past).toBe(1);
  const value = store.versionedNode('routine')!.value;
  expect(value.repeatRule).toEqual(repeatRule);
  expect(nodeToV2Value(nodeFromV2Value(value)).repeatRule).toEqual(repeatRule);
  store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'ignored' });
  const memo = store.nodes.find(n => n.id === 'routine')!;
  expect(memo.type === 'memo' && repeatRuleLabel(memo.repeatRule)).not.toBe('未設定');
  const session = store.beginTextEdit({ scope: 'local', view: 'tree', systemRegions: true, timeZone: 'Asia/Tokyo' });
  const plan = store.prepareTextEdit(session, serializeText(session));
  expect(plan.errors).toEqual([]); expect(plan.changes).toEqual([]);
  const before = p.value;
  await store.commitTextEdit(plan); expect(p.value).toBe(before);
  await store.undo(); await store.redo();
  expect(store.versionedNode('routine')!.value.repeatRule).toEqual(repeatRule);
  expect(store.outbox.some(o => o.targetNodeId === 'routine')).toBe(true);
  const server = new InMemoryRevisionServer();
  for (const op of [...store.outbox]) {
    const ack = server.apply(op); await store.acknowledge(op.opId, ack.record);
  }
  expect(store.outbox).toEqual([]);
  store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'ignored' });
  expect(store.versionedNode('routine')!.value.repeatRule).toEqual(repeatRule);
  const accountSession = store.beginTextEdit({ scope: 'account', view: 'tree', systemRegions: true, timeZone: 'Asia/Tokyo' });
  const accountPlan = store.prepareTextEdit(accountSession, serializeText(accountSession));
  expect(accountPlan.errors).toEqual([]); expect(accountPlan.changes).toEqual([]);
});
it('keeps existing custom-ID root, revisions and unknown metadata exactly', async () => {
  const p = new Memory(), store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'test' });
  const existing = record(root({ id: 'legacy-root', unknown: { preserved: true } }));
  await store.receive(existing); const before = p.value;
  expect(await store.ensureRoutineRoot()).toBe('legacy-root');
  expect(p.value).toBe(before); expect(store.versionedNode('legacy-root')).toEqual(existing);
});
it.each([
  [root({ deletedAt: date.toISOString() })], [root({ purgedAt: date.toISOString() })],
  [root({ parentId: 'parent' })], [root({ sortKey: 'invalid' })],
  [root(), root({ id: 'another' })], [root({ categoryKind: undefined })],
])('fails closed for unsafe root records without Domain/History/Outbox writes', async (...values) => {
  const p = new Memory(), store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'test' });
  for (const value of values) await store.receive(record(value));
  const before = p.value;
  await expect(store.ensureRoutineRoot()).rejects.toThrow(); expect(p.value).toBe(before);
});
it('atomic failure keeps the empty domain, History, Outbox and local sequence', async () => {
  const p = new Memory(), store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'test' });
  const before = p.value; p.fail = true;
  await expect(store.ensureRoutineRoot()).rejects.toThrow('atomic'); expect(p.value).toBe(before);
  expect(store.nodes).toHaveLength(0); expect(store.outbox).toHaveLength(0);
  p.fail = false; await store.ensureRoutineRoot(); expect(store.outbox[0].localSeq).toBe(1);
});
it('V1 migration preserves raw source and existing metadata while provisioning only the missing root', async () => {
  const p = new Memory(), backup = new Memory();
  const value: SyncNodeValue = { id: 'memo', type: 'memo', title: 'A', parentId: null, sortKey: 'a0', body: '', memoType: 'task', status: 'active', duePreset: 'none', dueAt: null, createdAt: date.toISOString(), updatedAt: date.toISOString(), deletedAt: null, unknown: { deep: [1] }, routineHistory: { old: null } };
  const source = JSON.stringify([value]);
  const options = { scope: 'local', source, deviceId: 'test', profile: { body: '', ideasEnabled: false }, backup };
  const store = await migrateLocalApplication(p, options), originalBackup = backup.value;
  await store.ensureRoutineRoot(); expect(store.versionedNode('memo')!.value).toEqual(value);
  expect(store.outbox.map(o => o.targetNodeId)).toEqual(['system-routine']);
  expect(backup.value).toBe(originalBackup); expect(JSON.parse(p.value!).ownership.migration.source).toBe(source);
  await (await migrateLocalApplication(p, options)).ensureRoutineRoot(); expect(backup.value).toBe(originalBackup);
});
it('normal Routine creation is one History entry and Undo/Redo retains the management area', async () => {
  const store = await TaskMemoV2ApplicationStore.open(new Memory(), [], { deviceId: 'local' });
  const parentId = await store.ensureRoutineRoot();
  await store.command('Routine task', 'create', nodes => createNode(nodes, 'memo', {
    parentId, title: 'Run', repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-06' } }, date, 'task'));
  expect(store.historyDepths.past).toBe(1);
  await store.undo(); expect(store.nodes.find(n => n.id === parentId)!.deletedAt).toBeNull();
  expect(store.nodes.find(n => n.id === 'task')!.deletedAt).toBeTruthy();
  await store.redo(); expect(store.nodes.find(n => n.id === 'task')!.deletedAt).toBeNull();
  const session = store.beginTextEdit({ scope: 'local', view: 'tree', systemRegions: true, timeZone: 'Asia/Tokyo' });
  const text = serializeText(session); expect(text).toContain('@routine');
  const plan = store.prepareTextEdit(session, text); expect(plan.errors).toEqual([]); expect(plan.changes).toEqual([]);
  const depths = store.historyDepths; await store.commitTextEdit(plan); expect(store.historyDepths).toEqual(depths);
});
it('ordinary import/delete cannot remove or retype the management area', async () => {
  const store = await TaskMemoV2ApplicationStore.open(new Memory(), [], { deviceId: 'local' });
  await store.ensureRoutineRoot();
  for (const transform of [(_nodes: import('../models/node').Node[]) => [], (nodes: import('../models/node').Node[]) => nodes.map(n => ({ ...n, deletedAt: date }))]) {
    await expect(store.command('delete', 'softDelete', transform)).rejects.toThrow('システム');
  }
  expect(store.outbox).toHaveLength(1);
});
it('concurrent system creates are insert-only and preserve the server winner metadata on acknowledgement', async () => {
  const a = await TaskMemoV2ApplicationStore.open(new Memory(), [], { deviceId: 'A' });
  const b = await TaskMemoV2ApplicationStore.open(new Memory(), [], { deviceId: 'Z' });
  await a.ensureRoutineRoot(); await b.ensureRoutineRoot();
  const winner = candidateForOperation(a.outbox[0]); winner.value.unknown = { kept: true };
  const ack = applyRevisionOperation(winner, b.outbox[0]);
  expect(ack.result).toBe('superseded'); expect(ack.record).toEqual(winner);
  await b.acknowledge(b.outbox[0].opId, ack.record); expect(b.versionedNode('system-routine')).toEqual(winner);
  expect(b.outbox).toEqual([]); expect(b.nodes).toHaveLength(1);
  expect(() => applyRevisionOperation(record(root({ type: 'memo', categoryKind: undefined })), a.outbox[0])).toThrow('予約ID');
  expect(() => applyRevisionOperation(record(root({ purgedAt: date.toISOString() })), a.outbox[0])).toThrow();
});
function adapter(nodes: VersionedNode[] = []): SyncAdapter {
  const server = new InMemoryRevisionServer();
  return { connect: async () => {}, readRecoverySnapshot: async () => ({ nodes, receiptDocumentCount: 0 }), upload: async op => server.apply(op) };
}
it('fresh Account creates only after a server snapshot and reuses a remote custom root', async () => {
  for (const remote of [[], [record(root({ id: 'remote-root' }))]]) {
    const store = await TaskMemoV2ApplicationStore.open(new Memory(), [], { deviceId: 'account' });
    const api = adapter(remote), read = vi.spyOn(api, 'readRecoverySnapshot');
    const controller = new TaskMemoV2SyncController(store, api); await controller.start();
    const id = await controller.ensureRoutineRoot();
    expect(read).toHaveBeenCalled(); expect(id).toBe(remote.length ? 'remote-root' : 'system-routine');
    await vi.waitFor(() => expect(store.outbox).toHaveLength(0));
    expect(store.nodes.filter(n => n.type === 'category')).toHaveLength(1);
    expect(store.historyDepths.past).toBe(0); controller.stop();
  }
});
it('local-only setup never calls Cloud and retains the ordinary local Outbox', async () => {
  const store = await migrateLocalApplication(new Memory(), { scope: 'local', source: null, deviceId: 'local', profile: { body: '', ideasEnabled: false } });
  const api = adapter(), connect = vi.spyOn(api, 'connect'), upload = vi.spyOn(api, 'upload');
  const controller = new TaskMemoV2SyncController(store, api, undefined, { localOnly: true });
  await controller.start(); await controller.ensureRoutineRoot();
  expect(connect).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled(); expect(store.outbox).toHaveLength(1);
});
it('snapshot failure and account switch during the read cannot create a root', async () => {
  for (const failure of ['read', 'switch']) {
    const store = await TaskMemoV2ApplicationStore.open(new Memory(), [], { deviceId: 'account' });
    const api = adapter(), controller = new TaskMemoV2SyncController(store, api); await controller.start();
    const before = store.nodes;
    api.readRecoverySnapshot = async () => { if (failure === 'switch') controller.stop(); else throw new Error('read'); return { nodes: [], receiptDocumentCount: 0 }; };
    await expect(controller.ensureRoutineRoot()).rejects.toThrow(); expect(store.nodes).toEqual(before);
    controller.stop();
  }
});

it('login adopts Local Routine data, excludes the root from Undo, and restart/re-login creates no duplicates', async () => {
  const local = await migrateLocalApplication(new Memory(), { scope: 'local', source: null, deviceId: 'local', profile: { body: '', ideasEnabled: false } });
  const parentId = await local.ensureRoutineRoot();
  await local.command('new routine', 'create', nodes => createNode(nodes, 'memo', { parentId, title: 'Run', repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-06' } }, date, 'task'));
  const source = local.anonymousSnapshot('local');
  const p = new Memory(), account = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'account' });
  const plan = account.prepareOwnership(source, 'account');
  const operations = await account.commitOwnership(plan, Object.fromEntries(plan.items.map(item => [item.id, 'local'])));
  const server = new InMemoryRevisionServer();
  for (const op of operations) { const ack = server.apply(op); await account.acknowledge(op.opId, ack.record); }
  expect(account.historyDepths.past).toBe(1);
  await account.undo(); expect(account.nodes.find(n => n.id === parentId)!.deletedAt).toBeNull();
  await account.redo();
  const restarted = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'ignored' });
  expect(await restarted.ensureRoutineRoot()).toBe(parentId);
  expect(restarted.nodes).toHaveLength(2); expect(restarted.unreconciledIds(source, 'account')).toEqual([]);
  // Another account has its own domain and cannot change the first account/local scope.
  const other = await TaskMemoV2ApplicationStore.open(new Memory(), [], { deviceId: 'other' });
  await other.ensureRoutineRoot(); expect(other.nodes).toHaveLength(1); expect(restarted.nodes).toHaveLength(2);
  expect(local.nodes).toHaveLength(2);
});
it('empty system preparation preserves an existing Redo stack', async () => {
  const store = await TaskMemoV2ApplicationStore.open(new Memory(), [], { deviceId: 'local' });
  await store.command('memo', 'create', nodes => createNode(nodes, 'memo', { parentId: null, title: 'A' }, date, 'memo'));
  await store.undo(); expect(store.historyDepths.future).toBe(1);
  await store.ensureRoutineRoot(); expect(store.historyDepths.future).toBe(1);
  await store.redo(); expect(store.nodes.find(n => n.id === 'memo')!.deletedAt).toBeNull();
});

it('does not mistake a normal Category named Routine for the system area', async () => {
  const store = await TaskMemoV2ApplicationStore.open(new Memory(), [], { deviceId: 'local' });
  const normal = root({ id: 'ordinary', title: 'Routine', categoryKind: undefined, unknown: 'kept' });
  await store.receive(record(normal)); await store.ensureRoutineRoot();
  expect(store.versionedNode('ordinary')!.value).toEqual(normal);
  expect(store.nodes.filter(n => n.type === 'category' && n.categoryKind === 'routineRoot')).toHaveLength(1);
  expect(store.outbox.map(op => op.targetNodeId)).toEqual(['system-routine']);
});
it('does not race initial ownership assessment when preparing an Account area', async () => {
  const store = await TaskMemoV2ApplicationStore.open(new Memory(), [], { deviceId: 'account' });
  const controller = new TaskMemoV2SyncController(store, adapter(), undefined,
    { initialOwnership: { source: () => ({ scope: 'local', nodes: {}, profile: { body: '', ideasEnabled: false } }), targetScope: 'account' } });
  await expect(controller.ensureRoutineRoot()).rejects.toThrow('初期取り込み');
  expect(store.nodes).toEqual([]); expect(store.outbox).toEqual([]);
});
