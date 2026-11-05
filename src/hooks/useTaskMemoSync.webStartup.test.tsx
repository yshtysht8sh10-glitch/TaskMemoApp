// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { useTaskMemoSync } from './useTaskMemoSync';
import { createNodeHistory } from '../domain/nodeHistory';
import { IndexedDbTaskMemoApplicationJournal as Persistence } from '../sync/indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore as Store } from '../sync/taskMemoApplicationStore';
import { InMemoryRevisionServer } from '../sync/revisionModel';
import type { MemoNode } from '../models/node';
import type { SyncAdapter, VersionedNode } from '../sync/types';

const fake = vi.hoisted(() => ({ auth: undefined as undefined | ((user: { uid: string } | null) => void),
  offline: false, gate: undefined as Promise<void> | undefined, auditGate: undefined as Promise<void> | undefined,
  events: [] as string[], subscriptions: new Map<string, { receive: (record: VersionedNode) => void | Promise<void>;
    applied: (source: 'cache' | 'server') => void; batch: (records: VersionedNode[]) => void | Promise<void> }>() }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' }, Alert: { alert: vi.fn() } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_: unknown, callback: typeof fake.auth) => { fake.auth = callback; return () => {}; },
  signOut: vi.fn(), signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn() }));
vi.mock('../services/firebaseConfig', () => ({ firebaseConfiguration: () => ({ config: { projectId: 'taskmemoapp-dev' }, environment: 'development', error: null }) }));
vi.mock('../services/firebaseClient', () => ({ getFirebaseClient: () => ({ auth: {}, db: { app: { options: { projectId: 'taskmemoapp-dev' } } } }) }));
vi.mock('../services/localV2Application', async () => {
  const { migrateLocalApplication } = await import('../sync/localApplication');
  return { openCommonLocalApplication: async () => {
    let raw: string | null = null;
    const store = await migrateLocalApplication({ loadCommitted: async () => raw, loadJournal: async () => null,
      writeAtomic: async (expected, value) => { if (raw !== expected) throw Error('CAS'); raw = value; },
      writeCommitted: async () => {}, writeJournal: async () => {}, clearJournal: async () => {} },
    { source: '[]', scope: 'anonymous', deviceId: 'anonymous', profile: { body: '', ideasEnabled: false } });
    return { scope: 'anonymous', store };
  } };
});
vi.mock('../sync/firebaseSyncAdapter', () => ({ createFirebaseSyncAdapter: (_: unknown, uid: string): SyncAdapter => {
  const server = new InMemoryRevisionServer();
  return {
    connect: async () => { await fake.gate; if (fake.offline) throw { kind: 'offline', message: 'synthetic offline' }; },
    auditOutbox: async operations => { fake.events.push(`audit-start:${operations.length}`); await fake.auditGate;
      fake.events.push('audit-complete'); return { received: 0, missing: operations.length }; },
    upload: async operation => { fake.events.push('upload'); return server.apply(operation); },
    subscribe: (receive, _error, applied, batch) => { fake.subscriptions.set(uid, { receive, applied: applied!, batch: batch! }); return () => {}; },
  };
} }));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, indexedDB: new IDBFactory() });
  fake.auth = undefined; fake.offline = false; fake.gate = undefined; fake.auditGate = undefined;
  fake.events = []; fake.subscriptions.clear();
});
async function seed(uid: string, pending = false) {
  const p = await Persistence.open(`taskmemoapp-dev/${uid}`);
  const node: MemoNode = { id: `${uid}-memo`, type: 'memo', memoType: 'task', parentId: null, sortKey: 'a0', title: `cached ${uid}`, body: '',
    dueAt: null, duePreset: 'none', status: 'active', completedAt: null, deletedAt: null, createdAt: new Date(0), updatedAt: new Date(0) };
  const store = await Store.open(p, [node], { deviceId: `${uid}-device` });
  if (pending) await store.command('offline edit', 'update', nodes => nodes.map(n => ({ ...n, title: `pending ${uid}` })));
  return p;
}
async function mount() {
  let current!: ReturnType<typeof useTaskMemoSync>;
  function Probe() {
    const [history, setHistory] = useState(() => createNodeHistory([]));
    current = useTaskMemoSync(history, true, setHistory);
    return <div>{current.startup.showData ? history.nodes.map(n => n.title).join(',') : 'restoring'}</div>;
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => { root.render(<Probe />); });
  const settle = async (check: () => void) => vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); check();
  });
  await settle(() => expect(fake.auth).toBeTypeOf('function'));
  return { host, current: () => current, settle, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it('renders restored Web account tasks before delayed Cloud and keeps editing gated until the server snapshot', async () => {
  await seed('early'); let release!: () => void; fake.gate = new Promise(resolve => { release = resolve; });
  const view = await mount();
  try {
    expect(view.host.textContent).toBe('restoring');
    await act(async () => { fake.auth!({ uid: 'early' }); });
    await view.settle(() => expect(view.host.textContent).toBe('cached early'));
    expect(view.current().startup).toMatchObject({ showData: true, editable: false, canUseCache: false });
    expect(fake.subscriptions.size).toBe(0);
    await act(async () => { release(); });
    await view.settle(() => expect(fake.subscriptions.has('early')).toBe(true));
    await act(async () => { fake.subscriptions.get('early')!.applied('server'); });
    expect(view.current().startup.editable).toBe(true);
  } finally { release(); await view.close(); }
});

it('shows offline data and retains pending Outbox, and audits before sending after reconnection', async () => {
  const p = await seed('pending', true); fake.offline = true;
  const view = await mount();
  try {
    await act(async () => { fake.auth!({ uid: 'pending' }); });
    await view.settle(() => expect(view.current().status).toBe('offline'));
    expect(view.host.textContent).toBe('pending pending'); expect(view.current().startup.editable).toBe(false);
    expect(JSON.parse((await p.loadCommitted())!).sync.outbox).toHaveLength(1);
    expect(fake.events).not.toContain('upload');
    fake.offline = false; let release!: () => void; fake.auditGate = new Promise(resolve => { release = resolve; });
    let retry!: Promise<void>;
    await act(async () => { retry = view.current().retrySync(); });
    await view.settle(() => expect(fake.events).toContain('audit-start:1'));
    expect(fake.events).not.toContain('upload');
    await act(async () => { release(); await retry; });
    expect(fake.events.indexOf('audit-complete')).toBeLessThan(fake.events.indexOf('upload'));
    expect(JSON.parse((await p.loadCommitted())!).sync.outbox).toHaveLength(0);
  } finally { await view.close(); }
});

it('keeps mismatching Journal protected and never displays or uploads the account cache', async () => {
  const p = await seed('journal'); const raw = (await p.loadCommitted())!;
  const journal = raw.replace('cached journal', 'unverified journal'); await p.writeJournal(journal);
  const view = await mount();
  try {
    await act(async () => { fake.auth!({ uid: 'journal' }); });
    await view.settle(() => expect(view.current().applicationState).toBe('error'));
    expect(view.host.textContent).toBe('restoring'); expect(view.current().startup.showData).toBe(false);
    expect(await p.loadCommitted()).toBe(raw); expect(await p.loadJournal()).toBe(journal);
    expect(fake.events).not.toContain('upload'); expect(fake.subscriptions.size).toBe(0);
  } finally { await view.close(); }
});

it('ignores retired account batch/server notifications while showing the newly authenticated scope', async () => {
  const a = await seed('account-a'); await seed('account-b'); const view = await mount();
  try {
    await act(async () => { fake.auth!({ uid: 'account-a' }); });
    await view.settle(() => expect(fake.subscriptions.has('account-a')).toBe(true));
    const retired = fake.subscriptions.get('account-a')!, before = await a.loadCommitted();
    let release!: () => void; fake.gate = new Promise(resolve => { release = resolve; });
    await act(async () => { fake.auth!({ uid: 'account-b' }); });
    await view.settle(() => expect(view.host.textContent).toBe('cached account-b'));
    const old = JSON.parse(before!).domain['account-a-memo'] as VersionedNode;
    await act(async () => { await retired.batch([{ ...old, revision: 9, value: { ...old.value, title: 'retired data' } }]); retired.applied('server'); });
    expect(view.host.textContent).toBe('cached account-b'); expect(view.current().startup.editable).toBe(false);
    expect(await a.loadCommitted()).toBe(before);
    await act(async () => { release(); });
  } finally { await view.close(); }
});
