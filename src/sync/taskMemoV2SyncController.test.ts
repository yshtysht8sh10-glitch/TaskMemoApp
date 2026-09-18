import { describe, expect, it } from "vitest";
import type { MemoNode } from "../models/node";
import type { ApplicationJournalPersistence } from "./applicationStore";
import { InMemoryRevisionServer } from "./revisionModel";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import { TaskMemoV2SyncController } from "./taskMemoV2SyncController";
import type { SyncAdapter, SyncOperation, VersionedNode } from "./types";

class MemoryPersistence implements ApplicationJournalPersistence { value: string | null = null; journal: string | null = null; loadCommitted = async () => this.value; loadJournal = async () => this.journal; writeJournal = async (v: string) => { this.journal = v; }; writeCommitted = async (v: string) => { this.value = v; }; clearJournal = async () => { this.journal = null; }; }
class ListenerAdapter implements SyncAdapter {
  server = new InMemoryRevisionServer(); listeners = new Set<(record: VersionedNode) => void | Promise<void>>(); online = true;
  async connect() { if (!this.online) throw { kind: "offline" }; }
  subscribe(onRecord: (record: VersionedNode) => void | Promise<void>) { this.listeners.add(onRecord); for (const id of ["memo-a"]) { const record = this.server.get(id); if (record) void onRecord(record); } return () => { this.listeners.delete(onRecord); }; }
  async upload(operation: SyncOperation) { if (!this.online) throw { kind: "offline" }; const ack = this.server.apply(operation); if (ack.record) for (const listener of this.listeners) await listener(ack.record); return ack; }
  async replay(id: string) { const record = this.server.get(id); if (record) for (const listener of this.listeners) await listener(record); }
}
const memo = (): MemoNode => ({ id: "memo-a", type: "memo", parentId: null, sortKey: "a", title: "A", body: "", dueAt: null, duePreset: "none", status: "active", completedAt: null, createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null });

describe("V2 listener controller", () => {
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
