import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeHistory } from "../domain/nodeHistory";
import { useTaskMemoSync } from "./useTaskMemoSync";
import { migrateLocalApplication } from '../sync/localApplication';
import { serializeText } from '../textFormat/session';
import { onAuthStateChanged } from 'firebase/auth';
import { InMemoryRevisionServer } from '../sync/revisionModel';

const accountStorage = vi.hoisted(() => new Map<string, string>());
const uploads = vi.hoisted(() => [] as { uid: string; nodeId: string }[]);
const initialAccounts = vi.hoisted(() => new Set<string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => accountStorage.get(key) ?? null,
  setItem: async (key: string, value: string) => { accountStorage.set(key, value); },
  removeItem: async (key: string) => { accountStorage.delete(key); },
} }));
vi.mock('../sync/firebaseSyncAdapter', () => ({ createFirebaseSyncAdapter: (_db: unknown, uid: string) => {
  const server = new InMemoryRevisionServer();
  return { connect: async () => {}, auditOutbox: async () => ({ receivedOperationIndexes: [] }),
    ...(initialAccounts.has(uid) ? { readRecoverySnapshot: async () => ({ nodes: [], receiptDocumentCount: 0 }) } : {}),
    upload: async (op: Parameters<InMemoryRevisionServer['apply']>[0]) => { uploads.push({ uid, nodeId: op.targetNodeId }); return server.apply(op); } };
} }));

vi.mock("react", () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => effect(),
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => [
    typeof initial === "function" ? (initial as () => T)() : initial,
    vi.fn(),
  ],
}));

vi.mock('../services/localV2Application', () => ({ openCommonLocalApplication: async () => {
  let value: string | null = null;
  const storage = { loadCommitted: async () => value, loadJournal: async () => null, writeCommitted: async (v: string) => { value = v; }, writeJournal: async () => {}, clearJournal: async () => {},
    writeAtomic: async (expected: string | null, v: string) => { if (value !== expected) throw new Error('CAS'); value = v; } };
  const source = JSON.stringify([{ id: 'local', type: 'memo', memoType: 'task', title: 'Local', body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, parentId: null, sortKey: 'a0', createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', deletedAt: null }]);
  return { scope: 'anonymous', store: await migrateLocalApplication(storage, { source, scope: 'anonymous', deviceId: 'local-device', profile: { body: '', ideasEnabled: false } }) };
} }));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: vi.fn(),
  onAuthStateChanged: vi.fn(() => vi.fn()),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../services/firebaseConfig", () => ({
  firebaseConfiguration: () => ({
    config: { projectId: "taskmemoapp-dev" },
    environment: "development",
    error: null,
  }),
}));

vi.mock("../services/firebaseClient", () => ({
  getFirebaseClient: () => ({
    auth: {},
    db: { app: { options: { projectId: "taskmemoapp-dev" } } },
  }),
}));

vi.mock("../sync/featureFlag", () => ({
  isConfiguredV2SyncEnabled: () => true,
}));

vi.mock("./useFirebaseSync", () => ({
  useFirebaseSync: () => ({}),
}));

