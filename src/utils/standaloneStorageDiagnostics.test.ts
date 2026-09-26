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
  expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script defer src="/storage-diagnostics.js?build=__TASKMEMO_DIAGNOSTIC_COMMIT__">']);
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
  expect(report).toMatchObject({ appVersion: '1.0.0', appCommit: 'abcdef1234567890', origin: 'https://taskmemoapp-eabc3.web.app', displayMode: 'standalone', firebaseReceiptComparison: 'not-performed', otherKeyCount: 1 });
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

it('summarizes operation types, repeated IDs and valid date range without exposing raw operations', () => {
  const envelope = JSON.stringify({
    version: 2, domain: {}, history: { past: [], future: [] }, profile: {},
    sync: { outbox: [
      { opId: 'private-op-1', type: 'create', createdAt: '2026-09-20T00:00:00.000Z', payload: { title: 'SECRET_TITLE' } },
      { opId: 'private-op-2', type: 'update', createdAt: '2026-09-26T12:00:00.000Z' },
      { opId: 'private-op-1', type: 'update', createdAt: '2026-09-21T00:00:00.000Z' },
      { opId: 'private-op-3', type: 'SECRET_TYPE', createdAt: 'SECRET_DATE' },
    ], seenOpIds: [] },
  });
  const fixture = launch({ '@taskmemo/sync-v2/taskmemo-application/v2/project%2Fprivate': envelope });
  fixture.handlers.get('measure')!();
  const entry = JSON.parse(fixture.result.value).entries[0];
  expect(entry).toMatchObject({
    outboxCount: 4,
    outboxTypeCounts: { create: 1, update: 2, unknown: 1 },
    duplicateOperationIdCount: 1,
    oldestOperationAt: '2026-09-20T00:00:00.000Z',
    newestOperationAt: '2026-09-26T12:00:00.000Z',
    invalidOperationDateCount: 1,
  });
  for (const secret of ['private-op-1', 'private-op-2', 'private-op-3', 'SECRET_TITLE', 'SECRET_TYPE', 'SECRET_DATE']) expect(fixture.result.value).not.toContain(secret);
  expect(fixture.writes).not.toHaveBeenCalled();
});

it('compares matching application and journal outboxes and reports private update/create aggregates', () => {
  const scope = 'project%2FSECRET_UID';
  const prefix = '@taskmemo/sync-v2/';
  const envelope = (outbox: unknown[]) => JSON.stringify({
    version: 2, domain: {}, history: { past: [], future: [] }, profile: {}, sync: { outbox, seenOpIds: [] },
  });
  const application = [
    { opId: 'SECRET_SHARED', targetNodeId: 'SECRET_NODE_A', type: 'update', createdAt: '2026-09-26T00:00:00.000Z' },
    { opId: 'SECRET_APP_ONLY', targetType: 'pinnedNote', targetNodeId: 'pinnedNote', type: 'update', createdAt: '2026-09-26T00:00:00.500Z' },
  ];
  const journal = [
    application[0],
    { opId: 'SECRET_JOURNAL_1', targetNodeId: 'SECRET_NODE_A', type: 'update', createdAt: '2026-09-26T00:00:00.300Z' },
    { opId: 'SECRET_JOURNAL_2', targetNodeId: 'SECRET_NODE_B', type: 'update', createdAt: '2026-09-26T00:00:01.301Z' },
    { opId: 'SECRET_JOURNAL_3', targetType: 'features', type: 'update', createdAt: '2026-09-26T00:00:01.302Z' },
    { opId: 'SECRET_JOURNAL_4', targetType: 'other-private-kind', type: 'update', createdAt: '2026-09-26T00:00:01.303Z' },
    { opId: 'SECRET_CREATE_1', targetNodeId: 'SECRET_NODE_A', type: 'create', createdAt: '2026-09-26T00:00:02.000Z' },
    { opId: 'SECRET_CREATE_2', targetNodeId: 'SECRET_NODE_A', type: 'create', createdAt: '2026-09-26T00:00:02.000Z' },
    { opId: 'SECRET_CREATE_3', targetNodeId: 'SECRET_NODE_B', type: 'create', createdAt: '2026-09-26T00:00:02.000Z' },
  ];
  const fixture = launch({
    [`${prefix}taskmemo-application/v2/${scope}`]: envelope(application),
    [`${prefix}taskmemo-application-journal/v2/${scope}`]: envelope(journal),
  });
  fixture.handlers.get('measure')!();
  const report = JSON.parse(fixture.result.value);
  expect(report.outboxIdComparison).toEqual({ comparedScopeCount: 1, commonCount: 1, applicationOnlyCount: 1, journalOnlyCount: 7 });
  const committed = report.entries.find((entry: { keyName: string }) => entry.keyName.includes('taskmemo-application/v2/'));
  const pending = report.entries.find((entry: { keyName: string }) => entry.keyName.includes('taskmemo-application-journal/v2/'));
  expect(committed.updateTargetTypeCounts).toEqual({ node: 1, pinnedNote: 1, features: 0, other: 0 });
  expect(pending).toMatchObject({
    updateTargetTypeCounts: { node: 3, pinnedNote: 0, features: 1, other: 1 },
    updateUniqueNodeCount: 2,
    updateMaxPerNodeCount: 2,
    createUniqueNodeCount: 2,
    sortKeyOnlyOperationCount: 'not-determinable-from-outbox-payload',
  });
  expect(pending.updateTimeClusters).toMatchObject({ maxExactTimestampCount: 1, maxOneSecondWindowCount: 3 });
  expect(pending.createTimeClusters).toMatchObject({
    maxExactTimestampCount: 3, maxOneSecondWindowCount: 3,
    topExactTimestampGroups: [{ at: '2026-09-26T00:00:02.000Z', count: 3 }],
  });
  for (const secret of ['SECRET_UID', 'SECRET_NODE_A', 'SECRET_NODE_B', 'SECRET_SHARED', 'SECRET_APP_ONLY', 'SECRET_JOURNAL_1', 'other-private-kind'])
    expect(fixture.result.value).not.toContain(secret);
  expect(fixture.writes).not.toHaveBeenCalled();
});

it('does not compare different account scopes or expose malformed operation timestamps', () => {
  const envelope = (outbox: unknown[]) => JSON.stringify({ version: 2, domain: {}, history: {}, sync: { outbox }, profile: {} });
  const fixture = launch({
    '@taskmemo/sync-v2/taskmemo-application/v2/project%2FPRIVATE_A': envelope([{ opId: 'PRIVATE_OP', type: 'update', targetNodeId: 'PRIVATE_NODE', createdAt: 'PRIVATE_DATE' }]),
    '@taskmemo/sync-v2/taskmemo-application-journal/v2/project%2FPRIVATE_B': envelope([{ opId: 'PRIVATE_OP', type: 'create', targetNodeId: 'PRIVATE_NODE', createdAt: 'PRIVATE_DATE' }]),
  });
  fixture.handlers.get('measure')!();
  const report = JSON.parse(fixture.result.value);
  expect(report.outboxIdComparison).toEqual({ comparedScopeCount: 0, commonCount: 0, applicationOnlyCount: 0, journalOnlyCount: 0 });
  expect(report.entries[0].updateTimeClusters.maxOneSecondWindowCount).toBe(0);
  for (const secret of ['PRIVATE_A', 'PRIVATE_B', 'PRIVATE_OP', 'PRIVATE_NODE', 'PRIVATE_DATE']) expect(fixture.result.value).not.toContain(secret);
  expect(fixture.writes).not.toHaveBeenCalled();
});
