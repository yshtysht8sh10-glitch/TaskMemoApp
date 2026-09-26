import { IDBDatabase as FakeIDBDatabase, IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IndexedDbTaskMemoApplicationJournal } from "./indexedDbApplicationStorage";
import { TaskMemoV2ApplicationJournal } from "./applicationStorage";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import type { MemoNode } from "../models/node";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
} }));

const envelope = (nodes: number, outbox: number) => JSON.stringify({
  version: 2, deviceId: "device-a", domain: Object.fromEntries(Array.from({ length: nodes }, (_, i) => [`n${i}`, { value: { id: `n${i}` } }])),
  history: { past: [{ commandId: "old" }], future: [] },
  sync: { outbox: Array.from({ length: outbox }, (_, i) => ({ opId: `op${i}` })), seenOpIds: [] },
});

describe("IndexedDB V2 migration", () => {
  let factory: IDBFactory;
  beforeEach(() => { storage.clear(); factory = new IDBFactory(); });

  it("copies committed 150 and journal 151 exactly, retains legacy, and survives restart", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    const committed = envelope(150, 969);
    const journal = envelope(151, 1024);
    await legacy.writeCommitted(committed); await legacy.writeJournal(journal);
    const original = new Map(storage);
    const migrated = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    expect(await migrated.loadCommitted()).toBe(committed);
    expect(await migrated.loadJournal()).toBe(journal);
    await migrated.writeCommitted(journal);
    await migrated.clearJournal();
    const reopened = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
    expect(await reopened.loadCommitted()).toBe(journal);
    expect(await reopened.loadJournal()).toBeNull();
    expect(storage).toEqual(original);
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
