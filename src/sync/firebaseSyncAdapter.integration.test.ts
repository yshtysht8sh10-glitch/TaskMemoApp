import { deleteUser, getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { deleteApp, initializeApp } from "firebase/app";
import { describe, expect, it } from "vitest";

import { createFirebaseSyncAdapter } from "./firebaseSyncAdapter";
import type { ApplicationJournalPersistence } from "./applicationStore";
import type { MemoNode } from "../models/node";
import { updateNode, softDeleteNode } from "../domain/nodeOperations";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import { TaskMemoV2SyncController } from "./taskMemoV2SyncController";
import type { SyncOperation, VersionedNode } from "./types";

const enabled = process.env.TASKMEMO_DEV_INTEGRATION === "1";
const operation = (deviceId: string, nodeId: string, title: string): SyncOperation => ({
  opId: `${deviceId}:1`, deviceId, localSeq: 1, targetNodeId: nodeId, type: "update", baseRevision: 0,
  payload: { node: { id: nodeId, title, purgedAt: null } }, createdAt: "2026-09-18T00:00:00.000Z",
  status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
});

describe.runIf(enabled)("dev Firebase V2 adapter", () => {
  it("converges concurrent operations and acknowledges duplicate opId idempotently", async () => {
    const config = {
      apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY!,
      authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN!,
      projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID!,
      appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID!,
    };
    expect(config.projectId).toBe("taskmemoapp-dev");
    const app = initializeApp(config, `sync-v2-${Date.now()}`);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await createUserWithEmailAndPassword(auth, `sync-v2-${token}@example.invalid`, `Tmp-${token}-Password`);
    const adapter = createFirebaseSyncAdapter(db, user.user.uid, "development");
    const nodeId = `concurrent-${token}`;
    const first = operation("device-a", nodeId, "B");
    const second = operation("device-b", nodeId, "C");
    try {
      const firstAck = await adapter.upload(first);
      const secondAck = await adapter.upload(second);
      const duplicateAck = await adapter.upload(first);
      expect(duplicateAck).toEqual(firstAck);
      expect(secondAck.record).toBeDefined();
      const snapshot = await getDoc(doc(db, "users", user.user.uid, "nodesV2", nodeId));
      const cloud = snapshot.data()?.record as VersionedNode;
      expect(cloud.revision).toBe(1);
      expect(cloud.lastOpId).toBe([first.opId, second.opId].sort().at(-1));
      class MemoryPersistence implements ApplicationJournalPersistence { committed: string | null = null; journal: string | null = null; loadCommitted = async () => this.committed; loadJournal = async () => this.journal; writeJournal = async (value: string) => { this.journal = value; }; writeCommitted = async (value: string) => { this.committed = value; }; clearJournal = async () => { this.journal = null; }; }
      const at = new Date("2026-09-18T00:00:00.000Z");
      const memo: MemoNode = { id: `memo-${token}`, type: "memo", parentId: null, sortKey: "a", title: "A", body: "", dueAt: null, duePreset: "none", status: "active", completedAt: null, createdAt: at, updatedAt: at, deletedAt: null };
      const deviceA = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [memo], { deviceId: `device-a-${token}` });
      const deviceB = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [memo], { deviceId: `device-b-${token}` });
      const controllerA = new TaskMemoV2SyncController(deviceA, createFirebaseSyncAdapter(db, user.user.uid, "development"));
      const controllerB = new TaskMemoV2SyncController(deviceB, createFirebaseSyncAdapter(db, user.user.uid, "development"));
      await Promise.all([controllerA.start(), controllerB.start()]);
      await deviceA.command("edit", "update", (nodes) => updateNode(nodes, memo.id, { title: "B" }, new Date(at.getTime() + 1)));
      await controllerA.flush();
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(deviceB.nodes.find((node) => node.id === memo.id)?.title).toBe("B");
      await deviceA.undo(new Date(at.getTime() + 2)); await controllerA.flush();
      await deviceA.redo(new Date(at.getTime() + 3)); await controllerA.flush();
      controllerB.stop();
      await deviceA.command("delete", "softDelete", (nodes) => softDeleteNode(nodes, memo.id, false, new Date(at.getTime() + 4))); await controllerA.flush();
      await controllerB.start();
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(deviceB.nodes.find((node) => node.id === memo.id)).toMatchObject({ title: "B", deletedAt: new Date(at.getTime() + 4) });
      expect(deviceA.outbox).toHaveLength(0);
      expect(controllerA.state.phase).toBe("synced");
      controllerA.stop(); controllerB.stop();
    } finally {
      // V2 receipts are deliberately immutable under client rules. The caller removes
      // this exact temporary user subtree with the authenticated Firebase CLI.
      console.log(`TASKMEMO_DEV_CLEANUP_USER=${user.user.uid}`);
      await deleteUser(user.user);
      await deleteApp(app);
    }
  }, 30_000);
});
