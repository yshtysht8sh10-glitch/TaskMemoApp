import { readFileSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const script = readFileSync('public/v2-cloud-recovery.js', 'utf8');
const sha = (raw: string) => createHash('sha256').update(raw).digest('hex');

async function launch(changedLegacy = false) {
  const scope = 'taskmemoapp-eabc3/uid';
  const legacy = JSON.stringify({ version: 2, domain: { one: {} }, sync: { outbox: [] } });
  const current = JSON.stringify({ version: 2, deviceId: 'device', domain: { one: {} }, sync: { outbox: [] } });
  const recovered = JSON.stringify({ version: 2, deviceId: 'device', domain: { one: {}, two: {} }, sync: { outbox: [] } });
  const key = `@taskmemo/sync-v2/taskmemo-application/v2/${encodeURIComponent(scope)}`;
  const values = { [key]: changedLegacy ? `${legacy} ` : legacy };
  const localStorage = { getItem: (name: string) => values[name as keyof typeof values] ?? null,
    setItem: vi.fn(() => { throw new Error('legacy write attempted'); }) };
  const indexedDB = new IDBFactory();
  const request = indexedDB.open('taskmemo-v2-local-application', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('scopes', { keyPath: 'scope' });
  const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const transaction = db.transaction('scopes', 'readwrite');
  transaction.objectStore('scopes').put({ scope, committed: current, journal: null, legacyFingerprint: 'original-fingerprint' });
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  db.close();
  const plan = { format: 'taskmemo-cloud-recovery-plan-v1', scope, nodeCount: 2,
    expected: { committedSha256: sha(current), journal: null, legacyCommittedSha256: sha(legacy),
      legacyJournal: null, legacyFingerprint: 'original-fingerprint' },
    newLegacyFingerprint: sha(JSON.stringify([legacy, null])), recoveredCommitted: recovered };
  const handlers = new Map<string, () => Promise<void>>();
  const status = { textContent: '' };
  const apply = { disabled: true, addEventListener: (_: string, handler: () => Promise<void>) => handlers.set('apply', handler) };
  const inspect = { addEventListener: (_: string, handler: () => Promise<void>) => handlers.set('inspect', handler) };
  const cloud = { addEventListener: (_: string, handler: () => Promise<void>) => handlers.set('cloud', handler) };
  const input = { files: [{ text: async () => JSON.stringify(plan) }] };
  runInNewContext(script, { document: { getElementById: (id: string) => ({ status, apply, inspect, cloud, plan: input })[id as 'status'] },
    indexedDB, localStorage, crypto: webcrypto, TextEncoder, Date, JSON });
  const read = async () => {
    const opened = indexedDB.open('taskmemo-v2-local-application');
    const database = await new Promise<IDBDatabase>((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const transaction = database.transaction('scopes', 'readonly');
    const get = transaction.objectStore('scopes').get(scope);
    const result = await new Promise<any>((resolve, reject) => { get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
    database.close();
    return result;
  };
  return { handlers, apply, status, localStorage, current, recovered, read };
}

it('keeps the old IndexedDB generation and never writes legacy storage when recovering', async () => {
  const fixture = await launch();
  await fixture.handlers.get('inspect')!();
  expect(fixture.apply.disabled).toBe(false);
  await fixture.handlers.get('apply')!();
  const record = await fixture.read();
  expect(record.committed).toBe(fixture.recovered);
  expect(record.preservedCloudRecoveryCommitted).toBe(fixture.current);
  expect(fixture.localStorage.setItem).not.toHaveBeenCalled();
});

it('blocks recovery when the legacy source changed since the backup', async () => {
  const fixture = await launch(true);
  await fixture.handlers.get('inspect')!();
  expect(fixture.apply.disabled).toBe(true);
  expect((await fixture.read()).committed).toBe(fixture.current);
  expect(fixture.localStorage.setItem).not.toHaveBeenCalled();
});
