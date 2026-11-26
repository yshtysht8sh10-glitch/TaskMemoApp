import { readFileSync } from 'node:fs';
import { versionedScope } from './dataVersion';
import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTaskMemoApplicationJournal as Journal } from './indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore as Store } from './taskMemoApplicationStore';
import { repairRedundantJournalAtStartup } from './redundantJournalRecovery';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
async function setup() {
  const factory = new IDBFactory(), baseScope = 'synthetic-project/synthetic-owner';
  const source = await Journal.open(baseScope, factory);
  await Store.open(source, [], { deviceId: 'synthetic-device' });
  const settled = JSON.parse((await source.loadCommitted())!);
  settled.profile.pinnedNote.migrationPending = false;
  settled.profile.features.migrationPending = false;
  await source.writeAtomic((await source.loadCommitted())!, JSON.stringify(settled));
  const destination = await Journal.openVersion3(baseScope, { nodes: [] }, factory);
  return { factory, baseScope, source, destination };
}
it.each(['first-copy', 'restart'])('normal Ver3 %s must pass the actual Production startup helper with no Journal', async phase => {
  const { factory, baseScope, source, destination } = await setup();
  const persistence = phase === 'restart' ? await Journal.openVersion3(baseScope, { nodes: [] }, factory) : destination;
  const sourceRaw = await source.loadCommitted(), destinationRaw = await persistence.loadCommitted();
  expect(JSON.parse(destinationRaw!).dataVersion).toBe(3);
  expect(await persistence.loadJournal()).toBeNull();
  const readRecoverySnapshot = vi.fn(async () => { throw Error('No Cloud read expected for null Journal'); });
  let error: unknown, result: unknown;
  try { result = await repairRedundantJournalAtStartup(persistence, { connect: async () => {}, upload: async op => ({ opId: op.opId }), readRecoverySnapshot }, versionedScope(baseScope, 3)); }
  catch (cause) { error = cause; }
  expect.soft(error, String(error)).toBeUndefined();
  expect.soft(result).toBe(false);
  expect(await source.loadCommitted()).toBe(sourceRaw);
  expect(await persistence.loadCommitted()).toBe(destinationRaw);
  expect(await persistence.loadJournal()).toBeNull();
  expect(JSON.parse((await persistence.loadCommitted())!).sync.outbox).toEqual([]);
  expect(readRecoverySnapshot).not.toHaveBeenCalled();
});
it('the same Ver3 persistence passes with its actual versioned scope; wrong scope remains protected', async () => {
  const { baseScope, destination } = await setup();
  const adapter = { connect: async () => {}, upload: async (op: { opId: string }) => ({ opId: op.opId }) };
  await expect(repairRedundantJournalAtStartup(destination, adapter, `${baseScope}/data-v3`)).resolves.toBe(false);
  await expect(repairRedundantJournalAtStartup(destination, adapter, 'different-account')).rejects.toThrow(/scope/);
});
it('unchanged Ver2 no-Journal startup passes the same helper', async () => {
  const { baseScope, source } = await setup();
  const adapter = { connect: async () => {}, upload: async (op: { opId: string }) => ({ opId: op.opId }) };
  await expect(repairRedundantJournalAtStartup(source, adapter, baseScope)).resolves.toBe(false);
});

it('Production hook passes the physical versioned storage scope to the unchanged Journal guard', () => {
  const hook = readFileSync(new URL('../hooks/useTaskMemoSync.ts', import.meta.url), 'utf8');
  expect(hook).toContain('repairRedundantJournalAtStartup(persistence, adapter, versionedScope(scope, version),');
});
