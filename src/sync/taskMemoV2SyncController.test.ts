import { describe, expect, it, vi } from "vitest";
import { createNode } from "../domain/nodeOperations";
import type { CategoryNode, MemoNode } from "../models/node";
import type { ApplicationJournalPersistence } from "./applicationStore";
import { InMemoryRevisionServer } from "./revisionModel";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import { TaskMemoV2SyncController } from "./taskMemoV2SyncController";
import { nodeToV2Value } from "./nodeV2Codec";
import type { SyncAdapter, SyncOperation, VersionedNode, VersionedPinnedNote } from "./types";

class MemoryPersistence implements ApplicationJournalPersistence { value: string | null = null; journal: string | null = null; loadCommitted = async () => this.value; loadJournal = async () => this.journal; writeJournal = async (v: string) => { this.journal = v; }; writeCommitted = async (v: string) => { this.value = v; }; clearJournal = async () => { this.journal = null; }; }
class ListenerAdapter implements SyncAdapter {
  server = new InMemoryRevisionServer(); listeners = new Set<(record: VersionedNode) => void | Promise<void>>(); pinnedListeners = new Set<(record: VersionedPinnedNote) => void | Promise<void>>(); online = true; uploads: SyncOperation[] = []; initialIds = ["memo-a"];
  async connect() { if (!this.online) throw { kind: "offline" }; }
  subscribe(onRecord: (record: VersionedNode) => void | Promise<void>) { this.listeners.add(onRecord); for (const id of this.initialIds) { const record = this.server.get(id); if (record) void onRecord(record); } return () => { this.listeners.delete(onRecord); }; }
  async upload(operation: SyncOperation) { if (!this.online) throw { kind: "offline" }; this.uploads.push(operation); const ack = this.server.apply(operation); if (ack.record) for (const listener of this.listeners) await listener(ack.record); if (ack.pinnedNoteRecord) for (const listener of this.pinnedListeners) await listener(ack.pinnedNoteRecord); return ack; }
  async readPinnedNote() { return this.server.getPinnedNote(); }
  subscribePinnedNote(onRecord: (record: VersionedPinnedNote) => void | Promise<void>) { this.pinnedListeners.add(onRecord); const record = this.server.getPinnedNote(); if (record) void onRecord(record); return () => { this.pinnedListeners.delete(onRecord); }; }
  async replay(id: string) { const record = this.server.get(id); if (record) for (const listener of this.listeners) await listener(record); }
}
const memo = (): MemoNode => ({ id: "memo-a", type: "memo", parentId: null, sortKey: "a", title: "A", body: "", dueAt: null, duePreset: "none", status: "active", completedAt: null, createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null });
const provisionedRoutineRoot = (): CategoryNode => ({ id: "system-routine", type: "category", categoryKind: "routineRoot", parentId: null, sortKey: "zzzz", title: "ルーティーン", createdAt: new Date("2026-09-19T00:00:00.000Z"), updatedAt: new Date("2026-09-19T00:00:00.000Z"), deletedAt: null });

describe("V2 listener controller", () => {
  it("repairs and uploads an invalid remote sort key instead of retaining it authoritatively", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a" });
    const root = provisionedRoutineRoot();
    const incoming: VersionedNode = { value: nodeToV2Value(root), revision: 0, lastOpId: "legacy-root", lastDeviceId: "migration", lastLocalSeq: 0, operationType: "import" };
    const adapter = new ListenerAdapter();
    adapter.server = new InMemoryRevisionServer([incoming]); adapter.initialIds = ["system-routine"];
    const controller = new TaskMemoV2SyncController(store, adapter);

    await controller.start();
    await vi.waitFor(() => expect(adapter.uploads.some((operation) => operation.targetNodeId === "system-routine")).toBe(true));

    expect(store.nodes[0].sortKey).not.toBe("zzzz");
    expect(adapter.server.get("system-routine")?.value.sortKey).not.toBe("zzzz");
  });

  it("keeps a UI-created memo durable after receiving the provisioned RC routine root", async () => {
    const persistence = new MemoryPersistence();
    const store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "device-a" });
    const root = provisionedRoutineRoot();
    await store.receive({ value: nodeToV2Value(root), revision: 0, lastOpId: "migration:v2-rc-20260919:system-routine", lastDeviceId: "migration:v2-rc-20260919", lastLocalSeq: 0, operationType: "import" });
    expect(store.nodes[0].sortKey).not.toBe("zzzz");
    expect(store.outbox).toHaveLength(1);
    let applicationNodes = store.nodes;
    const adapter = new ListenerAdapter();
    const controller = new TaskMemoV2SyncController(store, adapter, () => {
      applicationNodes = store.nodes;
    });

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
