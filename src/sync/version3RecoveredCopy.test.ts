import { expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createNode } from '../domain/nodeOperations';
import { IndexedDbTaskMemoApplicationJournal as Journal } from './indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore as Store } from './taskMemoApplicationStore';
const memory = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (k: string) => memory.get(k) ?? null,
  setItem: async (k: string, v: string) => { memory.set(k, v); },
  removeItem: async (k: string) => { memory.delete(k); },
} }));
const dbName = 'taskmemo-v2-local-application';
const sha = async (v: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))].map(b => b.toString(16).padStart(2, '0')).join('');
async function records(factory: IDBFactory, replace?: any) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = factory.open(dbName); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try {
    const tx = db.transaction('scopes', replace ? 'readwrite' : 'readonly');
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    if (replace) tx.objectStore('scopes').put(replace);
    const all = await new Promise<any[]>((resolve, reject) => { const r = tx.objectStore('scopes').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await done; return all;
  } finally { db.close(); }
}
async function setup() {
  const factory = new IDBFactory(), scope = `synthetic/recovered-${crypto.randomUUID()}`;
  const persistence = await Journal.open(scope, factory);
  const app = await Store.open(persistence, [], { deviceId: 'current-device' });
  await app.command('synthetic saved memo', 'create', nodes => createNode(nodes, 'memo', { title: 'synthetic', parentId: null }, new Date('2026-11-26T00:00:00Z'), 'synthetic-memo'));
  for (const op of [...app.outbox]) await app.acknowledge(op.opId);
  const envelope = JSON.parse((await persistence.loadCommitted())!);
  envelope.profile.pinnedNote.migrationPending = false;
  envelope.profile.features.migrationPending = false;
  const raw = JSON.stringify(envelope);
  const old = { ...envelope, deviceId: 'archived-device', sync: { ...envelope.sync, outbox: [{ opId: 'archived-operation-not-to-be-sent' }] } };
  const legacyCommitted = JSON.stringify(old), legacyJournal = JSON.stringify({ ...old, nextLocalSeq: 2000 });
  const committedKey = `@taskmemo/sync-v2/taskmemo-application/v2/${encodeURIComponent(scope)}`;
  const journalKey = `@taskmemo/sync-v2/taskmemo-application-journal/v2/${encodeURIComponent(scope)}`;
  memory.set(committedKey, legacyCommitted); memory.set(journalKey, legacyJournal);
  const fingerprint = await sha(JSON.stringify([legacyCommitted, legacyJournal]));
  const record = { ...(await records(factory))[0], committed: raw, journal: null, legacyFingerprint: fingerprint,
    recoveryCompleted: true, localRecoveryMode: false, selfRepairCompletedAt: '2026-09-28T05:37:39.013Z',
    preservedSelfRepairCommitted: raw, preservedRecoveryCommitted: legacyCommitted, preservedRecoveryJournal: legacyJournal,
    authoritativeRecoveryPlan: JSON.stringify({ version: 1, sourceFingerprint: fingerprint, operations: [], acknowledgements: [] }),
  };
  await records(factory, record);
  return { factory, scope, record, envelope, committedKey, journalKey, baseline: { nodes: Object.values(envelope.domain) as import('./types').VersionedNode[] } };
}
it('copies completed recovered state, retains every archived byte and History, and restarts without replay', async () => {
  const f = await setup(), legacyBefore = [...memory.entries()];
  const destination = await Journal.openVersion3(f.scope, f.baseline, f.factory);
  const raw = (await destination.loadCommitted())!;
  expect(JSON.parse(raw)).toEqual({ ...f.envelope, dataVersion: 3 });
  const all = await records(f.factory);
  expect(all.find(r => r.scope === f.scope)).toEqual(f.record);
  expect(all.find(r => r.scope === `${f.scope}/data-v3`)).toEqual({ ...f.record, scope: `${f.scope}/data-v3`,
    committed: raw, journal: null, legacyFingerprint: await sha(JSON.stringify([null, null])) });
  expect([...memory.entries()]).toEqual(legacyBefore);
  expect(f.envelope.history.past.length).toBeGreaterThan(0);
  expect(await (await Journal.openVersion3(f.scope, f.baseline, f.factory)).loadCommitted()).toBe(raw);
});
it.each(['incomplete', 'local-mode', 'active-journal', 'outbox', 'dirty', 'migration', 'body', 'features',
  'cloud', 'legacy-changed', 'preserved-changed', 'missing-preserved', 'missing-self-repair', 'bad-time', 'plan-version', 'plan-fingerprint',
  'self-repair-device', 'unknown-version', 'ownership', 'cloud-revision', 'missing-local-mode', 'unknown-evidence-version'])
('rejects %s without altering source, archives or creating Ver3', async kind => {
  const f = await setup();
  if (kind === 'incomplete') f.record.recoveryCompleted = false;
  if (kind === 'local-mode') f.record.localRecoveryMode = true;
  if (kind === 'missing-local-mode') delete f.record.localRecoveryMode;
  if (kind === 'active-journal') f.record.journal = f.record.committed;
  if (kind === 'legacy-changed') memory.set(f.journalKey, f.record.preservedRecoveryJournal + ' ');
  if (kind === 'preserved-changed') f.record.preservedRecoveryJournal += ' ';
  if (kind === 'missing-preserved') delete f.record.preservedRecoveryCommitted;
  if (kind === 'missing-self-repair') delete f.record.preservedSelfRepairCommitted;
  if (kind === 'bad-time') f.record.selfRepairCompletedAt = 'invalid';
  if (kind === 'plan-version') f.record.authoritativeRecoveryPlan = JSON.stringify({ version: 99, sourceFingerprint: f.record.legacyFingerprint });
  if (kind === 'plan-fingerprint') f.record.authoritativeRecoveryPlan = JSON.stringify({ version: 1, sourceFingerprint: 'wrong' });
  const e = JSON.parse(f.record.committed);
  if (kind === 'outbox') e.sync.outbox.push({ opId: 'active-pending' });
  if (kind === 'dirty') e.profile.pinnedNote.dirtySince = '2026-11-27T00:00:00Z';
  if (kind === 'migration') e.profile.features.migrationPending = true;
  if (kind === 'body') e.profile.pinnedNote.localBody = 'unsent';
  if (kind === 'features') e.profile.features.localIdeasEnabled = true;
  if (kind === 'self-repair-device') f.record.preservedSelfRepairCommitted = JSON.stringify({ ...e, deviceId: 'wrong-device' });
  if (kind === 'unknown-evidence-version') f.record.preservedSelfRepairCommitted = JSON.stringify({ ...e, dataVersion: 99 });
  if (kind === 'unknown-version') e.dataVersion = 99;
  if (kind === 'ownership') e.ownershipTransaction = { pending: true };
  f.record.committed = JSON.stringify(e);
  await records(f.factory, f.record);
  const before = await records(f.factory), legacyBefore = [...memory.entries()];
  const baseline = structuredClone(f.baseline);
  if (kind === 'cloud') baseline.nodes = [];
  if (kind === 'cloud-revision') baseline.nodes[0].revision++;
  await expect(Journal.openVersion3(f.scope, baseline, f.factory)).rejects.toThrow();
  expect(await records(f.factory)).toEqual(before);
  expect([...memory.entries()]).toEqual(legacyBefore);
});
it.each(['abort', 'quota'])('failed %s preserves the old scope and every archive, without a partial destination', async failure => {
  const f = await setup(), before = await records(f.factory), legacyBefore = [...memory.entries()];
  const original = IDBObjectStore.prototype.add;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (failure === 'quota') throw new DOMException('Synthetic quota', 'QuotaExceededError');
    const request = original.call(this, value, key); this.transaction.abort(); return request;
  });
  try { await expect(Journal.openVersion3(f.scope, f.baseline, f.factory)).rejects.toThrow(); }
  finally { spy.mockRestore(); }
  expect(await records(f.factory)).toEqual(before);
  expect([...memory.entries()]).toEqual(legacyBefore);
});
