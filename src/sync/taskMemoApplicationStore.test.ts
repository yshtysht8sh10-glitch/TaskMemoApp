import { describe, expect, it } from "vitest";

import { completeMemo, createNode, hardDeleteNode, moveNode, restoreMemo, restoreNode, softDeleteNode, updateNode } from "../domain/nodeOperations";
import type { MemoNode, Node } from "../models/node";
import type { ApplicationJournalPersistence } from "./applicationStore";
import { InMemoryRevisionServer } from "./revisionModel";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";

class MemoryPersistence implements ApplicationJournalPersistence {
  committed: string | null = null; journal: string | null = null; failCommit = false;
  loadCommitted = async () => this.committed; loadJournal = async () => this.journal;
  writeJournal = async (value: string) => { this.journal = value; };
  writeCommitted = async (value: string) => { if (this.failCommit) throw new Error("crash"); this.committed = value; };
  clearJournal = async () => { this.journal = null; };
}

const at = (ms: number) => new Date(`2026-09-18T00:00:${String(ms).padStart(2, "0")}.000Z`);
const initialMemo = (): MemoNode => ({ id: "memo-a", type: "memo", memoType: "task", parentId: null, sortKey: "a0", deadlineSortKey: "d0", title: "A", body: "body", dueAt: null, duePreset: "none", status: "active", completedAt: null, repeatRule: null, routineHistory: { "2026-09-17": at(1).toISOString() }, createdAt: at(0), updatedAt: at(0), deletedAt: null, deletionBatchId: null, purgedAt: null });
const unrelatedMemo = (): MemoNode => ({ ...initialMemo(), id: "memo-b", sortKey: "b0", title: "B", routineHistory: {} });

