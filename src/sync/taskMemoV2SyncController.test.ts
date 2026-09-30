import { describe, expect, it, vi } from "vitest";
import { createNode } from "../domain/nodeOperations";
import type { CategoryNode, MemoNode } from "../models/node";
import type { ApplicationJournalPersistence } from "./applicationStore";
import { InMemoryRevisionServer } from "./revisionModel";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import { TaskMemoV2SyncController } from "./taskMemoV2SyncController";
import { nodeToV2Value } from "./nodeV2Codec";
import type { SyncAdapter, SyncOperation, VersionedFeatures, VersionedNode, VersionedPinnedNote } from "./types";

class MemoryPersistence implements ApplicationJournalPersistence { value: string | null = null; journal: string | null = null; loadCommitted = async () => this.value; loadJournal = async () => this.journal; writeJournal = async (v: string) => { this.journal = v; }; writeCommitted = async (v: string) => { this.value = v; }; clearJournal = async () => { this.journal = null; }; }
class ListenerAdapter implements SyncAdapter {
  auditOutbox?: SyncAdapter["auditOutbox"];
  server = new InMemoryRevisionServer(); listeners = new Set<(record: VersionedNode) => void | Promise<void>>(); pinnedListeners = new Set<(record: VersionedPinnedNote) => void | Promise<void>>(); featureListeners = new Set<(record: VersionedFeatures) => void | Promise<void>>(); online = true; uploads: SyncOperation[] = []; initialIds = ["memo-a"];
  async connect() { if (!this.online) throw { kind: "offline" }; }
  subscribe(onRecord: (record: VersionedNode) => void | Promise<void>) { this.listeners.add(onRecord); for (const id of this.initialIds) { const record = this.server.get(id); if (record) void onRecord(record); } return () => { this.listeners.delete(onRecord); }; }
  async upload(operation: SyncOperation) { if (!this.online) throw { kind: "offline" }; this.uploads.push(operation); const ack = this.server.apply(operation); if (ack.record) for (const listener of this.listeners) await listener(ack.record); if (ack.pinnedNoteRecord) for (const listener of this.pinnedListeners) await listener(ack.pinnedNoteRecord); if (ack.featuresRecord) for (const listener of this.featureListeners) await listener(ack.featuresRecord); return ack; }
  async readPinnedNote() { return this.server.getPinnedNote(); }
  subscribePinnedNote(onRecord: (record: VersionedPinnedNote) => void | Promise<void>) { this.pinnedListeners.add(onRecord); const record = this.server.getPinnedNote(); if (record) void onRecord(record); return () => { this.pinnedListeners.delete(onRecord); }; }
  async readFeatures() { return this.server.getFeatures(); }
  subscribeFeatures(onRecord: (record: VersionedFeatures) => void | Promise<void>) { this.featureListeners.add(onRecord); const record = this.server.getFeatures(); if (record) void onRecord(record); return () => { this.featureListeners.delete(onRecord); }; }
  async replay(id: string) { const record = this.server.get(id); if (record) for (const listener of this.listeners) await listener(record); }
}
const memo = (): MemoNode => ({ id: "memo-a", type: "memo", parentId: null, sortKey: "a", title: "A", body: "", dueAt: null, duePreset: "none", status: "active", completedAt: null, createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null });
const provisionedRoutineRoot = (): CategoryNode => ({ id: "system-routine", type: "category", categoryKind: "routineRoot", parentId: null, sortKey: "zzzz", title: "ルーティーン", createdAt: new Date("2026-09-19T00:00:00.000Z"), updatedAt: new Date("2026-09-19T00:00:00.000Z"), deletedAt: null });

