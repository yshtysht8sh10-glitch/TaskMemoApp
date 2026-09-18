import { deleteUser, getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { deleteDoc, doc, getDoc, getFirestore } from "firebase/firestore";
import { deleteApp, initializeApp } from "firebase/app";
import { describe, expect, it } from "vitest";

import { createFirebaseSyncAdapter } from "./firebaseSyncAdapter";
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
    } finally {
      await Promise.all([
        deleteDoc(doc(db, "users", user.user.uid, "nodesV2", nodeId)),
        deleteDoc(doc(db, "users", user.user.uid, "syncOperationsV2", first.opId)),
        deleteDoc(doc(db, "users", user.user.uid, "syncOperationsV2", second.opId)),
      ]);
      await deleteUser(user.user);
      await deleteApp(app);
    }
  }, 30_000);
});