describe("TaskMemo V2 application store", () => {
  it("serializes overlapping UI commands without losing history, fields, or operation IDs", async () => {
    const persistence = new MemoryPersistence();
    const store = await TaskMemoV2ApplicationStore.open(persistence, [initialMemo()], { deviceId: "device-a" });
    await Promise.all([
      store.command("title", "update", nodes => updateNode(nodes, "memo-a", { title: "B" }, at(1))),
      store.command("body", "update", nodes => updateNode(nodes, "memo-a", { body: "new body" }, at(2))),
    ]);
    expect(store.nodes[0]).toMatchObject({ title: "B", body: "new body" });
    expect(store.historyDepths).toEqual({ past: 2, future: 0 });
    expect(store.outbox.map(op => op.opId)).toEqual(["device-a:1", "device-a:2"]);
    const reopened = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored" });
    expect(reopened.nodes).toEqual(store.nodes);
  });
  it("persists real create/edit/move/deadline/complete/delete/restore/purge commands with full fields", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-a", now: () => at(9) });
    await store.command("Category追加", "create", (nodes) => createNode(nodes, "category", { title: "C", parentId: null }, at(1), "category-a"));
    await store.command("移動", "update", (nodes) => moveNode(nodes, "memo-a", "category-a", undefined, at(2)));
    await store.command("編集", "update", (nodes) => updateNode(nodes, "memo-a", { title: "B", dueAt: at(3), duePreset: "afternoon" }, at(3)));
    await store.command("完了", "complete", (nodes) => completeMemo(nodes, "memo-a", at(4)));
    await store.command("完了取消", "uncomplete", (nodes) => restoreMemo(nodes, "memo-a", at(5)));
    await store.command("削除", "softDelete", (nodes) => softDeleteNode(nodes, "memo-a", false, at(6)));
    await store.command("復元", "restore", (nodes) => restoreNode(nodes, "memo-a", at(7)));
    await store.command("完全削除", "purge", (nodes) => hardDeleteNode(nodes, "memo-a", at(8)));
    const memo = store.nodes.find((node) => node.id === "memo-a") as MemoNode;
    expect(memo).toMatchObject({ parentId: "category-a", title: "B", duePreset: "afternoon", purgedAt: at(8), deadlineSortKey: "d0", routineHistory: { "2026-09-17": at(1).toISOString() } });
    expect(store.outbox.every((operation) => operation.payload.node)).toBe(true);
  });

  it("keeps Undo/Redo history across self echoes and models both as new operations", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-a", now: () => at(9) });
    await store.command("編集", "update", (nodes) => updateNode(nodes, "memo-a", { title: "B" }, at(1)));
    const edit = store.outbox.at(-1)!;
    const depths = store.historyDepths;
    expect(await store.receive(store.versionedNode("memo-a")!)).toBe("self-echo");
    expect(store.historyDepths).toEqual(depths);
    expect(store.outbox.some((operation) => operation.opId === edit.opId)).toBe(false);
    await store.undo(at(2));
    await store.redo(at(3));
    expect(store.nodes[0].title).toBe("B");
    expect(store.outbox.slice(-2).map((operation) => operation.type)).toEqual(["undo", "redo"]);
    expect(store.historyDepths).toEqual({ past: 1, future: 0 });
  });

  it.each([
    ["Category", { id: "category", type: "category", parentId: null, sortKey: "a0", title: "before", createdAt: at(0), updatedAt: at(0), deletedAt: null } as Node],
    ["Idea", { ...initialMemo(), id: "idea", memoType: "idea", title: "before" } as Node],
  ])("undoes and redoes a %s update through delta History", async (_name, node) => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [node], { deviceId: "device-a", now: () => at(9) });
    await store.command("edit", "update", nodes => updateNode(nodes, node.id, { title: "after" }, at(1)));
    await store.undo(at(2)); expect(store.nodes[0].title).toBe("before");
    await store.redo(at(3)); expect(store.nodes[0].title).toBe("after");
  });

  it("undoes and redoes Routine completion through delta History", async () => {
    const root: Node = { id: "routine", type: "category", categoryKind: "routineRoot", parentId: null, sortKey: "a0", title: "Routine", createdAt: at(0), updatedAt: at(0), deletedAt: null };
    const memo: MemoNode = { ...initialMemo(), id: "routine-memo", parentId: "routine", repeatRule: { frequency: "day", interval: 1, startsOn: "2026-09-18" }, routineHistory: {} };
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [root, memo], { deviceId: "device-a", now: () => at(9) });
    await store.command("complete routine", "complete", nodes => completeMemo(nodes, "routine-memo", at(1)));
    expect((store.nodes.find(node => node.id === "routine-memo") as MemoNode).routineHistory).not.toEqual({});
    await store.undo(at(2)); expect((store.nodes.find(node => node.id === "routine-memo") as MemoNode).routineHistory).toEqual({});
    await store.redo(at(3)); expect((store.nodes.find(node => node.id === "routine-memo") as MemoNode).routineHistory).not.toEqual({});
  });

  it("keeps soft delete and restore undoable but never records purge in History", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-a", now: () => at(9) });
    await store.command("delete", "softDelete", nodes => softDeleteNode(nodes, "memo-a", false, at(1)));
    await store.undo(at(2)); expect(store.nodes[0].deletedAt).toBeNull();
    await store.redo(at(3)); expect(store.nodes[0].deletedAt).toEqual(at(1));
    await store.command("restore", "restore", nodes => restoreNode(nodes, "memo-a", at(4)));
    await store.undo(at(5)); expect(store.nodes[0].deletedAt).toEqual(at(1));
    await store.redo(at(6)); expect(store.nodes[0].deletedAt).toBeNull();
    const depth = store.historyDepths;
    await store.command("purge", "purge", nodes => hardDeleteNode(nodes, "memo-a", at(7)));
    expect(store.historyDepths).toEqual(depth);
  });

  it("represents Undo of create as a synchronized soft tombstone and Redo as a newer restore", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a", now: () => at(9) });
    await store.command("作成", "create", (nodes) => createNode(nodes, "memo", { title: "new", parentId: null }, at(1), "new"));
    await store.undo(at(2));
    expect(store.nodes.find((node) => node.id === "new")?.deletedAt).toEqual(at(2));
    expect(store.outbox.at(-1)).toMatchObject({ type: "undo", payload: { node: { id: "new", deletedAt: at(2).toISOString() } } });
    await store.redo(at(3));
    expect(store.nodes.find((node) => node.id === "new")).toMatchObject({ title: "new", deletedAt: null });
    expect(store.versionedNode("new")?.revision).toBe(3);
  });

  it("recovers a multi-node command and all matching operations from the WAL", async () => {
    const persistence = new MemoryPersistence();
    const category: Node = { id: "category-a", type: "category", parentId: null, sortKey: "a0", title: "C", createdAt: at(0), updatedAt: at(0), deletedAt: null };
    const child = { ...initialMemo(), parentId: "category-a" };
    const store = await TaskMemoV2ApplicationStore.open(persistence, [category, child], { deviceId: "device-a", now: () => at(9) });
    persistence.failCommit = true;
    await expect(store.command("一括削除", "softDelete", (nodes) => softDeleteNode(nodes, "category-a", true, at(1)))).rejects.toThrow("crash");
    persistence.failCommit = false;
    const recovered = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored", now: () => at(9) });
    expect(recovered.nodes.every((node) => node.deletedAt)).toBe(true);
    expect(recovered.outbox).toHaveLength(2);
  });

  it("can bootstrap existing local Nodes as durable import operations for first dev login", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-a", now: () => at(9), bootstrapInitialNodes: true });
    expect(store.outbox).toHaveLength(1);
    expect(store.outbox[0]).toMatchObject({ type: "import", targetNodeId: "memo-a", baseRevision: 0 });
    expect(store.versionedNode("memo-a")?.revision).toBe(1);
  });

  it("two devices converge under reverse and duplicate delivery, including purge against stale child edit", async () => {
    const category: Node = { id: "category-a", type: "category", parentId: null, sortKey: "a0", title: "C", createdAt: at(0), updatedAt: at(0), deletedAt: null };
    const child = { ...initialMemo(), parentId: "category-a" };
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [category, child], { deviceId: "device-a", now: () => at(9) });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [category, child], { deviceId: "device-b", now: () => at(9) });
    await a.command("完全削除", "purge", (nodes) => hardDeleteNode(nodes, "category-a", at(2)));
    await b.command("offline編集", "update", (nodes) => updateNode(nodes, "memo-a", { title: "stale" }, at(3)));
    const server = new InMemoryRevisionServer();
    const operations = [...a.outbox, ...b.outbox];
    for (const operation of [...operations].reverse()) server.apply(operation);
    for (const operation of operations) server.apply(operation);
    for (const id of ["category-a", "memo-a"]) {
      const record = server.get(id)!;
      await a.receive(record); await b.receive(record); await a.receive(record); await b.receive(record);
    }
    expect(a.nodes).toEqual(b.nodes);
    expect(a.nodes.find((node) => node.id === "memo-a")?.purgedAt).toBeTruthy();
  });

  it("persists a pinned-note draft immediately and restores it before an operation is queued", async () => {
    const persistence = new MemoryPersistence();
    let store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "device-a", now: () => at(1) });
    await store.setPinnedNoteDraft("draft", at(2));
    expect(store.pinnedNote.body).toBe("draft");
    expect(store.outbox).toHaveLength(0);
    store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored", now: () => at(3) });
    expect(store.pinnedNote.body).toBe("draft");
    expect(store.pendingCount).toBe(1);
    await store.queuePinnedNoteOperation(at(3));
    expect(store.outbox[0]).toMatchObject({ targetType: "pinnedNote", targetNodeId: "pinnedNote", payload: { pinnedNote: { body: "draft" } } });
  });

  it("recovers a pinned-note draft from WAL after a crash boundary", async () => {
    const persistence = new MemoryPersistence();
    let store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "device-a", now: () => at(1) });
    persistence.failCommit = true;
    await expect(store.setPinnedNoteDraft("recovered", at(2))).rejects.toThrow("crash");
    persistence.failCommit = false;
    store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored", now: () => at(3) });
    expect(store.pinnedNote.body).toBe("recovered");
    expect(store.pendingCount).toBe(1);
  });

  it("does not overwrite a different legacy local pinned note when cloud data already exists", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], {
      deviceId: "device-a", now: () => at(2), initialPinnedNote: { body: "local legacy", updatedAt: at(1) },
    });
    await store.initializePinnedNote({ value: { body: "cloud" }, revision: 4, lastOpId: "cloud:4", lastDeviceId: "device-b", lastLocalSeq: 4 });
    expect(store.pinnedNote.body).toBe("cloud");
    expect(store.legacyPinnedNoteCandidates).toContainEqual({ body: "local legacy", updatedAt: at(1).toISOString() });
    expect(store.outbox).toHaveLength(0);
  });

  it("keeps self echo and duplicate pinned-note delivery idempotent and resolves concurrent edits deterministically", async () => {
    const self = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-self", now: () => at(1) });
    await self.setPinnedNoteDraft("self", at(2)); await self.queuePinnedNoteOperation(at(2));
    const selfRecord = new InMemoryRevisionServer().apply(self.outbox[0]).pinnedNoteRecord!;
    expect(await self.receivePinnedNote(selfRecord)).toBe("self-echo");
    expect(await self.receivePinnedNote(selfRecord)).toBe("duplicate");
    expect(self.outbox).toHaveLength(0);

    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a", now: () => at(1) });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-b", now: () => at(1) });
    await a.setPinnedNoteDraft("A", at(2)); await a.queuePinnedNoteOperation(at(2));
    await b.setPinnedNoteDraft("B", at(2)); await b.queuePinnedNoteOperation(at(2));
    const server = new InMemoryRevisionServer();
    const operations = [...a.outbox, ...b.outbox];
    for (const operation of [...operations].reverse()) server.apply(operation);
    for (const operation of operations) server.apply(operation);
    const winner = server.getPinnedNote()!;
    await a.receivePinnedNote(winner);
    await b.receivePinnedNote(winner);
    expect(await a.receivePinnedNote(winner)).toBe("duplicate");
    expect(a.pinnedNote.body).toBe(b.pinnedNote.body);
    expect(a.pinnedNote.body).toBe(winner.value.body);
  });

  it("undoes and redoes a pinned-note edit as new synchronized operations", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], {
      deviceId: "device-a", now: () => at(1), initialPinnedNote: { body: "A", updatedAt: at(0) },
    });
    await store.initializePinnedNote();
    await store.queuePinnedNoteOperation(at(1));
    await store.acknowledge(store.outbox[0].opId, undefined, new InMemoryRevisionServer().apply(store.outbox[0]).pinnedNoteRecord);
    await store.setPinnedNoteDraft("B", at(2));
    await store.undo(at(3));
    expect(store.pinnedNote.body).toBe("A");
    expect(store.outbox.at(-1)).toMatchObject({ targetType: "pinnedNote", type: "undo", payload: { pinnedNote: { body: "A" } } });
    expect(store.historyDepths.future).toBe(1);
    await store.redo(at(4));
    expect(store.pinnedNote.body).toBe("B");
    expect(store.outbox.at(-1)).toMatchObject({ targetType: "pinnedNote", type: "redo", payload: { pinnedNote: { body: "B" } } });
    expect(store.historyDepths.future).toBe(0);
  });

  it("coalesces continuous pinned-note typing independently from cloud operation debounce", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a", now: () => at(1) });
    await store.setPinnedNoteDraft("a", at(1));
    await store.setPinnedNoteDraft("ab", at(2));
    await store.setPinnedNoteDraft("abc", at(3));
    expect(store.historyDepths).toEqual({ past: 1, future: 0 });
    expect(store.outbox).toHaveLength(0);
    await store.undo(at(4));
    expect(store.pinnedNote.body).toBe("");
  });

  it("keeps pinned-note and ordinary Node edits in one ordered history", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-a", now: () => at(9) });
    await store.setPinnedNoteDraft("pinned", at(1));
    await store.command("memo edit", "update", nodes => updateNode(nodes, "memo-a", { title: "B" }, at(2)));
    expect(store.historyDepths.past).toBe(2);
    await store.undo(at(3));
    expect(store.nodes[0].title).toBe("A");
    expect(store.pinnedNote.body).toBe("pinned");
    await store.undo(at(4));
    expect(store.pinnedNote.body).toBe("");
  });

  it("keeps pinned-note identity attached when another command precedes its debounced upload", async () => {
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-a", now: () => at(9) });
    await store.setPinnedNoteDraft("pinned", at(1));
    await store.command("memo edit", "update", nodes => updateNode(nodes, "memo-a", { title: "B" }, at(2)));
    await store.queuePinnedNoteOperation(at(3));
    await store.undo(at(4));
    expect(store.nodes[0].title).toBe("A");
    await store.undo(at(5));
    expect(store.pinnedNote.body).toBe("");
  });

  it("recovers pinned-note history and its Undo operation atomically from WAL", async () => {
    const persistence = new MemoryPersistence();
    let store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "device-a", now: () => at(1) });
    await store.setPinnedNoteDraft("B", at(2));
    persistence.failCommit = true;
    await expect(store.undo(at(3))).rejects.toThrow("crash");
    persistence.failCommit = false;
    store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored", now: () => at(4) });
    expect(store.pinnedNote.body).toBe("");
    expect(store.outbox.at(-1)).toMatchObject({ targetType: "pinnedNote", type: "undo" });
    expect(store.historyDepths).toEqual({ past: 0, future: 1 });
  });

  it("converges another device after pinned-note Undo and Redo synchronization", async () => {
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a", now: () => at(1) });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-b", now: () => at(1) });
    const server = new InMemoryRevisionServer();
    const flush = async () => {
      for (const operation of a.outbox) {
        const ack = server.apply(operation);
        await a.acknowledge(operation.opId, ack.record, ack.pinnedNoteRecord);
        if (ack.pinnedNoteRecord) await b.receivePinnedNote(ack.pinnedNoteRecord);
      }
    };
    await a.setPinnedNoteDraft("B", at(2)); await a.queuePinnedNoteOperation(at(2)); await flush();
    await a.undo(at(3)); await flush();
    expect(b.pinnedNote.body).toBe("");
    await a.redo(at(4)); await flush();
    expect(b.pinnedNote.body).toBe("B");
    expect(a.pinnedNote.body).toBe(b.pinnedNote.body);
  });

  it("does not roll back an unrelated remotely edited Node when undoing a local edit", async () => {
    const initial = [initialMemo(), unrelatedMemo()];
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), initial, { deviceId: "device-a", now: () => at(9) });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), initial, { deviceId: "device-b", now: () => at(9) });
    await a.command("local A edit", "update", nodes => updateNode(nodes, "memo-a", { title: "A-local" }, at(1)));
    await b.command("remote B edit", "update", nodes => updateNode(nodes, "memo-b", { title: "B-remote" }, at(2)));
    await a.receive(b.versionedNode("memo-b")!);

    await a.undo(at(3));

    expect(a.nodes.find(node => node.id === "memo-a")?.title).toBe("A");
    expect(a.nodes.find(node => node.id === "memo-b")?.title).toBe("B-remote");
    expect(a.outbox.filter(operation => operation.type === "undo").map(operation => operation.targetNodeId)).toEqual(["memo-a"]);
  });

  it("does not roll back an unrelated remotely edited Node when redoing a local edit", async () => {
    const initial = [initialMemo(), unrelatedMemo()];
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), initial, { deviceId: "device-a", now: () => at(9) });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), initial, { deviceId: "device-b", now: () => at(9) });
    await a.command("local A edit", "update", nodes => updateNode(nodes, "memo-a", { title: "A-local" }, at(1)));
    await a.undo(at(2));
    await b.command("remote B edit", "update", nodes => updateNode(nodes, "memo-b", { title: "B-remote" }, at(3)));
    await a.receive(b.versionedNode("memo-b")!);

    await a.redo(at(4));

    expect(a.nodes.find(node => node.id === "memo-a")?.title).toBe("A-local");
    expect(a.nodes.find(node => node.id === "memo-b")?.title).toBe("B-remote");
    expect(a.outbox.filter(operation => operation.type === "redo").map(operation => operation.targetNodeId)).toEqual(["memo-a"]);
  });

  it("does not silently overwrite a newer remote edit to the same Node with an older local Undo snapshot", async () => {
    const server = new InMemoryRevisionServer();
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-a", now: () => at(9) });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-b", now: () => at(9) });
    await a.command("local edit", "update", nodes => updateNode(nodes, "memo-a", { title: "A-local" }, at(1)));
    const localAck = server.apply(a.outbox[0]);
    await a.acknowledge(localAck.opId, localAck.record);
    await b.receive(localAck.record!);
    await b.command("later remote edit", "update", nodes => updateNode(nodes, "memo-a", { title: "A-remote" }, at(2)));
    const remoteAck = server.apply(b.outbox[0]);
    await b.acknowledge(remoteAck.opId, remoteAck.record);
    await a.receive(remoteAck.record!);

    await a.undo(at(3));

    expect(a.nodes.find(node => node.id === "memo-a")?.title).toBe("A-remote");
    expect(a.outbox.filter(operation => operation.type === "undo")).toHaveLength(0);
  });

  it("does not silently overwrite a newer remote pinned note with an older local Undo snapshot", async () => {
    const server = new InMemoryRevisionServer();
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-a", now: () => at(9) });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [], { deviceId: "device-b", now: () => at(9) });
    await a.setPinnedNoteDraft("local", at(1)); await a.queuePinnedNoteOperation(at(1));
    const localAck = server.apply(a.outbox[0]);
    await a.acknowledge(localAck.opId, undefined, localAck.pinnedNoteRecord);
    await b.receivePinnedNote(localAck.pinnedNoteRecord!);
    await b.setPinnedNoteDraft("remote", at(2)); await b.queuePinnedNoteOperation(at(2));
    const remoteAck = server.apply(b.outbox[0]);
    await b.acknowledge(remoteAck.opId, undefined, remoteAck.pinnedNoteRecord);
    await a.receivePinnedNote(remoteAck.pinnedNoteRecord!);

    await a.undo(at(3));

    expect(a.pinnedNote.body).toBe("remote");
    expect(a.outbox.filter(operation => operation.type === "undo")).toHaveLength(0);
  });

  it("preserves an unrelated remote Node through mixed Node and pinned-note Undo/Redo", async () => {
    const initial = [initialMemo(), unrelatedMemo()];
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), initial, { deviceId: "device-a", now: () => at(9) });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), initial, { deviceId: "device-b", now: () => at(9) });
    await a.command("local A edit", "update", nodes => updateNode(nodes, "memo-a", { title: "A-local" }, at(1)));
    await a.setPinnedNoteDraft("pinned-local", at(2));
    await b.command("remote B edit", "update", nodes => updateNode(nodes, "memo-b", { title: "B-remote" }, at(3)));
    await a.receive(b.versionedNode("memo-b")!);

    await a.undo(at(4));
    await a.redo(at(5));
    await a.undo(at(6));
    await a.undo(at(7));

    expect(a.pinnedNote.body).toBe("");
    expect(a.nodes.find(node => node.id === "memo-a")?.title).toBe("A");
    expect(a.nodes.find(node => node.id === "memo-b")?.title).toBe("B-remote");
  });

  it("preserves a remotely created Node when undoing a local command", async () => {
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-a", now: () => at(9) });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-b", now: () => at(9) });
    await a.command("local edit", "update", nodes => updateNode(nodes, "memo-a", { title: "local" }, at(1)));
    await b.command("remote create", "create", nodes => createNode(nodes, "memo", { title: "remote new", parentId: null }, at(2), "remote-new"));
    await a.receive(b.versionedNode("remote-new")!);
    await a.undo(at(3));
    expect(a.nodes.find(node => node.id === "remote-new")).toMatchObject({ title: "remote new", deletedAt: null });
    expect(a.outbox.filter(operation => operation.type === "undo").map(operation => operation.targetNodeId)).toEqual(["memo-a"]);
  });

  it("blocks Redo atomically when the same Node changed remotely after Undo", async () => {
    const server = new InMemoryRevisionServer();
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-a", now: () => at(9) });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-b", now: () => at(9) });
    await a.command("local edit", "update", nodes => updateNode(nodes, "memo-a", { title: "local" }, at(1)));
    let ack = server.apply(a.outbox[0]); await a.acknowledge(ack.opId, ack.record); await b.receive(ack.record!);
    const undo = await a.undo(at(2)); ack = server.apply(undo[0]); await a.acknowledge(ack.opId, ack.record); await b.receive(ack.record!);
    await b.command("remote edit", "update", nodes => updateNode(nodes, "memo-a", { title: "remote" }, at(3)));
    ack = server.apply(b.outbox.at(-1)!); await a.receive(ack.record!);
    expect(await a.redo(at(4))).toEqual([]);
    expect(a.nodes[0].title).toBe("remote");
    expect(a.historyDepths).toEqual({ past: 0, future: 1 });
  });

  it("does not resurrect a remotely purged Node from local History", async () => {
    const server = new InMemoryRevisionServer();
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-a", now: () => at(9) });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [initialMemo()], { deviceId: "device-b", now: () => at(9) });
    await a.command("local edit", "update", nodes => updateNode(nodes, "memo-a", { title: "local" }, at(1)));
    let ack = server.apply(a.outbox[0]); await a.acknowledge(ack.opId, ack.record); await b.receive(ack.record!);
    await b.command("remote purge", "purge", nodes => hardDeleteNode(nodes, "memo-a", at(2)));
    ack = server.apply(b.outbox.at(-1)!); await a.receive(ack.record!);
    expect(await a.undo(at(3))).toEqual([]);
    expect(a.nodes[0].purgedAt).toEqual(at(2));
    expect(a.historyDepths).toEqual({ past: 1, future: 0 });
  });

  it("blocks an entire multi-target command when one target changed remotely", async () => {
    const server = new InMemoryRevisionServer();
    const category: Node = { id: "category-a", type: "category", parentId: null, sortKey: "a0", title: "C", createdAt: at(0), updatedAt: at(0), deletedAt: null };
    const child = { ...initialMemo(), parentId: "category-a" };
    const initial = [category, child];
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), initial, { deviceId: "device-a", now: () => at(9) });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), initial, { deviceId: "device-b", now: () => at(9) });
    await a.command("cascade delete", "softDelete", nodes => softDeleteNode(nodes, "category-a", true, at(1)));
    for (const operation of a.outbox) {
      const ack = server.apply(operation);
      await a.acknowledge(ack.opId, ack.record);
      await b.receive(ack.record!);
    }
    await b.command("remote child edit", "update", nodes => updateNode(nodes, "memo-a", { title: "remote" }, at(2)));
    const remote = server.apply(b.outbox.at(-1)!);
    await a.receive(remote.record!);
    expect(await a.undo(at(3))).toEqual([]);
    expect(a.nodes.find(node => node.id === "category-a")?.deletedAt).toEqual(at(1));
    expect(a.nodes.find(node => node.id === "memo-a")?.title).toBe("remote");
    expect(a.historyDepths).toEqual({ past: 1, future: 0 });
  });

  it("drops only unsafe legacy snapshot History while preserving recovered domain and outbox", async () => {
    const persistence = new MemoryPersistence();
    let store = await TaskMemoV2ApplicationStore.open(persistence, [initialMemo()], { deviceId: "device-a", now: () => at(9) });
    await store.command("edit", "update", nodes => updateNode(nodes, "memo-a", { title: "B" }, at(1)));
    const envelope = JSON.parse(persistence.committed!);
    envelope.history = { past: [{ label: "legacy", before: [envelope.domain["memo-a"].value], after: [envelope.domain["memo-a"].value] }], future: [] };
    persistence.committed = JSON.stringify(envelope);
    store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored", now: () => at(9) });
    expect(store.nodes[0].title).toBe("B");
    expect(store.outbox).toHaveLength(1);
    expect(store.historyDepths).toEqual({ past: 0, future: 0 });
  });

  it("treats imported content as new V2 operations without reviving a purge tombstone", async () => {
    const persistence = new MemoryPersistence();
    const purged = hardDeleteNode([initialMemo()], "memo-a", at(1));
    let store = await TaskMemoV2ApplicationStore.open(persistence, purged, { deviceId: "device-a", now: () => at(9) });
    const before = store.versionedNode("memo-a")!;
    const operations = await store.command("データを読み込む", "import", () => [initialMemo()], { recordHistory: false });
    expect(operations).toEqual([]);
    expect(store.versionedNode("memo-a")).toEqual(before);
    expect(store.nodes[0].purgedAt).toEqual(at(1));
    expect(store.historyDepths).toEqual({ past: 0, future: 0 });
    store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "ignored" });
    expect(store.nodes[0].purgedAt).toEqual(at(1));
  });
});
