import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirebaseSyncAdapter } from './firebaseSyncAdapter';

const state = vi.hoisted(() => ({ documents: new Map<string, unknown>(), reads: [] as string[], failure: null as unknown }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: async (path: string) => {
    state.reads.push(path);
    if (state.failure) throw state.failure;
    return { exists: () => state.documents.has(path), data: () => state.documents.get(path) };
  },
}));
const globalPath = 'syncControl/current';
const gatePath = 'users/new-user/syncMetadataV2/compatibility';
const gate = { schemaVersion: 1, minimumSyncProtocol: 2, v1WritesAllowed: false, v2Enabled: true };
const adapter = (ensureAccountReady?: () => Promise<void>) => createFirebaseSyncAdapter(
  { app: { options: { projectId: 'taskmemoapp-dev' } } } as never, 'new-user', 'development', { ensureAccountReady });

describe('real SDK adapter missing-gate onboarding order', () => {
  beforeEach(() => {
    state.documents.clear(); state.reads = []; state.failure = null;
    state.documents.set(globalPath, { schemaVersion: 1, writesEnabled: true });
  });
  it('waits for trusted onboarding before server gate re-read and validation', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const ensure = vi.fn(async () => { await pending; state.documents.set(gatePath, gate); });
    const connection = adapter(ensure).connect();
    await vi.waitFor(() => expect(ensure).toHaveBeenCalledOnce());
    expect(state.reads).toEqual([globalPath, gatePath]);
    finish(); await connection;
    expect(state.reads).toEqual([globalPath, gatePath, gatePath]);
  });
  it('preserves App Check/callable failure rather than replacing it with missing-gate error', async () => {
    await expect(adapter(async () => { throw { code: 'functions/unauthenticated', message: 'App Check rejected' }; }).connect())
      .rejects.toMatchObject({ message: 'App Check rejected' });
    expect(state.reads).toEqual([globalPath, gatePath]);
  });
  it('fails closed if backend returns but server gate remains absent', async () => {
    await expect(adapter(async () => {}).connect()).rejects.toMatchObject({ kind: 'permanent', message: expect.stringContaining('gateがありません') });
    expect(state.reads).toEqual([globalPath, gatePath, gatePath]);
  });
  it('reproduces the reported exact error when the caller supplies no onboarding callback', async () => {
    await expect(adapter().connect()).rejects.toMatchObject({ kind: 'permanent', message: expect.stringContaining('同期compatibility gateがありません') });
    expect(state.reads).toEqual([globalPath, gatePath]);
  });
  it('uses existing valid gates without provisioning', async () => {
    state.documents.set(gatePath, gate); const ensure = vi.fn();
    await adapter(ensure).connect(); expect(ensure).not.toHaveBeenCalled();
  });
  it('never interprets Firestore read failure as a missing gate', async () => {
    state.failure = { code: 'permission-denied', message: 'Read forbidden' }; const ensure = vi.fn();
    await expect(adapter(ensure).connect()).rejects.toMatchObject({ message: 'Read forbidden' });
    expect(ensure).not.toHaveBeenCalled();
  });
});
