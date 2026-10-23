// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useTaskMemoSync } from './useTaskMemoSync';
import { createNodeHistory } from '../domain/nodeHistory';
import { migrateLocalApplication } from '../sync/localApplication';
import type { VersionedNode } from '../sync/types';
const fake = vi.hoisted(() => ({ auth: undefined as undefined | ((user: unknown) => void),
  receive: undefined as undefined | ((record: VersionedNode) => Promise<void>),
  applied: undefined as undefined | ((source: 'cache' | 'server') => void), storage: new Map<string, string>() }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, Alert: { alert: vi.fn() } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => fake.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { fake.storage.set(key, value); }, removeItem: async (key: string) => { fake.storage.delete(key); },
} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: typeof fake.auth) => { fake.auth = callback; return () => {}; },
  signOut: vi.fn(), signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn() }));
vi.mock('../services/firebaseConfig', () => ({ firebaseConfiguration: () => ({ config: { projectId: 'taskmemoapp-dev' }, environment: 'development', error: null }) }));
vi.mock('../services/firebaseClient', () => ({ getFirebaseClient: () => ({ auth: {}, db: { app: { options: { projectId: 'taskmemoapp-dev' } } } }) }));
vi.mock('../sync/firebaseSyncAdapter', () => ({ createFirebaseSyncAdapter: () => ({ connect: async () => {},
  auditOutbox: async () => ({ received: 0, missing: 0 }), upload: vi.fn(),
  subscribe: (receive: typeof fake.receive, _error: unknown, applied: typeof fake.applied) => {
    fake.receive = receive; fake.applied = applied; return () => {};
  },
}) }));
vi.mock('../services/localV2Application', () => ({ openCommonLocalApplication: async () => {
  let saved: string | null = null;
  const store = await migrateLocalApplication({ loadCommitted: async () => saved, loadJournal: async () => null,
    writeAtomic: async (expected, value) => { if (saved !== expected) throw new Error('CAS'); saved = value; },
    writeCommitted: async v => { saved = v; }, writeJournal: async () => {}, clearJournal: async () => {} },
    { source: JSON.stringify([{ id: 'anonymous-memo', type: 'memo', parentId: null, sortKey: 'a0', title: 'Unrelated Local', body: '',
      dueAt: null, duePreset: 'none', status: 'active', completedAt: null, deletedAt: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }]),
      scope: 'anonymous', deviceId: 'anonymous', profile: { body: '', ideasEnabled: false } });
  return { scope: 'anonymous', store };
} }));

it('real React lifecycle hides anonymous/account transitions, bounds offline wait and applies server data without a local edit', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let current!: ReturnType<typeof useTaskMemoSync>;
  let history = createNodeHistory([]);
  function Probe() {
    const [value, update] = useState(history); history = value;
    current = useTaskMemoSync(value, true, update);
    return <div>{current.startup.showData ? value.nodes.map(n => n.title).join(',') : 'restoring'}</div>;
  }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Probe />); });
    expect(current.applicationState, current.error ?? '').not.toBe('error');
    await act(async () => { await vi.waitFor(() => expect(fake.auth).toBeTypeOf('function')); });
    expect(host.textContent).toBe('restoring');
    expect(current.authReady).toBe(false);
    await act(async () => { current.command('should be blocked', () => { throw new Error('must not execute'); }); });
    expect(history.past).toHaveLength(0);
    await act(async () => { fake.auth!({ uid: 'startup-synthetic' }); });
    expect(current.applicationState, current.error ?? current.startup.message).toBe('ready');
    expect(host.textContent).toBe('restoring');
    expect(current.startup.editable).toBe(false);
    vi.useFakeTimers();
    // Timer was installed before switching clocks; re-enter the account to install it on the fake clock.
    await act(async () => { fake.auth!({ uid: 'startup-synthetic' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3001); });
    expect(current.startup).toMatchObject({ showData: true, editable: false, canUseCache: true });
    const blocked = vi.fn(nodes => nodes);
    await act(async () => { current.command('blocked while unverified', blocked); });
    expect(blocked).not.toHaveBeenCalled();
    const record: VersionedNode = { revision: 2, lastOpId: 'remote:2', lastDeviceId: 'remote', lastLocalSeq: 2, operationType: 'update',
      value: { id: 'remote-memo', type: 'memo', parentId: null, sortKey: 'a0', title: 'Latest', body: '', memoType: 'task',
        dueAt: null, duePreset: 'none', status: 'active', completedAt: null, deletedAt: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(2).toISOString() } };
    await act(async () => { await fake.receive!(record); fake.applied!('server'); });
    expect(host.textContent).toBe('Latest');
    expect(current.startup.editable).toBe(true);
    await act(async () => { await fake.receive!({ ...record, revision: 1, lastOpId: 'remote:1', value: { ...record.value, title: 'Old cache' } }); });
    expect(host.textContent).toBe('Latest');
    expect(history.past).toHaveLength(0);
    expect(history.future).toHaveLength(0);
    await act(async () => { fake.auth!(null); });
    expect(host.textContent).toBe('Unrelated Local');
    expect(current.startup.editable).toBe(true);
  } finally { vi.useRealTimers(); await act(async () => root.unmount()); host.remove(); }
});
