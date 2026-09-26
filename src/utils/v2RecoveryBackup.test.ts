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
  expect(fixture.status.textContent).toMatch(/application 1 Node \/ 1 outbox/);
  expect(fixture.status.textContent).toMatch(/journal 2 Node \/ 2 outbox/);
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

it('refuses to report success without a matching V2 application and journal pair', async () => {
  const fixture = launch({ '@taskmemo/sync-v2/taskmemo-application/v2/project%2FPRIVATE': JSON.stringify({ version: 2, domain: {}, sync: { outbox: [] } }) });
  await fixture.handlers.get('prepare')!();
  expect(fixture.status.textContent).toMatch(/両方を確認できません/);
  expect(fixture.buttons.share.disabled).toBe(true);
  expect(fixture.writes).not.toHaveBeenCalled();
});
