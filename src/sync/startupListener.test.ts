import { expect, it, vi } from 'vitest';
import { createFirebaseSyncAdapter } from './firebaseSyncAdapter';
const sdk = vi.hoisted(() => ({ snapshot: undefined as undefined | ((snapshot: unknown) => void) }));
vi.mock('firebase/firestore', async importOriginal => ({ ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: vi.fn(), onSnapshot: vi.fn((_ref, _options, next) => { sdk.snapshot = next; return () => {}; }),
}));

it('serializes cached/server snapshots and signals server readiness only after durable receives, including metadata-only empty results', async () => {
  const adapter = createFirebaseSyncAdapter({ app: { options: { projectId: 'taskmemoapp-dev' } } } as never, 'synthetic', 'development');
  let release!: () => void;
  const received = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const applied = vi.fn(), error = vi.fn();
  const stop = adapter.subscribe!(received, error, applied);
  sdk.snapshot!({ metadata: { fromCache: true }, docChanges: () => [{ type: 'added', doc: { data: () => ({ record: { revision: 1 } }) } }] });
  sdk.snapshot!({ metadata: { fromCache: false }, docChanges: () => [] });
  await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
  expect(applied).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(applied.mock.calls).toEqual([['cache'], ['server']]));
  expect(error).not.toHaveBeenCalled();
  stop();
});

it('never reports a failed durable receive as a confirmed snapshot', async () => {
  const adapter = createFirebaseSyncAdapter({ app: { options: { projectId: 'taskmemoapp-dev' } } } as never, 'synthetic', 'development');
  const applied = vi.fn(), error = vi.fn();
  const stop = adapter.subscribe!(async () => { throw new Error('storage failed'); }, error, applied);
  sdk.snapshot!({ metadata: { fromCache: true }, docChanges: () => [{ type: 'added', doc: { data: () => ({ record: {} }) } }] });
  sdk.snapshot!({ metadata: { fromCache: false }, docChanges: () => [] });
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect(applied).not.toHaveBeenCalled();
  stop();
});
