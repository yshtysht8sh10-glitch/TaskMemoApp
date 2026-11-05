// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import * as syntax from '../textFormat/syntax';
import { beginStartupDiagnostics, recordStartupSnapshot, STARTUP_DIAGNOSTICS_KEY } from './startupDiagnostics';
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';

it('reuses immutable domain fingerprints across source/status notifications and invalidates after a remote change', async () => {
  let raw: string | null = null;
  const store = await TaskMemoV2ApplicationStore.open({ loadJournal: async () => null, loadCommitted: async () => raw,
    writeAtomic: async (expected, value) => { if (raw !== expected) throw Error('CAS'); raw = value; },
    writeJournal: async () => {}, writeCommitted: async () => {}, clearJournal: async () => {} }, [], { deviceId: 'diagnostics' });
  beginStartupDiagnostics();
  const stringify = vi.spyOn(syntax, 'canonical');
  recordStartupSnapshot('checking', store.diagnosticSnapshot, 0, store.historyDepths);
  stringify.mockClear();
  recordStartupSnapshot('server', store.diagnosticSnapshot, 0, store.historyDepths);
  // Only the small evidence envelope is compared again, not the entire domain.
  expect(stringify).toHaveBeenCalledTimes(1);
  const before = JSON.parse(sessionStorage.getItem(STARTUP_DIAGNOSTICS_KEY)!);
  await store.receive({ value: { id: 'a', type: 'memo', title: 'synthetic', parentId: null, sortKey: 'a0', createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', deletedAt: null }, revision: 1,
    lastOpId: 'server:1', lastDeviceId: 'server', lastLocalSeq: 1, operationType: 'create' });
  recordStartupSnapshot('server', store.diagnosticSnapshot, 0, store.historyDepths);
  const after = JSON.parse(sessionStorage.getItem(STARTUP_DIAGNOSTICS_KEY)!);
  expect(after.at(-1).count).toBe(1);
  expect(after.at(-1).dataFingerprint).not.toBe(before.at(-1).dataFingerprint);
  expect(sessionStorage.getItem(STARTUP_DIAGNOSTICS_KEY)).not.toContain('synthetic');
  stringify.mockRestore();
});
