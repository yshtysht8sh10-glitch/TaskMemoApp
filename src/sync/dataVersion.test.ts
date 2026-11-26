import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTaskMemoApplicationJournal } from './indexedDbApplicationStorage';
import { prepareVersion3Copy, assertVersion3Baseline } from './dataVersion';
import { createNode } from '../domain/nodeOperations';
import { TaskMemoV2SyncController } from './taskMemoV2SyncController';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';
import { validateCompatibilityGate } from './compatibilityGate';
import { serializeNodeBackup, parseNodeBackup } from '../services/nodeBackup';
it('allows only known server data versions', () => {
  expect(validateCompatibilityGate({ schemaVersion: 1, minimumSyncProtocol: 3, v1WritesAllowed: false, v2Enabled: true }).minimumSyncProtocol).toBe(3);
  expect(() => validateCompatibilityGate({ schemaVersion: 1, minimumSyncProtocol: 4, v1WritesAllowed: false, v2Enabled: true })).toThrow();
});
it('copies a verified quiescent snapshot once into a separate scope and forbids downgrade', async () => {
  const factory = new IDBFactory(), source = await IndexedDbTaskMemoApplicationJournal.open('test/u', factory);
  await TaskMemoV2ApplicationStore.open(source, [], { deviceId: 'original' });
  const settled = JSON.parse((await source.loadCommitted())!);
  settled.profile.pinnedNote.migrationPending = false; settled.profile.features.migrationPending = false;
  await source.writeAtomic((await source.loadCommitted())!, JSON.stringify(settled));
  const before = await source.loadCommitted(), baseline = { nodes: [] };
  const destination = await IndexedDbTaskMemoApplicationJournal.openVersion3('test/u', baseline, factory);
  const raw = await destination.loadCommitted();
  expect(JSON.parse(raw!).dataVersion).toBe(3); expect(await source.loadCommitted()).toBe(before);
  expect((await TaskMemoV2ApplicationStore.open(destination, [], { deviceId: 'ignored', dataVersion: 3 })).deviceId).toBe('original');
  await expect(source.assertNoVersion3Sibling()).rejects.toThrow(/Ver3/);
  const reopened = await IndexedDbTaskMemoApplicationJournal.openVersion3('test/u', { nodes: [] }, factory);
  expect(await reopened.loadCommitted()).toBe(raw);
  await expect(TaskMemoV2ApplicationStore.open(destination, [], { deviceId: 'old', dataVersion: 2 })).rejects.toThrow(/Ver/);
});
it.each(['outbox', 'journal', 'cloud'])('does not copy or discard unresolved %s', kind => {
  const raw = JSON.stringify({ version: 2, domain: {}, profile: {}, sync: { outbox: kind === 'outbox' ? [{ opId: 'keep' }] : [] } });
  if (kind === 'cloud') expect(() => assertVersion3Baseline(raw, { nodes: [{ value: { id: 'other' } } as never] })).toThrow();
  else expect(() => prepareVersion3Copy(raw, kind === 'journal' ? raw : null)).toThrow();
});
it.each(['body', 'features'])('baseline rejects local-only %s even if the cached synced profile matches', kind => {
  const raw = JSON.stringify({ domain: {}, profile: { pinnedNote: { synced: null, localBody: kind === 'body' ? 'keep' : '' }, features: { synced: null, localIdeasEnabled: kind === 'features' } } });
  expect(() => assertVersion3Baseline(raw, { nodes: [] })).toThrow();
});
it('unknown local data version stops before writing or clearing Journal', async () => {
  const raw = JSON.stringify({ version: 2, dataVersion: 99 }); let writes = 0;
  await expect(TaskMemoV2ApplicationStore.open({ loadCommitted: async () => raw, loadJournal: async () => raw,
    writeCommitted: async () => { writes++; }, writeJournal: async () => { writes++; }, clearJournal: async () => { writes++; } }, [], { deviceId: 'test' })).rejects.toThrow();
  expect(writes).toBe(0);
});
it('normal backup carries a version older apps cannot accept and rejects unknown data versions', () => {
  const raw = serializeNodeBackup([]), data = JSON.parse(raw);
  expect(data.schemaVersion).toBe(5); expect(data.dataVersion).toBe(3);
  expect(parseNodeBackup(raw)).toEqual([]);
  expect(() => parseNodeBackup(JSON.stringify({ ...data, dataVersion: 99 }))).toThrow();
});
it.each(['before-command', 'before-CAS'])('revoked version permission %s cannot save or retire pending operations', async stage => {
  let raw: string | null = null, journal: string | null = null, allowed = true, revokeBeforeCAS = false, permissionChecks = 0;
  const p = { loadCommitted: async () => raw, loadJournal: async () => journal,
    writeCommitted: async (v: string) => { raw = v; }, writeJournal: async (v: string) => { journal = v; }, clearJournal: async () => { journal = null; },
    writeAtomic: async (expected: string | null, v: string) => { expect(raw).toBe(expected); raw = v; } };
  const store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'test', dataVersion: 3, writePermission: () => allowed && !(revokeBeforeCAS && ++permissionChecks >= 2) });
  const before = raw;
  permissionChecks = 0;
  if (stage === 'before-command') allowed = false; else revokeBeforeCAS = true;
  await expect(store.command('new', 'create', nodes => createNode(nodes, 'memo', { title: 'keep', parentId: null }, new Date(), 'new'))).rejects.toThrow(/Ver/);
  expect(raw).toBe(before); expect(journal).toBeNull(); expect(store.nodes).toEqual([]); expect(store.outbox).toEqual([]);
});
it('controller hard-stop blocks direct local commands, flush and automatic re-enable', async () => {
  const p = await IndexedDbTaskMemoApplicationJournal.open('stopped', new IDBFactory());
  const store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'test', dataVersion: 3 });
  let valid = true;
  const upload = vi.fn(async (op: { opId: string }) => ({ opId: op.opId }));
  const controller = new TaskMemoV2SyncController(store, { dataVersion: 3, get dataVersionValid() { return valid; }, connect: async () => {}, upload });
  await controller.start(); upload.mockClear(); valid = false;
  const raw = await p.loadCommitted();
  await expect(controller.commandLocal('new', 'create', nodes => createNode(nodes, 'memo', { title: 'keep', parentId: null }, new Date(), 'new'))).rejects.toThrow(/Ver/);
  await expect(controller.flush()).rejects.toThrow(/Ver/); valid = true;
  await expect(controller.start()).rejects.toThrow(/Ver/);
  expect(await p.loadCommitted()).toBe(raw); expect(upload).not.toHaveBeenCalled(); controller.stop();
});