describe("useTaskMemoSync on React Native", () => {
  it('wires verified initial adoption through login and leaves the anonymous source intact on logout', async () => {
    const uid = 'verified-initial-account'; initialAccounts.add(uid);
    const histories = vi.fn(); useTaskMemoSync(createNodeHistory([]), true, histories);
    await vi.waitFor(() => expect(histories).toHaveBeenCalled());
    const callback = vi.mocked(onAuthStateChanged).mock.lastCall![1] as (user: unknown) => void;
    callback({ uid });
    await vi.waitFor(() => expect(uploads.filter(u => u.uid === uid && u.nodeId === 'local')).toHaveLength(1));
    await vi.waitFor(() => expect(histories.mock.lastCall![0].past).toHaveLength(1));
    callback(null);
    await vi.waitFor(() => expect(histories.mock.lastCall![0].past).toHaveLength(0));
    expect(histories.mock.lastCall![0].nodes[0].title).toBe('Local');
    initialAccounts.delete(uid);
  });
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
      writable: true,
    });
  });

  afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  it("does not call DOM online-event APIs when React Native exposes a partial window global", () => {
    expect(() => useTaskMemoSync(createNodeHistory([]), true, vi.fn())).not.toThrow();
  });
  it.each(['tree', 'list'] as const)('unsigned %s text edit and normal commands share the common Application', async (view) => {
    const histories = vi.fn();
    const sync = useTaskMemoSync(createNodeHistory([]), true, histories);
    await vi.waitFor(() => expect(histories).toHaveBeenCalled());
    const session = sync.beginTextEdit({ view, timeZone: 'Asia/Tokyo' });
    const plan = sync.prepareTextEdit(session, serializeText(session).replace(' | Local', ' | Edited'));
    await sync.commitTextEdit(plan);
    expect(histories.mock.lastCall![0].nodes[0].title).toBe('Edited');
    expect(histories.mock.lastCall![0].past).toHaveLength(1);
    sync.undo(); await vi.waitFor(() => expect(histories.mock.lastCall![0].nodes[0].title).toBe('Local'));
    sync.redo(); await vi.waitFor(() => expect(histories.mock.lastCall![0].nodes[0].title).toBe('Edited'));
    sync.command('通常編集', nodes => nodes.map(n => ({ ...n, title: 'Normal' })));
    await vi.waitFor(() => expect(histories.mock.lastCall![0].nodes[0].title).toBe('Normal'));
  });
  it('switches A → original anonymous → B without sharing Nodes, sessions or outgoing operations', async () => {
    const histories = vi.fn(); const sync = useTaskMemoSync(createNodeHistory([]), true, histories);
    await vi.waitFor(() => expect(histories).toHaveBeenCalled());
    const localSession = sync.beginTextEdit({ view: 'tree', timeZone: 'Asia/Tokyo' });
    const callback = vi.mocked(onAuthStateChanged).mock.lastCall![1] as (user: unknown) => void;
    callback({ uid: 'isolation-A' });
    await vi.waitFor(() => expect(histories.mock.lastCall![0].nodes).toEqual([]));
    expect(() => sync.prepareTextEdit(localSession, serializeText(localSession))).toThrow();
    const date = new Date('2026-10-03T00:00:00Z');
    sync.command('追加', () => [{ id: 'A-node', type: 'category', title: 'Account A', parentId: null, sortKey: 'a0', createdAt: date, updatedAt: date, deletedAt: null }]);
    await vi.waitFor(() => expect(uploads.some(u => u.uid === 'isolation-A' && u.nodeId === 'A-node')).toBe(true));
    const aSession = sync.beginTextEdit({ view: 'tree', timeZone: 'Asia/Tokyo' });
    callback(null);
    await vi.waitFor(() => expect(histories.mock.lastCall![0].nodes[0]?.id).toBe('local'));
    callback({ uid: 'isolation-B' });
    await vi.waitFor(() => expect(histories.mock.lastCall![0].nodes).toEqual([]));
    expect(histories.mock.lastCall![0].past).toEqual([]); expect(histories.mock.lastCall![0].future).toEqual([]);
    expect(() => sync.prepareTextEdit(aSession, serializeText(aSession))).toThrow();
    sync.command('追加', () => [{ id: 'B-node', type: 'category', title: 'Account B', parentId: null, sortKey: 'a0', createdAt: date, updatedAt: date, deletedAt: null }]);
    await vi.waitFor(() => expect(uploads.some(u => u.uid === 'isolation-B' && u.nodeId === 'B-node')).toBe(true));
    expect(uploads.some(u => u.uid === 'isolation-B' && u.nodeId === 'A-node')).toBe(false);
    callback(null); await vi.waitFor(() => expect(histories.mock.lastCall![0].nodes[0]?.id).toBe('local'));
  });
});
