import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createNode, hardDeleteNode, updateNode } from "../domain/nodeOperations";
import type { Node } from "../models/node";
import type { ApplicationJournalPersistence } from "./applicationStore";
import { createFirebaseSyncAdapter } from "./firebaseSyncAdapter";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import { TaskMemoV2SyncController } from "./taskMemoV2SyncController";

const enabled = process.env.TASKMEMO_EMULATOR_E2E === "1";
const waitFor = async (predicate: () => boolean, timeout = 5_000) => {
  const started = Date.now();
  while (!predicate()) { if (Date.now() - started > timeout) throw new Error("condition timeout"); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
};
class MemoryPersistence implements ApplicationJournalPersistence { committed: string | null = null; journal: string | null = null; loadCommitted = async () => this.committed; loadJournal = async () => this.journal; writeJournal = async (v: string) => { this.journal = v; }; writeCommitted = async (v: string) => { this.committed = v; }; clearJournal = async () => { this.journal = null; }; }
const now = (second: number) => new Date(`2026-09-18T00:00:${String(second).padStart(2, "0")}.000Z`);

describe.runIf(enabled)("V2 Firestore Emulator", () => {
  let environment: RulesTestEnvironment;
  beforeAll(async () => {
    environment = await initializeTestEnvironment({ projectId: "demo-taskmemo-v2", firestore: { host: "127.0.0.1", port: 8180 } });
  });
  const v2Gate = { schemaVersion: 1, minimumSyncProtocol: 2, v1WritesAllowed: false, v2Enabled: true };
  beforeEach(async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "syncControl/current"), { schemaVersion: 1, writesEnabled: true });
      for (const uid of ["owner", "same-user", "purge-user"])
        await setDoc(doc(context.firestore(), `users/${uid}/syncMetadataV2/compatibility`), v2Gate);
    });
  });
  afterAll(async () => environment.cleanup());

  it("enforces owner isolation, ownerUid, required identity fields, and monotonic revision", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const other = environment.authenticatedContext("other").firestore();
    const valid = { ownerUid: "owner", schemaVersion: 2, record: { value: { id: "a" }, revision: 1, lastOpId: "device:1", lastDeviceId: "device", lastLocalSeq: 1, operationType: "create" } };
    await assertSucceeds(setDoc(doc(owner, "users/owner/nodesV2/a"), valid));
    await assertFails(getDoc(doc(other, "users/owner/nodesV2/a")));
    await assertFails(setDoc(doc(owner, "users/owner/nodesV2/spoof"), { ...valid, ownerUid: "other" }));
    await assertFails(setDoc(doc(owner, "users/owner/nodesV2/a"), { ...valid, record: { ...valid.record, revision: 0 } }));
    await assertFails(setDoc(doc(owner, "users/owner/syncOperationsV2/wrong"), { ownerUid: "owner", schemaVersion: 2, operation: { opId: "different" }, acknowledgement: { opId: "different" } }));
  });

  it("isolates and validates the separate pinned-note profile resource", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const other = environment.authenticatedContext("other").firestore();
    const valid = { ownerUid: "owner", schemaVersion: 2, record: { value: { body: "shared" }, revision: 2, lastOpId: "device:2", lastDeviceId: "device", lastLocalSeq: 2 } };
    const ref = doc(owner, "users/owner/profileV2/pinnedNote");
    await assertSucceeds(setDoc(ref, valid));
    await assertFails(getDoc(doc(other, "users/owner/profileV2/pinnedNote")));
    await assertFails(setDoc(ref, { ...valid, ownerUid: "other" }));
    await assertFails(setDoc(ref, { ...valid, record: { ...valid.record, revision: 1 } }));
    await assertFails(setDoc(ref, { ...valid, record: { ...valid.record, value: {} } }));
  });

  it("rejects stale V1, dual-write, missing markers, and both protocols during maintenance", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const valid = { ownerUid: "owner", schemaVersion: 2, record: { value: { id: "a" }, revision: 1, lastOpId: "device:1", lastDeviceId: "device", lastLocalSeq: 1, operationType: "create" } };
    await assertFails(setDoc(doc(owner, "users/owner/nodes/legacy"), { id: "legacy" }));
    await assertFails(getDoc(doc(owner, "users/owner/nodes/legacy")));
    await assertSucceeds(setDoc(doc(owner, "users/owner/nodesV2/a"), valid));
    // The previous draft allowed this dual-write configuration. It violates cutover isolation.
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/owner/syncMetadataV2/compatibility"), { ...v2Gate, v1WritesAllowed: true });
    });
    await assertFails(setDoc(doc(owner, "users/owner/nodes/legacy"), { id: "legacy" }));
    await assertFails(setDoc(doc(owner, "users/owner/nodesV2/a"), valid));
    await assertFails(setDoc(doc(owner, "users/owner/syncMetadataV2/compatibility"), v2Gate));
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "users/owner/syncMetadataV2/compatibility"), { ...v2Gate, minimumSyncProtocol: 1, v1WritesAllowed: true, v2Enabled: false });
    });
    await assertSucceeds(setDoc(doc(owner, "users/owner/nodes/legacy"), { id: "legacy" }));
    await assertFails(setDoc(doc(owner, "users/owner/nodesV2/a"), valid));
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "syncControl/current"), { schemaVersion: 1, writesEnabled: false });
    });
    await assertFails(setDoc(doc(owner, "users/owner/nodes/legacy"), { id: "legacy" }));
    await assertFails(setDoc(doc(owner, "users/owner/nodesV2/a"), valid));
    const missing = environment.authenticatedContext("missing-marker").firestore();
    await assertFails(setDoc(doc(missing, "users/missing-marker/nodes/legacy"), { id: "legacy" }));
  });

  it("runs two isolated devices through create, bidirectional edits, conflict, restart, replay, Undo/Redo, and backlog drain", async () => {
    const uid = "same-user";
    const dbA = environment.authenticatedContext(uid).firestore() as unknown as Firestore;
    const dbB = environment.authenticatedContext(uid).firestore() as unknown as Firestore;
    const persistenceA = new MemoryPersistence(); const persistenceB = new MemoryPersistence();
    let a = await TaskMemoV2ApplicationStore.open(persistenceA, [], { deviceId: "device-a", now: () => now(50) });
    const b = await TaskMemoV2ApplicationStore.open(persistenceB, [], { deviceId: "device-b", now: () => now(51) });
    let controllerA = new TaskMemoV2SyncController(a, createFirebaseSyncAdapter(dbA, uid, "test", { emulator: true }));
    const controllerB = new TaskMemoV2SyncController(b, createFirebaseSyncAdapter(dbB, uid, "test", { emulator: true }));
    await Promise.all([controllerA.start(), controllerB.start()]);

    await a.command("create", "create", (nodes) => createNode(nodes, "memo", { title: "A", parentId: null }, now(1), "memo-a"));
    await controllerA.flush(); await waitFor(() => b.nodes.some((node) => node.id === "memo-a"));
    await a.command("edit", "update", (nodes) => updateNode(nodes, "memo-a", { title: "B" }, now(2))); await controllerA.flush();
    await waitFor(() => b.nodes.find((node) => node.id === "memo-a")?.title === "B");
    await b.command("edit", "update", (nodes) => updateNode(nodes, "memo-a", { title: "C" }, now(3))); await controllerB.flush();
    await waitFor(() => a.nodes.find((node) => node.id === "memo-a")?.title === "C");

    await a.setPinnedNoteDraft("from A", now(3)); await a.queuePinnedNoteOperation(now(3)); await controllerA.flush();
    await waitFor(() => b.pinnedNote.body === "from A");
    await b.setPinnedNoteDraft("from B", now(4)); await b.queuePinnedNoteOperation(now(4)); await controllerB.flush();
    await waitFor(() => a.pinnedNote.body === "from B");
    await a.setPinnedNoteDraft("undoable pinned note", now(6)); await a.queuePinnedNoteOperation(now(6)); await controllerA.flush();
    await waitFor(() => b.pinnedNote.body === "undoable pinned note");
    await a.undo(now(7)); await controllerA.flush(); await waitFor(() => b.pinnedNote.body === "from B");
    await a.redo(now(8)); await controllerA.flush(); await waitFor(() => b.pinnedNote.body === "undoable pinned note");

    controllerA.stop(); controllerB.stop();
    await a.command("offline A", "update", (nodes) => updateNode(nodes, "memo-a", { title: "offline-A" }, now(4)));
    await b.command("offline B", "update", (nodes) => updateNode(nodes, "memo-a", { title: "offline-B" }, now(5)));
    a = await TaskMemoV2ApplicationStore.open(persistenceA, [], { deviceId: "ignored" });
    controllerA = new TaskMemoV2SyncController(a, createFirebaseSyncAdapter(dbA, uid, "test", { emulator: true }));
    await controllerB.start(); await controllerB.flush(); await controllerA.start();
    await waitFor(() => a.nodes.find((node) => node.id === "memo-a")?.title === b.nodes.find((node) => node.id === "memo-a")?.title);

    await a.command("edit before undo", "update", (nodes) => updateNode(nodes, "memo-a", { title: "undo-target" }, now(6))); await controllerA.flush();
    await a.undo(now(7)); await controllerA.flush(); await a.redo(now(8)); await controllerA.flush();
    await waitFor(() => b.nodes.find((node) => node.id === "memo-a")?.title === "undo-target");
    expect(a.historyDepths).toEqual({ past: 6, future: 0 });

    for (let index = 0; index < 15; index += 1) await a.command(`bulk-${index}`, "update", (nodes) => updateNode(nodes, "memo-a", { body: String(index) }, now(10 + index)));
    expect(a.outbox).toHaveLength(15);
    await controllerA.flush(); await waitFor(() => { const node = b.nodes.find((item) => item.id === "memo-a"); return node?.type === "memo" && node.body === "14"; });
    controllerB.stop(); await controllerB.start();
    expect(a.outbox).toHaveLength(0); expect(controllerA.state.phase).toBe("synced");
    expect(a.nodes).toEqual(b.nodes);
  }, 30_000);

  it("prevents category subtree resurrection when an offline child edit races a purge", async () => {
    const uid = "purge-user"; const dbA = environment.authenticatedContext(uid).firestore() as unknown as Firestore; const dbB = environment.authenticatedContext(uid).firestore() as unknown as Firestore;
    const category: Node = { id: "category-a", type: "category", parentId: null, sortKey: "a", title: "Category", createdAt: now(0), updatedAt: now(0), deletedAt: null };
    const child = createNode([category], "memo", { title: "Child", parentId: "category-a" }, now(0), "memo-a")[1];
    const a = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [category, child], { deviceId: "device-a" });
    const b = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [category, child], { deviceId: "device-b" });
    await a.command("purge subtree", "purge", (nodes) => hardDeleteNode(nodes, "category-a", now(2)));
    await b.command("stale child edit", "update", (nodes) => updateNode(nodes, "memo-a", { title: "stale" }, now(3)));
    const ca = new TaskMemoV2SyncController(a, createFirebaseSyncAdapter(dbA, uid, "test", { emulator: true }));
    const cb = new TaskMemoV2SyncController(b, createFirebaseSyncAdapter(dbB, uid, "test", { emulator: true }));
    await cb.start(); await ca.start();
    await waitFor(() => Boolean(a.nodes.find((node) => node.id === "memo-a")?.purgedAt) && Boolean(b.nodes.find((node) => node.id === "memo-a")?.purgedAt));
    expect(a.nodes.find((node) => node.id === "category-a")?.purgedAt).toBeTruthy();
    expect(b.nodes.find((node) => node.id === "memo-a")?.purgedAt).toBeTruthy();
  }, 15_000);
});
