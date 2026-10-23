import { expect, it, vi } from 'vitest';
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';
import { TaskMemoV2SyncController } from './taskMemoV2SyncController';
import type { SyncAdapter } from './types';

it('does not call an account current until its server snapshot has been applied; empty snapshots count', async () => {
  let saved: string | null = null;
  const store = await TaskMemoV2ApplicationStore.open({ loadCommitted: async () => saved, loadJournal: async () => null,
    writeCommitted: async v => { saved = v; }, writeJournal: async () => {}, clearJournal: async () => {} }, [], { deviceId: 'startup' });
  let applied: ((source: 'cache' | 'server') => void) | undefined;
  const adapter: SyncAdapter = { connect: async () => {}, upload: vi.fn(), subscribe: (_receive, _error, snapshot) => {
    applied = snapshot; return () => {};
  } };
  const controller = new TaskMemoV2SyncController(store, adapter);
  await controller.start();
  expect(controller.snapshotSource).toBe('checking');
  applied!('cache');
  expect(controller.snapshotSource).toBe('cache');
  applied!('server');
  expect(controller.snapshotSource).toBe('server');
  controller.stop();
  applied!('cache');
  expect(controller.snapshotSource).toBe('checking');
  expect(store.outbox).toEqual([]);
});