describe("V2 listener controller", () => {
  it("confirms local persistence without waiting for a stalled upload and rejects a failed write", async () => {
    const persistence = new MemoryPersistence();
    const store = await TaskMemoV2ApplicationStore.open(persistence, [memo()], { deviceId: "device-a" });
    const adapter = new ListenerAdapter();
    const controller = new TaskMemoV2SyncController(store, adapter);
    await controller.start();
    adapter.upload = async () => new Promise(() => undefined);
    await controller.commandLocal("edit", "update", nodes => nodes.map(node => ({ ...node, title: "B" })));
    expect(store.nodes[0].title).toBe("B");
    persistence.writeJournal = async () => { throw new DOMException("quota", "QuotaExceededError"); };
    await expect(controller.commandLocal("edit", "update", nodes => nodes.map(node => ({ ...node, title: "C" })))).rejects.toThrow("quota");
    expect(store.nodes[0].title).toBe("B");
  });
  it("stop prevents every subsequent upload after the in-flight operation settles", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a" });
    await store.command("create", "create", () => [{ ...memo(), sortKey: "a0" }, { ...memo(), id: "memo-b", sortKey: "a1" }, { ...memo(), id: "memo-c", sortKey: "a2" }]);
    const adapter = new ListenerAdapter();
    let release!: () => void;
    adapter.auditOutbox = async operations => ({ received: 0, missing: operations.length });
    const original = adapter.upload.bind(adapter);
    adapter.upload = async (operation) => {
      if (operation.targetNodeId === "memo-a") await new Promise<void>(resolve => { release = resolve; });
      return original(operation);
    };
    const controller = new TaskMemoV2SyncController(store, adapter);
    const flushing = controller.start();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    controller.stop(); release(); await flushing;
    expect(adapter.uploads.map(op => op.targetNodeId)).toEqual(["memo-a"]);
    expect(store.outbox.map(op => op.targetNodeId)).toEqual(["memo-b", "memo-c"]);
  });
  it("start after stop waits for the old in-flight upload and never runs two loops", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a" });
    await store.command("create", "create", () => [{ ...memo(), sortKey: "a0" }, { ...memo(), id: "memo-b", sortKey: "a1" }]);
    const adapter = new ListenerAdapter();
    adapter.auditOutbox = async operations => ({ received: 0, missing: operations.length });
    const original = adapter.upload.bind(adapter);
    let release!: () => void;
    let active = 0;
    let maxActive = 0;
    adapter.upload = async operation => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (operation.targetNodeId === "memo-a") await new Promise<void>(resolve => { release = resolve; });
      try { return await original(operation); } finally { active--; }
    };
    const controller = new TaskMemoV2SyncController(store, adapter);
    const oldStart = controller.start();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    controller.stop();
    const newStart = controller.start();
    release();
    await Promise.all([oldStart, newStart]);
    expect(maxActive).toBe(1);
    expect(adapter.uploads.map(op => op.targetNodeId)).toEqual(["memo-a", "memo-b"]);
  });
  it("keeps local-only edits durable without connecting, listening, auditing, or uploading after restart", async () => {
    const persistence = new MemoryPersistence();
    let store = await TaskMemoV2ApplicationStore.open(persistence, [memo()], { deviceId: "local-generation" });
    const adapter = new ListenerAdapter();
    adapter.auditOutbox = vi.fn(async () => { throw new Error("must not audit"); });
    const connect = vi.spyOn(adapter, "connect");
    const subscribe = vi.spyOn(adapter, "subscribe");
    let controller = new TaskMemoV2SyncController(store, adapter, () => undefined, { localOnly: true });
    await controller.start();
    await controller.command("edit", "update", (nodes) => nodes.map((node) => node.id === "memo-a" ? { ...node, title: "local edit" } : node));
    await controller.undo();
    await controller.redo();
    expect(store.nodes.find((node) => node.id === "memo-a")?.title).toBe("local edit");
    expect(store.outbox.length).toBeGreaterThan(0);
    expect(adapter.uploads).toHaveLength(0);
    expect(connect).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(adapter.auditOutbox).not.toHaveBeenCalled();
    store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored", preserveSortKeys: true });
    controller = new TaskMemoV2SyncController(store, adapter, () => undefined, { localOnly: true });
    await controller.start();
    expect(store.nodes.find((node) => node.id === "memo-a")?.title).toBe("local edit");
    expect(store.outbox.length).toBeGreaterThan(0);
    expect(connect).not.toHaveBeenCalled();
    await controller.resume();
    expect(connect).not.toHaveBeenCalled();
  });
  it("does not upload, subscribe, or mutate profiles when receipt audit is contradictory", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [memo()], { deviceId: "device-a" });
    await store.command("edit", "update", (nodes) => nodes.map((node) => node.id === "memo-a" ? { ...node, title: "edited" } : node));
    const adapter = new ListenerAdapter();
    const audit = vi.fn(async () => { throw { kind: "permanent", message: "receipt mismatch" }; });
    adapter.auditOutbox = audit;
    const subscribe = vi.spyOn(adapter, "subscribe");
    const controller = new TaskMemoV2SyncController(store, adapter);
    await controller.start();
    expect(audit).toHaveBeenCalledWith(store.outbox);
    expect(adapter.uploads).toHaveLength(0);
    expect(subscribe).not.toHaveBeenCalled();
    expect(controller.state.phase).toBe("error");
    await controller.flush();
    expect(adapter.uploads).toHaveLength(0);
  });
  it("syncs ideasEnabled both ways without adding History and restores an offline change after restart", async () => {
    const adapter = new ListenerAdapter();
    const persistenceA = new MemoryPersistence();
    let a = await TaskMemoV2ApplicationStore.open(persistenceA, [], { deviceId: "device-a", initialIdeasEnabled: false });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-b", initialIdeasEnabled: false });
    let ca = new TaskMemoV2SyncController(a, adapter);
    const cb = new TaskMemoV2SyncController(b, adapter);
    await Promise.all([ca.start(), cb.start()]);
    const depths = a.historyDepths;
    await ca.updateIdeasEnabled(true);
    await vi.waitFor(() => expect(b.ideasEnabled).toBe(true));
    expect(a.historyDepths).toEqual(depths);
    await cb.updateIdeasEnabled(false);
    await vi.waitFor(() => expect(a.ideasEnabled).toBe(false));
    ca.pause();
    await a.setIdeasEnabled(true, "import");
    expect(a.outbox).toHaveLength(1);
    a = await TaskMemoV2ApplicationStore.open(persistenceA, [], { deviceId: "ignored" });
    ca = new TaskMemoV2SyncController(a, adapter);
    await ca.start();
    await vi.waitFor(() => expect(b.ideasEnabled).toBe(true));
    expect(a.outbox).toHaveLength(0);
  });
  it("adopts a legacy pinned-note candidate through the normal V2 operation", async () => {
    const adapter = new ListenerAdapter();
    const seed = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "seed", initialPinnedNote: { body: "cloud", updatedAt: new Date(0) } });
    await seed.initializePinnedNote(); await seed.queuePinnedNoteOperation(); adapter.server.apply(seed.outbox[0]);
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a", initialPinnedNote: { body: "legacy", updatedAt: new Date(0) } });
    const controller = new TaskMemoV2SyncController(store, adapter);
    await controller.start();
    const candidate = store.legacyPinnedNoteCandidates[0];
    expect(candidate.body).toBe("legacy");
    await controller.adoptLegacyPinnedNoteCandidate(candidate);
    expect(store.legacyPinnedNoteCandidates).toEqual([]);
    expect(store.pinnedNote.body).toBe("legacy");
    expect(adapter.uploads.some((operation) => operation.targetType === "pinnedNote" && (operation.payload.pinnedNote as { body?: string })?.body === "legacy")).toBe(true);
  });
  it("does not upload a remote-origin sortKey correction as a user edit", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a" });
    const root = provisionedRoutineRoot();
    const incoming: VersionedNode = { value: nodeToV2Value(root), revision: 0, lastOpId: "legacy-root", lastDeviceId: "migration", lastLocalSeq: 0, operationType: "import" };
    const adapter = new ListenerAdapter();
    adapter.server = new InMemoryRevisionServer([incoming]); adapter.initialIds = ["system-routine"];
    const controller = new TaskMemoV2SyncController(store, adapter);

    await controller.start();
    await vi.waitFor(() => expect(store.nodes.some(node => node.id === "system-routine")).toBe(true));
    expect(adapter.uploads).toHaveLength(0);
    expect(store.nodes[0].sortKey).toBe("zzzz");
    expect(adapter.server.get("system-routine")?.value.sortKey).toBe("zzzz");
  });

  it("keeps a UI-created memo durable after receiving the provisioned RC routine root", async () => {
    const persistence = new MemoryPersistence();
    const store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "device-a" });
    const root = provisionedRoutineRoot();
    await store.receive({ value: nodeToV2Value(root), revision: 0, lastOpId: "migration:v2-rc-20260919:system-routine", lastDeviceId: "migration:v2-rc-20260919", lastLocalSeq: 0, operationType: "import" });
    expect(store.nodes[0].sortKey).toBe("zzzz");
    expect(store.outbox).toHaveLength(0);
    let applicationNodes = store.nodes;
    const adapter = new ListenerAdapter();
    const controller = new TaskMemoV2SyncController(store, adapter, () => {
      applicationNodes = store.nodes;
    });
    await controller.start();

    await controller.command("Nodeを作成", "create", (nodes) =>
      createNode(nodes, "memo", { title: "new memo", parentId: null }, new Date("2026-09-19T05:52:50.700Z"), "memo-new"),
    );

    expect(applicationNodes.some((node) => node.id === "memo-new")).toBe(true);
    expect(store.nodes.some((node) => node.id === "memo-new")).toBe(true);
    expect(JSON.parse(persistence.value!).domain["memo-new"]).toBeDefined();
    expect(adapter.uploads.some((operation) => operation.targetNodeId === "memo-new")).toBe(true);
  });

  it("persists and queues memo creation under a real category", async () => {
    const persistence = new MemoryPersistence();
    const category: CategoryNode = { ...provisionedRoutineRoot(), id: "category-a", categoryKind: undefined, sortKey: "a0", title: "Category" };
    const store = await TaskMemoV2ApplicationStore.open(persistence, [category], { deviceId: "device-a" });
    const controller = new TaskMemoV2SyncController(store, new ListenerAdapter());
    controller.pause();
    await controller.command("Nodeを作成", "create", (nodes) =>
      createNode(nodes, "memo", { title: "child", parentId: "category-a" }, new Date("2026-09-19T05:52:50.700Z"), "memo-child"),
    );
    expect(store.nodes.find((node) => node.id === "memo-child")?.parentId).toBe("category-a");
    expect(JSON.parse(persistence.value!).domain["memo-child"]).toBeDefined();
    expect(store.outbox.some((operation) => operation.targetNodeId === "memo-child")).toBe(true);
  });

  it("persists and queues memo creation through the virtual unassigned root", async () => {
    const persistence = new MemoryPersistence();
    const store = await TaskMemoV2ApplicationStore.open(persistence, [provisionedRoutineRoot()], { deviceId: "device-a" });
    const controller = new TaskMemoV2SyncController(store, new ListenerAdapter());
    controller.pause();
    await controller.command("Nodeを作成", "create", (nodes) =>
      createNode(nodes, "memo", { title: "unassigned", parentId: null }, new Date("2026-09-19T05:52:50.700Z"), "memo-unassigned"),
    );
    expect(store.nodes.find((node) => node.id === "memo-unassigned")?.parentId).toBeNull();
    expect(JSON.parse(persistence.value!).domain["memo-unassigned"]).toBeDefined();
    expect(store.outbox.some((operation) => operation.targetNodeId === "memo-unassigned")).toBe(true);
  });

  it("does not subscribe after stop while connection is still resolving", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a" });
    const adapter = new ListenerAdapter();
    let release!: () => void;
    adapter.connect = () => new Promise<void>(resolve => { release = resolve; });
    const controller = new TaskMemoV2SyncController(store, adapter);
    const connecting = controller.start(); controller.stop(); release(); await connecting;
    expect(adapter.listeners.size).toBe(0);
  });
  it("publishes durable local edits before a stalled upload and drains edits queued during upload", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [memo()], { deviceId: "device-a" });
    const adapter = new ListenerAdapter();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const upload = adapter.upload.bind(adapter);
    let uploads = 0;
    adapter.upload = async operation => { if (++uploads === 1) await held; return upload(operation); };
    const titles: string[] = [];
    const controller = new TaskMemoV2SyncController(store, adapter, () => { titles.push(store.nodes[0].title); });
    await controller.start();
    const first = controller.command("edit", "update", nodes => nodes.map(node => ({ ...node, title: "B" })));
    await new Promise(resolve => setTimeout(resolve, 20));
    const publishedBeforeNetwork = titles.includes("B");
    await controller.command("edit again", "update", nodes => nodes.map(node => ({ ...node, title: "C" })));
    release(); await first;
    expect(publishedBeforeNetwork).toBe(true);
    expect(store.outbox).toHaveLength(0);
    expect(adapter.server.get("memo-a")?.value.title).toBe("C");
  });
  it("keeps UI edits in the outbox while paused and flushes them on resume", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [memo()], { deviceId: "device-a" });
    const adapter = new ListenerAdapter(); const controller = new TaskMemoV2SyncController(store, adapter);
    await controller.start(); controller.pause();
    await controller.command("offline", "update", nodes => nodes.map(node => ({ ...node, title: "offline" })));
    expect(controller.state.phase).toBe("offline"); expect(store.outbox).toHaveLength(1);
    expect(adapter.server.get("memo-a")).toBeUndefined();
    await controller.resume();
    expect(store.outbox).toHaveLength(0); expect(adapter.server.get("memo-a")?.value.title).toBe("offline");
  });
  it("persists pinned-note input before debounce and flushes it after reconnect", async () => {
    vi.useFakeTimers();
    try {
      const persistence = new MemoryPersistence(); const adapter = new ListenerAdapter();
      let store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "device-a" });
      let controller = new TaskMemoV2SyncController(store, adapter); await controller.start();
      await controller.updatePinnedNote("offline draft", 500);
      expect(store.pinnedNote.body).toBe("offline draft"); expect(store.outbox).toHaveLength(0); expect(controller.state.phase).toBe("pending");
      controller.stop();
      store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored" });
      expect(store.pinnedNote.body).toBe("offline draft");
      controller = new TaskMemoV2SyncController(store, adapter); await controller.start();
      expect(adapter.server.getPinnedNote()?.value.body).toBe("offline draft");
      expect(store.outbox).toHaveLength(0); expect(controller.state.phase).toBe("synced");
    } finally { vi.useRealTimers(); }
  });
  it("keeps a debounced pinned-note operation offline and sends it on resume", async () => {
    vi.useFakeTimers();
    try {
      const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a" });
      const adapter = new ListenerAdapter(); const controller = new TaskMemoV2SyncController(store, adapter);
      await controller.start(); controller.pause();
      await controller.updatePinnedNote("offline", 500);
      await vi.advanceTimersByTimeAsync(500);
      expect(store.outbox).toHaveLength(1); expect(adapter.server.getPinnedNote()).toBeUndefined();
      await controller.resume();
      expect(store.outbox).toHaveLength(0); expect(adapter.server.getPinnedNote()?.value.body).toBe("offline");
    } finally { vi.useRealTimers(); }
  });
  it("self echo and replay do not change history or create operations, and pending never reports synced", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [memo()], { deviceId: "device-a" });
    const adapter = new ListenerAdapter(); const controller = new TaskMemoV2SyncController(store, adapter);
    await controller.start();
    await store.command("edit", "update", (nodes) => nodes.map((node) => ({ ...node, title: "B" })));
    expect(controller.state.phase).toBe("synced");
    await controller.flush();
    const depths = store.historyDepths;
    await adapter.replay("memo-a"); await adapter.replay("memo-a");
    expect(store.historyDepths).toEqual(depths);
    expect(store.outbox).toHaveLength(0);
    expect(controller.state).toMatchObject({ phase: "synced", pendingCount: 0 });
  });

  it("disconnect, offline edit, restart, reconnect and listener replay converge", async () => {
    const persistence = new MemoryPersistence(); const adapter = new ListenerAdapter();
    let store = await TaskMemoV2ApplicationStore.open(persistence, [memo()], { deviceId: "device-a" });
    let controller = new TaskMemoV2SyncController(store, adapter); await controller.start(); controller.stop(); adapter.online = false;
    await store.command("offline edit", "update", (nodes) => nodes.map((node) => ({ ...node, title: "B" })));
    await controller.flush(); expect(store.outbox).toHaveLength(1); expect(controller.state.phase).not.toBe("synced");
    store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored" });
    adapter.online = true; controller = new TaskMemoV2SyncController(store, adapter); await controller.start();
    expect(store.nodes[0].title).toBe("B"); expect(store.outbox).toHaveLength(0); expect(controller.state.phase).toBe("synced");
  });
});
