import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const html = readFileSync('public/storage-diagnostics.html', 'utf8');
const script = readFileSync('public/storage-diagnostics.js', 'utf8');

function launch(values: Record<string, string>) {
  const handlers = new Map<string, () => void>();
  const result = { value: '', focus: vi.fn(), select: vi.fn() };
  const status = { textContent: '' };
  const measure = { addEventListener: (_: string, handler: () => void) => handlers.set('measure', handler) };
  const copy = { addEventListener: (_: string, handler: () => void) => handlers.set('copy', handler) };
  const writes = vi.fn(() => { throw new Error('Storage write attempted'); });
  const keys = Object.keys(values);
  const storage = {
    get length() { return keys.length; },
    key(index: number) { return keys[index] ?? null; },
    getItem(key: string) { return values[key] ?? null; },
    setItem: writes, removeItem: writes, clear: writes,
  };
  const writeText = vi.fn(async (_value: string) => undefined);
  const document = {
    getElementById: (id: string) => ({ result, status, measure, copy })[id as 'result' | 'status' | 'measure' | 'copy'],
    querySelector: (selector: string) => ({ content: selector.includes('version') ? '1.0.0' : 'abcdef1234567890' }),
  };
  runInNewContext(script, { document, window: { localStorage: storage }, navigator: { standalone: true, clipboard: { writeText } }, location: { origin: 'https://taskmemoapp-eabc3.web.app' } });
  return { handlers, result, status, writes, writeText };
}

it('is a separate static page with only its diagnostic script', () => {
  expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script defer src="/storage-diagnostics.js">']);
  expect(html).not.toMatch(/expo-router|index\.js|firebase|service-worker\.js/i);
  expect(script).not.toMatch(/\.(?:setItem|removeItem|clear)\s*\(/);
  expect(script).not.toMatch(/(?:fetch|importScripts|register)\s*\(/);
});

it('measures all localStorage while exposing only whitelisted names and aggregate metadata', async () => {
  const envelope = JSON.stringify({
    version: 2,
    domain: { privateId: { value: { title: 'SECRET_TITLE', body: 'SECRET_BODY' } } },
    history: { past: [{ before: 'SECRET_TITLE' }], future: [{ after: 'SECRET_BODY' }] },
    sync: { outbox: [{ payload: 'SECRET_BODY' }], seenOpIds: ['privateOp'] },
    profile: { pinnedNote: { localBody: 'SECRET_PINNED', dirtySince: 'now' } },
  });
  const scoped = '@taskmemo/sync-v2/taskmemo-application/v2/project%2FSECRET_UID';
  const fixture = launch({ [scoped]: envelope, '@taskmemo/nodes/v1': 'SECRET_OLD', 'firebase:authUser': 'secret@example.com' });
  fixture.handlers.get('measure')!();
  const report = JSON.parse(fixture.result.value);
  expect(report).toMatchObject({ appVersion: '1.0.0', appCommit: 'abcdef1234567890', origin: 'https://taskmemoapp-eabc3.web.app', displayMode: 'standalone', otherKeyCount: 1 });
  expect(report.entries[1]).toMatchObject({ nodes: 1, undoCount: 1, redoCount: 1, outboxCount: 1, pinnedNoteDirty: true });
  expect(report.taskMemoTotalUtf16Bytes + report.otherTotalUtf16Bytes).toBe(report.allLocalStorageTotalUtf16Bytes);
  for (const secret of ['SECRET_TITLE', 'SECRET_BODY', 'SECRET_PINNED', 'SECRET_OLD', 'SECRET_UID', 'privateId', 'privateOp', 'secret@example.com', 'firebase:authUser']) expect(fixture.result.value).not.toContain(secret);
  fixture.handlers.get('copy')!();
  expect(fixture.writeText).toHaveBeenCalledExactlyOnceWith(fixture.result.value);
  expect(fixture.writes).not.toHaveBeenCalled();
});

it('leaves invalid journal untouched and never exposes its raw contents', () => {
  const fixture = launch({ '@taskmemo/sync-v2/taskmemo-application-journal/v2/project%2Fprivate': '{SECRET' });
  fixture.handlers.get('measure')!();
  expect(JSON.parse(fixture.result.value).entries[0].parse).toBe('invalid-json');
  expect(fixture.result.value).not.toContain('SECRET');
  expect(fixture.writes).not.toHaveBeenCalled();
});
