import { collection, doc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";

import { FIREBASE_PROJECT_IDS, type TaskMemoEnvironment } from "../services/firebaseConfig";
import { applyRevisionOperation } from "./revisionModel";
import { validateCompatibilityGate } from "./compatibilityGate";
import type { SyncAcknowledgement, SyncAdapter, SyncOperation, VersionedNode } from "./types";

type AdapterOptions = { emulator?: boolean };

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]),
  );
  return value;
};
const sameOperation = (a: unknown, b: unknown) => JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));

const adapterError = (reason: unknown) => {
  const code = reason && typeof reason === "object" && "code" in reason ? String(reason.code) : "";
  const message = reason instanceof Error ? reason.message : String(reason);
  if (code.includes("permission-denied") || code.includes("invalid-argument") || code.includes("unauthenticated"))
    return { kind: "permanent" as const, message };
  if (code.includes("unavailable") || code.includes("network") || code.includes("deadline-exceeded"))
    return { kind: "offline" as const, message };
  return { kind: "temporary" as const, message };
};

export function createFirebaseSyncAdapter(
  db: Firestore,
  uid: string,
  environment: TaskMemoEnvironment,
  options: AdapterOptions = {},
): SyncAdapter {
  const projectId = db.app.options.projectId;
  const developmentAllowed = environment === "development" && projectId === FIREBASE_PROJECT_IDS.development;
  const emulatorAllowed = environment === "test" && options.emulator === true && projectId?.startsWith("demo-") === true;
  if (!developmentAllowed && !emulatorAllowed) {
    throw new Error(`Firebase V2 sync adapter is disabled for ${environment}/${projectId ?? "unknown"}.`);
  }

  return {
    async connect() {
      try {
        const global = await getDocFromServer(doc(db, "syncControl", "current"));
        if (global.data()?.schemaVersion !== 1 || global.data()?.writesEnabled !== true)
          throw { code: "permission-denied", message: "同期はmaintenance中です。" };
        const gate = await getDocFromServer(doc(db, "users", uid, "syncMetadataV2", "compatibility"));
        try { validateCompatibilityGate(gate.exists() ? gate.data() : undefined); }
        catch (error) { throw { code: "permission-denied", message: String(error) }; }
      } catch (reason) {
        throw adapterError(reason);
      }
    },

    async upload(operation: SyncOperation) {
      try {
        const operationRef = doc(db, "users", uid, "syncOperationsV2", operation.opId);
        const nodeRef = doc(db, "users", uid, "nodesV2", operation.targetNodeId);
        return await runTransaction(db, async (transaction) => {
          const existing = await transaction.get(operationRef);
          if (existing.exists()) {
            const data = existing.data();
            if (!sameOperation(data.operation, operation)) {
              throw { code: "invalid-argument", message: "opId collision with different payload" };
            }
            return data.acknowledgement as SyncAcknowledgement;
          }
          const nodeSnapshot = await transaction.get(nodeRef);
          const current = nodeSnapshot.exists() ? nodeSnapshot.data().record as VersionedNode : undefined;
          const acknowledgement = applyRevisionOperation(current, operation);
          if (acknowledgement.result === "applied") transaction.set(nodeRef, { ownerUid: uid, schemaVersion: 2, record: acknowledgement.record, serverUpdatedAt: serverTimestamp() });
          transaction.set(operationRef, { ownerUid: uid, schemaVersion: 2, operation, acknowledgement, serverReceivedAt: serverTimestamp() });
          return acknowledgement;
        });
      } catch (reason) {
        throw adapterError(reason);
      }
    },

    subscribe(onRecord, onError) {
      return onSnapshot(collection(db, "users", uid, "nodesV2"), { includeMetadataChanges: true }, (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type === "removed") continue;
          const record = change.doc.data().record as VersionedNode | undefined;
          if (record) void Promise.resolve(onRecord(record)).catch(onError);
        }
      }, onError);
    },
  };
}
