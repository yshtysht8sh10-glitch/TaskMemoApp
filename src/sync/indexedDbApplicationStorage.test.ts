import { IDBDatabase as FakeIDBDatabase, IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IndexedDbTaskMemoApplicationJournal } from "./indexedDbApplicationStorage";
import { TaskMemoV2ApplicationJournal } from "./applicationStorage";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import { observePendingJournalReceipts } from "./recovery";
import type { SyncAdapter } from "./types";
import type { MemoNode } from "../models/node";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
} }));

const envelope = (nodes: number, outbox: number) => JSON.stringify({
  version: 2, deviceId: "device-a", domain: Object.fromEntries(Array.from({ length: nodes }, (_, i) => [`n${i}`, { value: { id: `n${i}` } }])),
  history: { past: [{ commandId: "old", targets: [] }], future: [] },
  sync: { outbox: Array.from({ length: outbox }, (_, i) => ({ opId: `op${i}` })), seenOpIds: [] },
});

describe("IndexedDB V2 migration", () => {
  let factory: IDBFactory;
  beforeEach(() => { storage.clear(); factory = new IDBFactory(); });

  it("normal startup preserves Application, Journal, Outbox, Undo/Redo and profile across failed migration and restarts", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    const at = new Date("2026-09-26T00:00:00.000Z");
    const memo: MemoNode = { id: "memo", type: "memo", parentId: null, sortKey: "a0", title: "before", body: "", dueAt: null,
      duePreset: "none", status: "active", completedAt: null, createdAt: at, updatedAt: at, deletedAt: null };
    const seed = await TaskMemoV2ApplicationStore.open(legacy, [memo], { deviceId: "device-a" });
    await seed.setPinnedNoteDraft("profile body", at);
    await seed.setIdeasEnabled(true);
    const committed = (await legacy.loadCommitted())!;
    await seed.command("edit", "update", nodes => nodes.map(node => node.id === "memo" ? { ...node, title: "after" } : node));
    await seed.undo();
    const journal = (await legacy.loadCommitted())!;
    await legacy.writeCommitted(committed);
    await legacy.writeJournal(journal);
    const original = new Map(storage);

    const transaction = FakeIDBDatabase.prototype.transaction;
    const failure = vi.spyOn(FakeIDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, names, mode, options) {
      if (mode === "readwrite") throw new DOMException("quota", "QuotaExceededError");
      return transaction.call(this, names, mode, options);
    });
    try {
      await expect(IndexedDbTaskMemoApplicationJournal.open("account", factory)).rejects.toThrow("quota");
      expect(storage).toEqual(original);
    } finally { failure.mockRestore(); }

    let persistence = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    expect(await persistence.loadCommitted()).toBe(committed);
    expect(await persistence.loadJournal()).toBe(journal);
    persistence = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    const recovered = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored" });
    expect(recovered.nodes.find(node => node.id === "memo")?.title).toBe("before");
    expect(recovered.pinnedNote.body).toBe("profile body");
    expect(recovered.ideasEnabled).toBe(true);
    expect(recovered.outbox).toEqual(JSON.parse(journal).sync.outbox);
    expect(recovered.historyDepths).toEqual({ past: 1, future: 1 });
    const restarted = await TaskMemoV2ApplicationStore.open(await IndexedDbTaskMemoApplicationJournal.open("account", factory), [], { deviceId: "ignored" });
    expect(restarted.nodes).toEqual(recovered.nodes);
    expect(restarted.outbox).toEqual(recovered.outbox);
    expect(restarted.historyDepths).toEqual(recovered.historyDepths);
    expect(restarted.pinnedNote).toEqual(recovered.pinnedNote);
    expect(restarted.ideasEnabled).toBe(true);
    expect(storage).toEqual(original);
  });

  it("atomically restores the journal as local-only application and archives both original snapshots", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    const committed = envelope(150, 969);
    const journal = envelope(151, 1024);
    await legacy.writeCommitted(committed); await legacy.writeJournal(journal);
    const persistence = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    await persistence.saveAuthoritativeRecoveryPlan(committed, journal, JSON.stringify({ savedPartialCloudPlan: true }));
    const outcome = await persistence.restoreJournalLocally(committed, journal, "2026-09-27T00:00:00.000Z");
    expect(outcome).toMatchObject({ nodeCount: 151, archivedOutboxCount: 1024 });
    expect(await persistence.isLocalRecoveryMode()).toBe(true);
    const active = JSON.parse((await persistence.loadCommitted())!);
    expect(Object.keys(active.domain)).toHaveLength(151);
    expect(active.history).toEqual(JSON.parse(journal).history);
    expect(active.sync.outbox).toEqual([]);
    expect(await persistence.loadJournal()).toBeNull();
    expect(await persistence.loadAuthoritativeRecoveryPlan()).toBe(JSON.stringify({ savedPartialCloudPlan: true }));
    expect(await persistence.loadLocalRecoveryEvidence()).toMatchObject({ committed, journal,
      recoveredAt: "2026-09-27T00:00:00.000Z", archivedOutboxCount: 1024 });
    expect(await legacy.loadCommitted()).toBe(committed);
    expect(await legacy.loadJournal()).toBe(journal);
    await expect(persistence.restoreJournalLocally(committed, journal, "2026-09-27T00:01:00.000Z")).rejects.toThrow();
  });

  it("atomically returns to normal sync only after saving the current local generation as evidence", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    const committed = envelope(150, 969), journal = envelope(151, 1024);
    await legacy.writeCommitted(committed); await legacy.writeJournal(journal);
    const persistence = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    await persistence.restoreJournalLocally(committed, journal, "2026-09-27T00:00:00.000Z");
    const local = (await persistence.loadCommitted())!;
    const converged = JSON.stringify({ ...JSON.parse(local), sync: { outbox: [], seenOpIds: [] } });
    await expect(persistence.completeLocalSelfRepair("stale", converged, "2026-09-27T01:00:00.000Z"))
      .rejects.toThrow();
    expect(await persistence.isLocalRecoveryMode()).toBe(true);
    await persistence.completeLocalSelfRepair(local, converged, "2026-09-27T01:00:00.000Z");
    expect(await persistence.isLocalRecoveryMode()).toBe(false);
    expect(await persistence.isRecoveryCompleted()).toBe(true);
    expect(await persistence.loadCommitted()).toBe(converged);
    expect(await persistence.loadLocalRecoveryEvidence()).toMatchObject({ journal, committed,
      archivedOutboxCount: 1024, selfRepairSourceCommitted: local,
      selfRepairCompletedAt: "2026-09-27T01:00:00.000Z" });
    expect(await legacy.loadJournal()).toBe(journal);
  });

  it("copies committed 150 and journal 151 exactly, retains legacy, and survives restart", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    const committed = envelope(150, 969);
    const journal = envelope(151, 1024);
    await legacy.writeCommitted(committed); await legacy.writeJournal(journal);
    const original = new Map(storage);
    const migrated = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    expect(await migrated.loadCommitted()).toBe(committed);
    expect(await migrated.loadJournal()).toBe(journal);
    const observed = await IndexedDbTaskMemoApplicationJournal.open("account", factory, { allowLegacyCopy: false });
    expect(await observed.loadCommitted()).toBe(committed);
    expect(await observed.loadJournal()).toBe(journal);
    await migrated.writeCommitted(journal);
    await migrated.clearJournal();
    const reopened = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    expect(await reopened.loadCommitted()).toBe(journal);
    expect(await reopened.loadJournal()).toBeNull();
    expect(storage).toEqual(original);
  });

  it("atomically finalizes only the expected journal and preserves the legacy backup", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    const committed = envelope(150, 969);
    const journal = envelope(151, 1024);
    const recovered = envelope(151, 0);
    await legacy.writeCommitted(committed); await legacy.writeJournal(journal);
    const original = new Map(storage);
    const persistence = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    await expect(persistence.finalizeRecovery(committed, "wrong", recovered)).rejects.toThrow();
    expect(await persistence.loadCommitted()).toBe(committed);
    expect(await persistence.loadJournal()).toBe(journal);
    await persistence.finalizeRecovery(committed, journal, recovered);
    expect(await persistence.loadCommitted()).toBe(recovered);
    expect(await persistence.loadJournal()).toBeNull();
    expect(await persistence.isRecoveryCompleted()).toBe(true);
    expect(storage).toEqual(original);
  });

  it("retains the journal if the final IndexedDB write fails", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    const committed = envelope(150, 969);
    const journal = envelope(151, 1024);
    await legacy.writeCommitted(committed); await legacy.writeJournal(journal);
    const persistence = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    const original = FakeIDBDatabase.prototype.transaction;
    const failure = vi.spyOn(FakeIDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, names, mode, options) {
      if (mode === "readwrite") throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, names, mode, options);
    });
    try {
      await expect(persistence.finalizeRecovery(committed, journal, envelope(151, 0))).rejects.toThrow("quota");
      expect(await persistence.loadCommitted()).toBe(committed);
      expect(await persistence.loadJournal()).toBe(journal);
      expect(await persistence.isRecoveryCompleted()).toBe(false);
    } finally { failure.mockRestore(); }
  });

  it("does not enter local recovery mode or alter Application when the atomic write fails", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    const committed = envelope(150, 969), journal = envelope(151, 1024);
    await legacy.writeCommitted(committed); await legacy.writeJournal(journal);
    const persistence = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    const original = FakeIDBDatabase.prototype.transaction;
    const failure = vi.spyOn(FakeIDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, names, mode, options) {
      if (mode === "readwrite") throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, names, mode, options);
    });
    try {
      await expect(persistence.restoreJournalLocally(committed, journal, "2026-09-27T00:00:00.000Z")).rejects.toThrow("quota");
      expect(await persistence.isLocalRecoveryMode()).toBe(false);
      expect(await persistence.loadCommitted()).toBe(committed);
      expect(await persistence.loadJournal()).toBe(journal);
      expect(await persistence.loadLocalRecoveryEvidence()).toMatchObject({ committed: null, journal: null });
    } finally { failure.mockRestore(); }
  });

  it("fails closed when the legacy source changes after migration", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    await legacy.writeCommitted(envelope(150, 969));
    await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    await legacy.writeJournal(envelope(151, 1024));
    await expect(IndexedDbTaskMemoApplicationJournal.open("account", factory)).rejects.toThrow("旧localStorageが変更");
  });

  it("rejects invalid source without changing it", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    await legacy.writeJournal("not-json");
    await expect(IndexedDbTaskMemoApplicationJournal.open("account", factory)).rejects.toThrow();
    expect(await legacy.loadJournal()).toBe("not-json");
  });

  it("does not create an IndexedDB recovery candidate in observation-only mode", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    await legacy.writeCommitted(envelope(150, 969));
    await legacy.writeJournal(envelope(151, 1024));
    const original = new Map(storage);
    await expect(IndexedDbTaskMemoApplicationJournal.open("account", factory, { allowLegacyCopy: false })).rejects.toThrow("存在しないIndexedDB");
    expect(storage).toEqual(original);
    expect((await factory.databases()).some((item) => item.name === "taskmemo-v2-local-application")).toBe(false);
  });

  it("observes all 1024 receipts without changing either 150/151 snapshot", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    const committed = envelope(150, 969);
    const journal = envelope(151, 1024);
    await legacy.writeCommitted(committed); await legacy.writeJournal(journal);
    await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    const original = new Map(storage);
    const persistence = await IndexedDbTaskMemoApplicationJournal.open("account", factory, { allowLegacyCopy: false });
    const auditOutbox = vi.fn(async (operations: unknown[]) => ({ received: 0, missing: operations.length }));
    const adapter = { connect: vi.fn(async () => undefined), auditOutbox } as unknown as SyncAdapter;
    expect(await observePendingJournalReceipts(persistence, adapter, () => undefined)).toEqual({ hadJournal: true, auditResult: { received: 0, missing: 1024 } });
    expect(auditOutbox.mock.calls[0][0]).toHaveLength(1024);
    expect(await persistence.loadCommitted()).toBe(committed);
    expect(await persistence.loadJournal()).toBe(journal);
    expect(storage).toEqual(original);
  });

  it("leaves both legacy snapshots intact when IndexedDB cannot open", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    await legacy.writeCommitted(envelope(150, 969));
    await legacy.writeJournal(envelope(151, 1024));
    const original = new Map(storage);
    const unavailable = { open: () => { throw new DOMException("quota", "QuotaExceededError"); } } as unknown as IDBFactory;
    await expect(IndexedDbTaskMemoApplicationJournal.open("account", unavailable)).rejects.toThrow("quota");
    expect(storage).toEqual(original);
  });

  it("recovers an offline journal and retains Undo/Redo across IndexedDB restart", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    const at = new Date("2026-09-26T00:00:00.000Z");
    const memo: MemoNode = { id: "memo", type: "memo", parentId: null, sortKey: "a", title: "before", body: "", dueAt: null,
      duePreset: "none", status: "active", completedAt: null, createdAt: at, updatedAt: at, deletedAt: null };
    const original = await TaskMemoV2ApplicationStore.open(legacy, [memo], { deviceId: "device-a" });
    const committed = await legacy.loadCommitted();
    await original.command("edit", "update", (nodes) => nodes.map((node) => node.id === "memo" ? { ...node, title: "after" } : node));
    const journal = await legacy.loadCommitted();
    await legacy.writeCommitted(committed!);
    await legacy.writeJournal(journal!);
    const preserved = new Map(storage);
    const persistence = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    let recovered = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored" });
    expect(recovered.nodes.find((node) => node.id === "memo")?.title).toBe("after");
    expect(recovered.outbox).toHaveLength(1);
    expect(recovered.historyDepths.past).toBe(1);
    expect(await persistence.loadJournal()).toBeNull();
    await recovered.undo();
    expect(recovered.nodes.find((node) => node.id === "memo")?.title).toBe("before");
    recovered = await TaskMemoV2ApplicationStore.open(await IndexedDbTaskMemoApplicationJournal.open("account", factory), [], { deviceId: "ignored" });
    await recovered.redo();
    expect(recovered.nodes.find((node) => node.id === "memo")?.title).toBe("after");
    expect(storage).toEqual(preserved);
  });

  it("keeps journal data, history and post-recovery CRUD durable in a distinct outbox generation", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    const at = new Date("2026-09-26T00:00:00.000Z");
    const memo: MemoNode = { id: "memo", type: "memo", parentId: null, sortKey: "a", title: "before", body: "body", dueAt: null,
      duePreset: "none", status: "active", completedAt: null, createdAt: at, updatedAt: at, deletedAt: null };
    const seed = await TaskMemoV2ApplicationStore.open(legacy, [memo], { deviceId: "old-device" });
    const committed = (await legacy.loadCommitted())!;
    await seed.command("edit", "update", (nodes) => nodes.map((node) => node.id === "memo" ? { ...node, title: "journal title" } : node));
    await seed.command("create", "create", (nodes) => [...nodes, { ...memo, id: "new-in-journal", title: "journal new", sortKey: "b" }]);
    const journal = (await legacy.loadCommitted())!;
    await legacy.writeCommitted(committed); await legacy.writeJournal(journal);
    const persistence = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    await persistence.restoreJournalLocally(committed, journal, "2026-09-27T00:00:00.000Z");
    let recovered = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored", preserveSortKeys: true });
    expect(recovered.nodes.map((node) => node.title)).toEqual(["journal title", "journal new"]);
    expect(recovered.historyDepths.past).toBe(2);
    expect(recovered.outbox).toHaveLength(0);
    const folder = { id: "folder", type: "category" as const, parentId: null, sortKey: "c", title: "Folder",
      createdAt: at, updatedAt: at, deletedAt: null };
    await recovered.command("create", "create", (nodes) => [...nodes, folder]);
    await recovered.command("move", "update", (nodes) => nodes.map((node) => node.id === "memo" ? { ...node, parentId: "folder" } : node));
    await recovered.command("edit", "update", (nodes) => nodes.map((node) => node.id === "memo" && node.type === "memo" ? { ...node, body: "edited locally" } : node));
    await recovered.command("complete", "complete", (nodes) => nodes.map((node) => node.id === "memo" && node.type === "memo" ? { ...node, status: "completed", completedAt: at } : node));
    await recovered.command("delete", "softDelete", (nodes) => nodes.map((node) => node.id === "new-in-journal" ? { ...node, deletedAt: at } : node));
    await recovered.undo(); await recovered.redo();
    expect(recovered.outbox.length).toBeGreaterThan(0);
    const oldIds = new Set(JSON.parse(journal).sync.outbox.map((operation: { opId: string }) => operation.opId));
    expect(recovered.outbox.every((operation) => !oldIds.has(operation.opId))).toBe(true);
    const restarted = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    expect(await restarted.isLocalRecoveryMode()).toBe(true);
    recovered = await TaskMemoV2ApplicationStore.open(restarted, [], { deviceId: "ignored", preserveSortKeys: true });
    const recoveredMemo = recovered.nodes.find((node): node is MemoNode => node.id === "memo" && node.type === "memo");
    expect(recoveredMemo?.status).toBe("completed");
    expect(recoveredMemo?.body).toBe("edited locally");
    expect(recovered.nodes.find((node) => node.id === "memo")?.parentId).toBe("folder");
    expect(recovered.nodes.find((node) => node.id === "folder")?.title).toBe("Folder");
    expect(recovered.nodes.find((node) => node.id === "new-in-journal")?.deletedAt).toEqual(at);
    expect(recovered.outbox.length).toBeGreaterThan(0);
    expect(await restarted.loadLocalRecoveryEvidence()).toMatchObject({ committed, journal, archivedOutboxCount: 2 });
  });

  it("rejects a local edit when IndexedDB persistence fails, without presenting it as committed", async () => {
    const persistence = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    const at = new Date("2026-09-26T00:00:00.000Z");
    const memo: MemoNode = { id: "memo", type: "memo", parentId: null, sortKey: "a0", title: "before", body: "", dueAt: null,
      duePreset: "none", status: "active", completedAt: null, createdAt: at, updatedAt: at, deletedAt: null };
    const store = await TaskMemoV2ApplicationStore.open(persistence, [memo], { deviceId: "device-a" });
    const original = FakeIDBDatabase.prototype.transaction;
    const failure = vi.spyOn(FakeIDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, names, mode, options) {
      if (mode === "readwrite") throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, names, mode, options);
    });
    try {
      await expect(store.command("edit", "update", (nodes) => nodes.map((node) => node.id === "memo" ? { ...node, title: "after" } : node))).rejects.toThrow("quota");
      expect(store.nodes.find((node) => node.id === "memo")?.title).toBe("before");
      expect(store.outbox).toHaveLength(0);
      expect(storage.size).toBe(0);
    } finally { failure.mockRestore(); }
  });
});
