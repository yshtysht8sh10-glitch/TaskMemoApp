// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useTaskMemoSync } from './useTaskMemoSync';
import { createNodeHistory } from '../domain/nodeHistory';
import { migrateLocalApplication } from '../sync/localApplication';
import type { VersionedNode } from '../sync/types';
import { InMemoryRevisionServer } from '../sync/revisionModel';
import { createNode } from '../domain/nodeOperations';
import { MemoCreateButton } from '../components/MemoCreateButton';
const servers = new Map<string, InMemoryRevisionServer>();
const fake = vi.hoisted(() => ({ auth: undefined as undefined | ((user: unknown) => void),
  receive: undefined as undefined | ((record: VersionedNode) => Promise<void>),
  failure: null as unknown, uploadedTo: [] as string[],
  applied: undefined as undefined | ((source: 'cache' | 'server') => void), storage: new Map<string, string>() }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, Alert: { alert: vi.fn() },
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Pressable: (p: { children: React.ReactNode; onPress: () => void; disabled?: boolean }) => <button disabled={p.disabled} onClick={p.onPress}>{p.children}</button>,
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => fake.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { fake.storage.set(key, value); }, removeItem: async (key: string) => { fake.storage.delete(key); },
} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: typeof fake.auth) => { fake.auth = callback; return () => {}; },
  signOut: vi.fn(), signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn() }));
vi.mock('../services/firebaseConfig', () => ({ firebaseConfiguration: () => ({ config: { projectId: 'taskmemoapp-dev' }, environment: 'development', error: null }) }));
vi.mock('../services/firebaseClient', () => ({ getFirebaseClient: () => ({ auth: {}, db: { app: { options: { projectId: 'taskmemoapp-dev' } } } }) }));
vi.mock('../sync/firebaseSyncAdapter', () => ({ createFirebaseSyncAdapter: (_db: unknown, uid: string) => ({ connect: async () => { if (fake.failure) throw fake.failure; },
  auditOutbox: async () => ({ received: 0, missing: 0 }), upload: async (operation: Parameters<InMemoryRevisionServer['apply']>[0]) => {
    if (fake.failure) throw fake.failure;
    const server = servers.get(uid) ?? new InMemoryRevisionServer(); servers.set(uid, server); fake.uploadedTo.push(uid);
    return server.apply(operation);
  },
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

it('adds through the real button only for the active ready scope, supports offline consent/retry, restart and Undo/Redo', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fake.storage.clear(); fake.failure = null; fake.uploadedTo = []; servers.clear();
  let current!: ReturnType<typeof useTaskMemoSync>, history = createNodeHistory([]), sequence = 0;
  function Probe() {
    const [value, update] = useState(history); history = value;
    const [open, setOpen] = useState(false), [reason, setReason] = useState(false);
    current = useTaskMemoSync(value, true, update);
    return <><MemoCreateButton editable={current.startup.editable} onCreate={() => setOpen(true)} onBlocked={() => setReason(true)} />
      {reason && <aside>{current.error ?? current.startup.message}</aside>}
      {open && <button data-save onClick={async () => {
        const id = `created-${++sequence}`;
        if (await current.commandConfirmed('Nodeを作成', nodes => createNode(nodes, 'memo', { title: id, parentId: null }, new Date(), id))) setOpen(false);
      }}>保存</button>}</>;
  }
  const host = document.createElement('div'); document.body.append(host); let root = createRoot(host);
  const clickAdd = async () => { await act(async () => { host.querySelector('button')!.click(); }); };
  const save = async () => { await act(async () => { (host.querySelector('[data-save]') as HTMLButtonElement).click(); }); };
  try {
    await act(async () => { root.render(<Probe />); });
    await act(async () => { fake.auth!(null); });
    await clickAdd(); expect(host.querySelector('[data-save]')).not.toBeNull(); await save();
    expect(history.nodes.some(n => n.id === 'created-1')).toBe(true); expect(fake.uploadedTo).toEqual([]);
    await act(async () => { fake.auth!({ uid: 'create-account' }); });
    await clickAdd(); expect(host.querySelector('[data-save]')).toBeNull(); expect(host.querySelector('aside')).not.toBeNull();
    expect(history.nodes.some(n => n.id === 'created-1')).toBe(false);
    await act(async () => { fake.applied!('server'); });
    expect(current.startup.editable).toBe(true);
    await clickAdd(); await save();
    await act(async () => { await vi.waitFor(() => expect(servers.get('create-account')?.get('created-2')).toBeDefined()); });
    expect(fake.uploadedTo.every(uid => uid === 'create-account')).toBe(true);
    await act(async () => { current.undo(); });
    await act(async () => { await vi.waitFor(() => expect(history.nodes.find(n => n.id === 'created-2')?.deletedAt).not.toBeNull()); });
    await act(async () => { current.redo(); });
    await act(async () => { await vi.waitFor(() => expect(history.nodes.find(n => n.id === 'created-2')?.deletedAt).toBeNull()); });
    // A reload opens the same durable Account journal, not the anonymous source.
    await act(async () => { root.unmount(); }); root = createRoot(host);
    await act(async () => { root.render(<Probe />); });
    await act(async () => { fake.auth!({ uid: 'create-account' }); });
    await act(async () => { fake.applied!('server'); });
    expect(history.nodes.some(n => n.id === 'created-2')).toBe(true);
    fake.failure = { kind: 'offline', message: 'offline test' };
    await act(async () => { await current.retrySync(); });
    expect(current.startup.editable).toBe(false);
    await clickAdd(); expect(host.querySelector('[data-save]')).toBeNull();
    await act(async () => { current.useCachedData(); }); expect(current.startup.editable).toBe(true);
    await clickAdd(); await save(); expect(history.nodes.some(n => n.id === 'created-3')).toBe(true);
    expect(servers.get('create-account')?.get('created-3')).toBeUndefined();
    fake.failure = null;
    await act(async () => { await current.retrySync(); fake.applied!('server'); });
    await act(async () => { await vi.waitFor(() => expect(servers.get('create-account')?.get('created-3')).toBeDefined()); });
    await act(async () => { fake.auth!(null); });
    expect(history.nodes.some(n => n.id === 'created-2')).toBe(false);
    await act(async () => { fake.auth!({ uid: 'create-account' }); });
    await act(async () => { fake.applied!('server'); }); await clickAdd(); await save();
    expect(history.nodes.some(n => n.id === 'created-2')).toBe(true);
    expect(history.nodes.some(n => n.id === 'created-3')).toBe(true);
  } finally { fake.failure = null; await act(async () => root.unmount()); host.remove(); }
});
