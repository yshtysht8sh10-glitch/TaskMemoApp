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

describe("TaskMemo V2 application store", () => {
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
});
