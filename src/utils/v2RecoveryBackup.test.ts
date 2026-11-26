import { readFileSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const html = readFileSync('public/v2-recovery-backup.html', 'utf8');
const script = readFileSync('public/v2-recovery-backup.js', 'utf8');

function launch(values: Record<string, string>, indexedDB?: IDBFactory) {
  const handlers = new Map<string, () => Promise<void> | void>();
  const status = { textContent: '' };
  const buttons = Object.fromEntries(['prepare', 'share', 'download'].map((id) => [id, {
    disabled: id !== 'prepare',
    addEventListener: (_event: string, handler: () => Promise<void> | void) => handlers.set(id, handler),
  }]));
  const keys = Object.keys(values);
  const writes = vi.fn(() => { throw new Error('storage write attempted'); });
  const storage = {
    get length() { return keys.length; },
    key: (index: number) => keys[index] ?? null,
    getItem: (key: string) => values[key] ?? null,
    setItem: writes, removeItem: writes, clear: writes,
  };
  const share = vi.fn(async (_input: { files: File[] }) => undefined);
  runInNewContext(script, {
    document: { getElementById: (id: string) => id === 'status' ? status : buttons[id], querySelector: () => ({ content: 'COMMIT' }) },
    window: { localStorage: storage, indexedDB }, location: { origin: 'https://taskmemoapp-eabc3.web.app' },
    navigator: { share, canShare: () => true }, crypto: webcrypto, TextEncoder, File, URL, setTimeout,
  });
  return { handlers, status, buttons, writes, share };
}

it('is standalone and has no storage-write or network path', () => {
  expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script defer src="/v2-recovery-backup.js?build=__TASKMEMO_DIAGNOSTIC_COMMIT__">']);
  expect(script).not.toMatch(/\.(?:setItem|removeItem|clear)\s*\(/);
  expect(script).not.toMatch(/(?:fetch|importScripts|register)\s*\(/);
  expect(html).not.toMatch(/expo-router|index\.js|service-worker\.js/i);
});

it('includes the current IndexedDB application and journal in the read-only backup', async () => {
  const indexedDB = new IDBFactory();
  const opened = indexedDB.open('taskmemo-v2-local-application', 1);
  opened.onupgradeneeded = () => opened.result.createObjectStore('scopes', { keyPath: 'scope' });
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    opened.onsuccess = () => resolve(opened.result);
    opened.onerror = () => reject(opened.error);
  });
  const committed = JSON.stringify({ version: 2, domain: { one: {} }, sync: { outbox: [{ opId: 'private' }] } });
  const journal = JSON.stringify({ version: 2, domain: { one: {}, two: {} }, sync: { outbox: [] } });
  const transaction = database.transaction('scopes', 'readwrite');
  transaction.objectStore('scopes').put({ scope: 'project/SECRET_UID', committed, journal, legacyFingerprint: 'hash' });
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  const scope = 'project%2FSECRET_UID';
  const values = {
    [`@taskmemo/sync-v2/taskmemo-application/v2/${scope}`]: committed,
    [`@taskmemo/sync-v2/taskmemo-application-journal/v2/${scope}`]: journal,
  };
  const fixture = launch(values, indexedDB);
  await fixture.handlers.get('prepare')!();
  expect(fixture.status.textContent).toContain('IndexedDB組1: application 1 Node / 1 outbox、journal 2 Node / 0 outbox');
  expect(fixture.status.textContent).not.toContain('SECRET_UID');
  fixture.handlers.get('share')!();
  const archive = JSON.parse(await fixture.share.mock.calls[0][0].files[0].text());
  expect(archive.indexedDb.records).toEqual([{ scope: 'project/SECRET_UID', committed, journal, legacyFingerprint: 'hash' }]);
  expect(fixture.writes).not.toHaveBeenCalled();
});

it('exports exact application, journal, outbox, history and legacy values without showing private content', async () => {
  const scope = 'project%2FSECRET_UID';
  const applicationKey = `@taskmemo/sync-v2/taskmemo-application/v2/${scope}`;
  const journalKey = `@taskmemo/sync-v2/taskmemo-application-journal/v2/${scope}`;
  const application = JSON.stringify({ version: 2, domain: { privateId: { value: { title: 'SECRET_TITLE' } } }, sync: { outbox: [{ opId: 'SECRET_OP' }] }, history: { past: ['SECRET_UNDO'], future: [] }, nextLocalSeq: 2 });
  const journal = JSON.stringify({ version: 2, domain: { privateId: {}, newId: {} }, sync: { outbox: [{ opId: 'SECRET_OP' }, { opId: 'SECRET_CREATE' }] }, history: { past: ['SECRET_UNDO'], future: ['SECRET_REDO'] }, nextLocalSeq: 3 });
  const values = { [applicationKey]: application, [journalKey]: journal, '@taskmemo/nodes/v1': 'SECRET_LEGACY', 'firebase:authUser': 'SECRET_AUTH' };
  const fixture = launch(values);
  await fixture.handlers.get('prepare')!();
  expect(fixture.status.textContent).toMatch(/application: 1 Node \/ 1 outbox/);
  expect(fixture.status.textContent).toMatch(/journal: 2 Node \/ 2 outbox/);
  for (const secret of ['SECRET_UID', 'SECRET_TITLE', 'SECRET_OP', 'SECRET_UNDO', 'SECRET_LEGACY', 'SECRET_AUTH']) expect(fixture.status.textContent).not.toContain(secret);
  fixture.handlers.get('share')!();
  expect(fixture.share).toHaveBeenCalledOnce();
  const file = fixture.share.mock.calls[0][0].files[0];
  const raw = await file.text();
  const archive = JSON.parse(raw);
  expect(archive.entries).toEqual([
    { key: '@taskmemo/nodes/v1', value: 'SECRET_LEGACY' },
    { key: journalKey, value: journal },
    { key: applicationKey, value: application },
  ].sort((a, b) => a.key.localeCompare(b.key)));
  expect(raw).not.toContain('SECRET_AUTH');
  expect(fixture.status.textContent).toContain(createHash('sha256').update(raw).digest('hex'));
  expect(fixture.writes).not.toHaveBeenCalled();
});

it('preserves a lone V2 application when its journal is absent', async () => {
  const raw = JSON.stringify({ version: 2, domain: { one: {} }, sync: { outbox: [] } });
  const key = '@taskmemo/sync-v2/taskmemo-application/v2/project%2FPRIVATE';
  const fixture = launch({ [key]: raw });
  await fixture.handlers.get('prepare')!();
  expect(fixture.status.textContent).toContain('旧V2 application: 1 Node / 0 outbox');
  expect(fixture.status.textContent).toContain('旧V2 journal: なし');
  expect(fixture.buttons.share.disabled).toBe(false);
  fixture.handlers.get('share')!();
  expect(JSON.parse(await fixture.share.mock.calls[0][0].files[0].text()).entries).toEqual([{ key, value: raw }]);
  expect(fixture.writes).not.toHaveBeenCalled();
});

it.each(['{ damaged JSON', JSON.stringify({ version: 999, opaque: { state: 'future' } })])('preserves uninterpretable local raw without normalizing or claiming restoration: %s', async raw => {
  const key = '@taskmemo/sync-v2/taskmemo-application/v2/project%2FPRIVATE';
  const fixture = launch({ [key]: raw });
  await fixture.handlers.get('prepare')!();
  expect(fixture.buttons.share.disabled).toBe(false);
  expect(fixture.status.textContent).toContain('未検証');
  fixture.handlers.get('share')!();
  const archive = JSON.parse(await fixture.share.mock.calls[0][0].files[0].text());
  expect(archive.entries).toEqual([{ key, value: raw }]);
  expect(archive.capture).toMatchObject({ kind: 'local-raw', consistentCut: false, automaticRestoreAllowed: false, serverReceipts: 'not-collected' });
  expect(fixture.writes).not.toHaveBeenCalled();
});

it('exports IDB-only raw including malformed Journal and preserved recovery fields with no localStorage keys', async () => {
  const indexedDB = new IDBFactory(), request = indexedDB.open('taskmemo-v2-local-application', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('scopes', { keyPath: 'scope' });
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const record = { scope: 'synthetic/private', legacyFingerprint: 'fp', committed: '{opaque raw', journal: 'unknown raw',
    preservedRecoveryJournal: 'EXACT_RECOVERY_RAW', preservedSelfRepairCommitted: 'EXACT_REPAIR_RAW',
    authoritativeRecoveryPlan: 'EXACT_PLAN', unknownFutureMetadata: { fields: ['keep'] } };
  const transaction = database.transaction('scopes', 'readwrite'); transaction.objectStore('scopes').put(record);
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  database.close();
  const fixture = launch({}, indexedDB);
  await fixture.handlers.get('prepare')!();
  expect(fixture.buttons.share.disabled).toBe(false); expect(fixture.status.textContent).toContain('未検証');
  fixture.handlers.get('share')!();
  const archive = JSON.parse(await fixture.share.mock.calls[0][0].files[0].text());
  expect(archive.entries).toEqual([]); expect(archive.indexedDb.records).toEqual([record]);
  expect(archive.capture.automaticRestoreAllowed).toBe(false);
  for (const secret of ['private', 'EXACT_', 'unknown raw']) expect(fixture.status.textContent).not.toContain(secret);
  expect(fixture.writes).not.toHaveBeenCalled();
});

it('does not prepare an empty backup when neither source has TaskMemo data', async () => {
  const fixture = launch({}, new IDBFactory());
  await fixture.handlers.get('prepare')!();
  expect(fixture.buttons.share.disabled).toBe(true); expect(fixture.share).not.toHaveBeenCalled();
  expect(fixture.writes).not.toHaveBeenCalled();
});

it.each([
  ['Date', new Date(0)], ['Map', new Map([['secret', 'value']])],
  ['undefined', undefined], ['nonfinite', Infinity],
])('refuses lossy JSON encoding of unknown IndexedDB metadata: %s', async (_kind, metadata) => {
  const indexedDB = new IDBFactory(), request = indexedDB.open('taskmemo-v2-local-application', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('scopes', { keyPath: 'scope' });
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction('scopes', 'readwrite');
  transaction.objectStore('scopes').put({ scope: 'synthetic', legacyFingerprint: 'fp', committed: 'opaque', journal: null, futureMetadata: metadata });
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  const fixture = launch({}, indexedDB); await fixture.handlers.get('prepare')!();
  expect(fixture.buttons.share.disabled).toBe(true);
  expect(fixture.status.textContent).toMatch(/損失|原本/);
  expect(fixture.share).not.toHaveBeenCalled(); expect(fixture.writes).not.toHaveBeenCalled();
  const read = database.transaction('scopes', 'readonly').objectStore('scopes').get('synthetic');
  const retained = await new Promise<{ futureMetadata: unknown }>((resolve, reject) => {
    read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
  });
  expect(retained.futureMetadata).toEqual(metadata); database.close();
});

it.each([
  { label: 'out-of-line key', version: 1, keyPath: null, extra: false, auto: false, index: false },
  { label: 'extra store', version: 1, keyPath: 'scope', extra: true, auto: false, index: false },
  { label: 'unknown DB version', version: 2, keyPath: 'scope', extra: false, auto: false, index: false },
  { label: 'auto increment', version: 1, keyPath: 'scope', extra: false, auto: true, index: false },
  { label: 'unknown index', version: 1, keyPath: 'scope', extra: false, auto: false, index: true },
])('M146-1 refuses $label without omitting physical keys or stores', async schema => {
  const indexedDB = new IDBFactory(), request = indexedDB.open('taskmemo-v2-local-application', schema.version);
  request.onupgradeneeded = () => {
    const store = request.result.createObjectStore('scopes', { keyPath: schema.keyPath, autoIncrement: schema.auto });
    if (schema.index) store.createIndex('future-index', 'legacyFingerprint');
    if (schema.extra) request.result.createObjectStore('future');
  };
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction(schema.extra ? ['scopes', 'future'] : 'scopes', 'readwrite');
  const record = { scope: 'synthetic', legacyFingerprint: 'fp', committed: 'opaque', journal: null };
  if (schema.keyPath === null) transaction.objectStore('scopes').put(record, 'external-storage-key');
  else transaction.objectStore('scopes').put(record);
  if (schema.extra) transaction.objectStore('future').put('uncollected evidence', 'keep');
  await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  const fixture = launch({}, indexedDB); await fixture.handlers.get('prepare')!();
  expect(fixture.buttons.share.disabled).toBe(true); expect(fixture.buttons.download.disabled).toBe(true);
  expect(fixture.status.textContent).toMatch(/構成|原本/); expect(fixture.share).not.toHaveBeenCalled();
  const read = database.transaction('scopes', 'readonly').objectStore('scopes').getAllKeys();
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); });
  expect(keys).toEqual([schema.keyPath === null ? 'external-storage-key' : 'synthetic']);
  expect(database.version).toBe(schema.version); expect(database.objectStoreNames.contains('future')).toBe(schema.extra);
  expect(fixture.writes).not.toHaveBeenCalled(); database.close();
});
