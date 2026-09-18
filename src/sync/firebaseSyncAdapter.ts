import { doc, getDoc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";

import { FIREBASE_PROJECT_IDS, type TaskMemoEnvironment } from "../services/firebaseConfig";
import type { SyncAdapter, SyncOperation } from "./types";

type AdapterOptions = { emulator?: boolean };

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
  const emulatorAllowed = environment === "test" && options.emulator === true;
  if (!developmentAllowed && !emulatorAllowed) {
    throw new Error(`Firebase V2 sync adapter is disabled for ${environment}/${projectId ?? "unknown"}.`);
  }

  return {
    async connect() {
      try {
        await getDoc(doc(db, "users", uid, "syncMetadataV2", "connection"));
      } catch (reason) {
        throw adapterError(reason);
      }
    },

    async upload(operation: SyncOperation) {
      try {
        const operationRef = doc(db, "users", uid, "syncOperationsV2", operation.opId);
        return await runTransaction(db, async (transaction) => {
          const existing = await transaction.get(operationRef);
          if (!existing.exists()) {
            transaction.set(operationRef, {
              ...operation,
              serverReceivedAt: serverTimestamp(),
            });
          }
          return { opId: operation.opId };
        });
      } catch (reason) {
        throw adapterError(reason);
      }
    },
  };
}
