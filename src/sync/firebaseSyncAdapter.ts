import { collection, doc, getDocFromServer, onSnapshot, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";

import { FIREBASE_PROJECT_IDS, type TaskMemoEnvironment } from "../services/firebaseConfig";
import { applyFeaturesOperation, applyPinnedNoteOperation, applyRevisionOperation } from "./revisionModel";
import { validateCompatibilityGate } from "./compatibilityGate";
import type { SyncAcknowledgement, SyncAdapter, SyncOperation, VersionedFeatures, VersionedNode } from "./types";

type AdapterOptions = {
  emulator?: boolean;
  onReceiptBatch?: (event: { phase: "start" | "complete"; batch: number; completed: number; total: number; lastCompletedOperationIndex: number }) => void;
  onReceiptLookup?: (event: ReceiptLookupEvent) => void;
  receiptLookupTimeoutMs?: number;
  receiptReadMode?: "parallel" | "serial";
  /** Diagnostic experiment only: pause after each completed serial receipt lookup. */
  receiptLookupIntervalMs?: number;
};

export type ReceiptLookupEvent = {
  batch: number;
  slot: number;
  operationIndex: number;
  phase: "start" | "found" | "not-found" | "error" | "timeout" | "late-resolve" | "late-reject";
  startedAt: string;
  durationMs: number;
  performanceElapsedMs: number;
  timeoutTimerSetAt: string | null;
  timeoutScheduledAt: string | null;
  timeoutFiredAt: string | null;
  timeoutDelayMs: number | null;
};

const monotonicNow = () => typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
const diagnosticPause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

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
  const productionAllowed = environment === "production" && projectId === FIREBASE_PROJECT_IDS.production;
  const emulatorAllowed = environment === "test" && options.emulator === true && projectId?.startsWith("demo-") === true;
  if (!developmentAllowed && !productionAllowed && !emulatorAllowed) {
    throw new Error(`Firebase V2 sync adapter is disabled for ${environment}/${projectId ?? "unknown"}.`);
  }

  return {
    async auditOutbox(operations) {
      const seen = new Set<string>();
      for (const operation of operations) {
        if (seen.has(operation.opId)) throw { kind: "permanent", message: "ローカルoutboxに重複operation IDがあります。復旧を停止しました。" };
        seen.add(operation.opId);
      }
      let received = 0;
      let missing = 0;
      // Keep server reads bounded; never upload until every receipt is classified.
      for (let offset = 0; offset < operations.length; offset += 8) {
        const batch = operations.slice(offset, offset + 8);
        const batchNumber = Math.floor(offset / 8) + 1;
        options.onReceiptBatch?.({ phase: "start", batch: batchNumber, completed: offset, total: operations.length, lastCompletedOperationIndex: offset - 1 });
        const lookup = async (operation: SyncOperation, slot: number) => {
          const started = Date.now();
          const startedAt = new Date(started).toISOString();
          const startedPerformance = monotonicNow();
          let timeoutTimerSetAt: string | null = null;
          let timeoutScheduledAt: string | null = null;
          let timeoutFiredAt: string | null = null;
          let timeoutDelayMs: number | null = null;
          let timedOut = false;
          const event = (phase: ReceiptLookupEvent["phase"]) => {
            try {
              options.onReceiptLookup?.({ batch: batchNumber, slot, operationIndex: offset + slot, phase, startedAt,
                durationMs: Math.max(0, Date.now() - started), performanceElapsedMs: Math.max(0, monotonicNow() - startedPerformance),
                timeoutTimerSetAt, timeoutScheduledAt, timeoutFiredAt, timeoutDelayMs });
            } catch { /* Diagnostic callbacks must not affect recovery. */ }
          };
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const timeoutMs = options.receiptLookupTimeoutMs;
            const timeoutPromise = timeoutMs && timeoutMs > 0 ? new Promise<never>((_, reject) => {
              const setAt = Date.now();
              const scheduledAt = setAt + timeoutMs;
              timeoutTimerSetAt = new Date(setAt).toISOString();
              timeoutScheduledAt = new Date(scheduledAt).toISOString();
              timer = setTimeout(() => {
                const firedAt = Date.now();
                timeoutFiredAt = new Date(firedAt).toISOString();
                timeoutDelayMs = Math.max(0, firedAt - scheduledAt);
                timedOut = true;
                reject({ kind: "temporary", code: "receipt-timeout", message: "Firebase receipt lookup timed out; recovery stopped." });
              }, timeoutMs);
            }) : null;
            event("start");
            const serverRead = getDocFromServer(doc(db, "users", uid, "syncOperationsV2", operation.opId));
            // Observe late SDK settlement without classifying or applying it after timeout.
            void serverRead.then(() => { if (timedOut) event("late-resolve"); }, () => { if (timedOut) event("late-reject"); });
            const snapshot = timeoutPromise
              ? await Promise.race([serverRead, timeoutPromise])
              : await serverRead;
            if (!snapshot.exists()) { event("not-found"); return false; }
            const data = snapshot.data();
            const acknowledgement = data.acknowledgement as SyncAcknowledgement | undefined;
            if (!sameOperation(data.operation, operation) || acknowledgement?.opId !== operation.opId ||
                (acknowledgement.result !== "applied" && acknowledgement.result !== "superseded"))
              throw { kind: "permanent", message: "Firebaseのoperation受領記録がローカルoutboxと矛盾します。復旧を停止しました。" };
            event("found");
            return true;
          } catch (reason) {
            event(reason && typeof reason === "object" && "code" in reason && reason.code === "receipt-timeout" ? "timeout" : "error");
            if (reason && typeof reason === "object" && "kind" in reason) throw reason;
            throw adapterError(reason);
          } finally {
            if (timer) clearTimeout(timer);
          }
        };
        const results: boolean[] = [];
        if (options.receiptReadMode === "serial") {
          for (let slot = 0; slot < batch.length; slot++) {
            results.push(await lookup(batch[slot], slot));
            // Deliberate diagnostic interval, including across batch boundaries; never pause after the final receipt.
            if (options.receiptLookupIntervalMs && options.receiptLookupIntervalMs > 0 && offset + slot < operations.length - 1)
              await diagnosticPause(options.receiptLookupIntervalMs);
          }
        } else {
          results.push(...await Promise.all(batch.map(lookup)));
        }
        received += results.filter(Boolean).length;
        missing += results.filter((value) => !value).length;
        options.onReceiptBatch?.({ phase: "complete", batch: batchNumber, completed: offset + batch.length, total: operations.length, lastCompletedOperationIndex: offset + batch.length - 1 });
      }
      return { received, missing };
    },
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
        const pinnedNote = operation.targetType === "pinnedNote";
        const features = operation.targetType === "features";
        const targetRef = pinnedNote
          ? doc(db, "users", uid, "profileV2", "pinnedNote")
          : features
            ? doc(db, "users", uid, "profileV2", "features")
            : doc(db, "users", uid, "nodesV2", operation.targetNodeId);
        return await runTransaction(db, async (transaction) => {
          const existing = await transaction.get(operationRef);
          if (existing.exists()) {
            const data = existing.data();
            if (!sameOperation(data.operation, operation)) {
              throw { code: "invalid-argument", message: "opId collision with different payload" };
            }
            return data.acknowledgement as SyncAcknowledgement;
          }
          const targetSnapshot = await transaction.get(targetRef);
          const acknowledgement = pinnedNote
            ? applyPinnedNoteOperation(targetSnapshot.exists() ? targetSnapshot.data().record : undefined, operation)
            : features
              ? applyFeaturesOperation(targetSnapshot.exists() ? targetSnapshot.data().record : undefined, operation)
              : applyRevisionOperation(targetSnapshot.exists() ? targetSnapshot.data().record as VersionedNode : undefined, operation);
          if (acknowledgement.result === "applied") transaction.set(targetRef, { ownerUid: uid, schemaVersion: 2, record: pinnedNote ? acknowledgement.pinnedNoteRecord : features ? acknowledgement.featuresRecord : acknowledgement.record, serverUpdatedAt: serverTimestamp() });
          transaction.set(operationRef, { ownerUid: uid, schemaVersion: 2, operation, acknowledgement, serverReceivedAt: serverTimestamp() });
          return acknowledgement;
        });
      } catch (reason) {
        throw adapterError(reason);
      }
    },

    async readPinnedNote() {
      const snapshot = await getDocFromServer(doc(db, "users", uid, "profileV2", "pinnedNote"));
      return snapshot.exists() ? snapshot.data().record : undefined;
    },
    async readFeatures() {
      const snapshot = await getDocFromServer(doc(db, "users", uid, "profileV2", "features"));
      return snapshot.exists() ? snapshot.data().record as VersionedFeatures : undefined;
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
    subscribePinnedNote(onRecord, onError) {
      return onSnapshot(doc(db, "users", uid, "profileV2", "pinnedNote"), { includeMetadataChanges: true }, (snapshot) => {
        const record = snapshot.data()?.record;
        if (record) void Promise.resolve(onRecord(record)).catch(onError);
      }, onError);
    },
    subscribeFeatures(onRecord, onError) {
      return onSnapshot(doc(db, "users", uid, "profileV2", "features"), { includeMetadataChanges: true }, (snapshot) => {
        const record = snapshot.data()?.record as VersionedFeatures | undefined;
        if (record) void Promise.resolve(onRecord(record)).catch(onError);
      }, onError);
    },
  };
}
