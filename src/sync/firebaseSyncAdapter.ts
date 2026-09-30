import { collection, doc, documentId, getCountFromServer, getDocFromServer, getDocsFromServer, onSnapshot, query, runTransaction, serverTimestamp, Timestamp, where, type Firestore } from "firebase/firestore";

import { FIREBASE_PROJECT_IDS, type TaskMemoEnvironment } from "../services/firebaseConfig";
import { applyFeaturesOperation, applyPinnedNoteOperation, applyRevisionOperation } from "./revisionModel";
import { validateCompatibilityGate } from "./compatibilityGate";
import type { RecoveryConvergenceRequest, SyncAcknowledgement, SyncAdapter, SyncOperation, VersionedFeatures, VersionedNode, VersionedPinnedNote } from "./types";
import { canonicalSyncValue } from "./syncSelfRepair";
import { recordActorReceipt, recordNormalUploadBlockedByRepair, recordNormalWriteDuringRepair, recordRepairComparison, recordRepairLock, recordRepairLockWait, recordRepairSnapshot, recordSyncActivity, selfRepairDiagnosticsActive } from "./selfRepairDiagnostics";

type AdapterOptions = {
  emulator?: boolean;
  onReceiptBatch?: (event: { phase: "start" | "complete"; batch: number; completed: number; total: number; lastCompletedOperationIndex: number }) => void;
  onReceiptLookup?: (event: ReceiptLookupEvent) => void;
  onReceiptRead?: (event: ReceiptReadEvent) => void;
  receiptLookupTimeoutMs?: number;
  receiptReadMode?: "chunked" | "parallel" | "serial";
  onRecoveryTransaction?: (event: RecoveryTransactionEvent) => void;
  /** Diagnostic experiment only: pause after each completed serial receipt lookup. */
  receiptLookupIntervalMs?: number;
};

export type RecoveryTransactionEvent = {
  phase: "start" | "success" | "failure";
  receipt: "existing" | "created" | null;
  nodeWrite: boolean;
  serverWinnerNoWrite: boolean;
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

export type ReceiptReadEvent = {
  batch: number;
  firstOperationIndex: number;
  operationCount: number;
  attempt: number;
  phase: "start" | "success" | "retry-success" | "timeout" | "error" | "retry" | "final-failure" | "late-resolve" | "late-reject";
  durationMs: number;
  returnedDocumentCount: number | null;
  retryDelayMs: number | null;
  timeoutDelayMs: number | null;
  performanceElapsedMs: number;
  timeoutTimerSetAt: string | null;
  timeoutScheduledAt: string | null;
  timeoutFiredAt: string | null;
  browserOnline: boolean | null;
  pageVisibility: string | null;
  at: string;
};

const RECEIPT_CHUNK_SIZE = 20; // Below Firestore's 30-disjunction `in` limit.
const RECEIPT_MAX_ATTEMPTS = 3;
const RECEIPT_RETRY_BASE_MS = 500;

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
  const source = reason && typeof reason === "object" ? reason as Record<string, unknown> : {};
  const code = typeof source.code === "string" ? source.code : "";
  const message = reason instanceof Error ? reason.message : typeof source.message === "string" ? source.message :
    reason && typeof reason === "object" ? "Firebase operation failed." : String(reason);
  const recoveryReason = typeof source.recoveryReason === "string" ? source.recoveryReason : undefined;
  const firestoreSdkError = reason instanceof Error;
  if (code.includes("permission-denied") || code.includes("invalid-argument") || code.includes("unauthenticated"))
    return { kind: "permanent" as const, code, message, recoveryReason, firestoreSdkError };
  if (code.includes("unavailable") || code.includes("network") || code.includes("deadline-exceeded"))
    return { kind: "offline" as const, code, message, recoveryReason, firestoreSdkError };
  return { kind: "temporary" as const, code, message, recoveryReason, firestoreSdkError };
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
  const repairLockRef = () => doc(db, "users", uid, "syncMetadataV2", "repairLock");
  const originLockName = `taskmemo-firebase-user-data:${uid}`;
  const withOriginLock = async <T>(mode: "shared" | "exclusive", task: () => Promise<T>) => {
    if (typeof navigator === "undefined" || !navigator.locks) return task();
    if (mode === "exclusive") {
      const held = ((await navigator.locks.query()).held ?? []).filter(lock => lock.name === originLockName && lock.mode === "shared").length;
      recordRepairLockWait(held, held > 0);
    }
    return navigator.locks.request(originLockName, { mode }, task);
  };
  const leaseActive = (data: Record<string, unknown> | undefined) =>
    data?.expiresAt instanceof Timestamp && data.expiresAt.toMillis() > Date.now();
  let heldRepairOwner: string | null = null;
  let renewalFailed = false;

  return {
    async assertExclusiveRepair() {
      const lock = await getDocFromServer(repairLockRef());
      if (!heldRepairOwner || renewalFailed || !lock.exists() ||
          lock.data().owner !== heldRepairOwner || !leaseActive(lock.data()))
        throw { kind: "permanent", message: "自己修復lockの有効性を確認できません。" };
    },
    async withExclusiveRepair<T>(owner: string, task: () => Promise<T>): Promise<T> {
      return withOriginLock("exclusive", async () => {
      if (!owner.startsWith("sync-self-repair-")) throw new Error("自己修復lockの所有者が不正です。");
      await runTransaction(db, async transaction => {
        const current = await transaction.get(repairLockRef());
        if (current.exists() && leaseActive(current.data())) {
          recordRepairLock("blocked", owner);
          throw { code: "aborted", message: "別の自己修復が進行中です。" };
        }
        transaction.set(repairLockRef(), { owner, expiresAt: Timestamp.fromMillis(Date.now() + 90_000), acquiredAt: serverTimestamp() });
      });
      heldRepairOwner = owner;
      recordRepairLock("acquired", owner);
      renewalFailed = false;
      let renewal = Promise.resolve();
      const timer = setInterval(() => {
        renewal = renewal.then(() => runTransaction(db, async transaction => {
          const current = await transaction.get(repairLockRef());
          if (!current.exists() || current.data().owner !== owner || !leaseActive(current.data()))
            throw new Error("自己修復lockが失われました。");
          transaction.update(repairLockRef(), { expiresAt: Timestamp.fromMillis(Date.now() + 90_000) });
        })).catch(() => { renewalFailed = true; });
      }, 15_000);
      try { return await task(); }
      finally {
        clearInterval(timer);
        await renewal;
        heldRepairOwner = null;
        await runTransaction(db, async transaction => {
          const current = await transaction.get(repairLockRef());
          if (current.exists() && current.data().owner === owner) transaction.delete(repairLockRef());
        });
        recordRepairLock("released", owner);
      }
      });
    },
    async convergeRecoveryTarget(request: RecoveryConvergenceRequest) {
      try {
        const { deviceId, localSeq, createdAt } = request.identity;
        if (!deviceId.startsWith("sync-self-repair-") || !Number.isSafeInteger(localSeq) || localSeq < 1)
          throw { code: "invalid-argument", message: "自己修復operationの識別子が不正です。" };
        if (!request.diagnosticOnly && (heldRepairOwner !== deviceId || renewalFailed))
          throw { code: "aborted", message: "自己修復lockがありません。" };
        const targetNodeId = request.targetType === "node" ? request.targetNodeId : request.targetType;
        const opId = `${deviceId}:${localSeq}`;
        const receiptRef = doc(db, "users", uid, "syncOperationsV2", opId);
        const targetRef = request.targetType === "node"
          ? doc(db, "users", uid, "nodesV2", targetNodeId)
          : doc(db, "users", uid, "profileV2", targetNodeId);
        return await runTransaction(db, async (transaction) => {
          recordSyncActivity("repairTransactionAttempt", { operationId: opId, deviceId });
          const lock = await transaction.get(repairLockRef());
          if (!request.diagnosticOnly && (!lock.exists() || lock.data().owner !== deviceId || !leaseActive(lock.data()) || renewalFailed))
            throw { code: "aborted", message: "自己修復lockが失われました。" };
          const receipt = await transaction.get(receiptRef);
          if (receipt.exists()) {
            const data = receipt.data();
            const operation = data.operation as SyncOperation | undefined;
            const acknowledgement = data.acknowledgement as SyncAcknowledgement | undefined;
            if (data.ownerUid !== uid || data.schemaVersion !== 2 || operation?.opId !== opId ||
                operation.deviceId !== deviceId || operation.localSeq !== localSeq ||
                operation.createdAt !== createdAt ||
                operation.targetNodeId !== targetNodeId ||
                (operation.targetType ?? "node") !== request.targetType ||
                canonicalSyncValue(operation.payload[request.targetType === "node" ? "node" : request.targetType]) !==
                  canonicalSyncValue(request.desired) || acknowledgement?.opId !== opId ||
                acknowledgement.result !== "applied")
              throw { code: "invalid-argument", message: "既存Receiptが自己修復対象と矛盾します。" };
            return { operation, acknowledgement };
          }
          const snapshot = await transaction.get(targetRef);
          const data = snapshot.exists() ? snapshot.data() : null;
          if (data && (data.ownerUid !== uid || data.schemaVersion !== 2 ||
              (request.targetType === "node" && data.record?.value?.id !== targetNodeId)))
            throw { code: "invalid-argument", message: "Firebaseの対象Nodeが不正です。" };
          const current = data?.record as VersionedNode | VersionedPinnedNote | VersionedFeatures | undefined;
          if (current && (!Number.isSafeInteger(current.revision) || current.revision < 0))
            throw { code: "invalid-argument", message: "Firebase revisionが不正です。" };
          const alreadyDesired = canonicalSyncValue(current?.value) === canonicalSyncValue(request.desired);
          const baselineMismatch = canonicalSyncValue(current?.value ?? null) !== canonicalSyncValue(request.observed?.value ?? null);
          await recordRepairComparison(`${request.targetType}:${targetNodeId}`, request.observed, current ?? null,
            alreadyDesired ? "already-desired" : baselineMismatch ? "conflict" : "baseline-match", {
              fromCache: snapshot.metadata?.fromCache, hasPendingWrites: snapshot.metadata?.hasPendingWrites }, opId);
          if (alreadyDesired) return {};
          if (baselineMismatch) {
            if (selfRepairDiagnosticsActive() && current?.lastOpId && !current.lastOpId.includes("/")) {
              try {
                const actor = await transaction.get(doc(db, "users", uid, "syncOperationsV2", current.lastOpId));
                const actorData = actor.exists() ? actor.data() : null;
                const actorOp = actorData?.operation as SyncOperation | undefined;
                const actorAck = actorData?.acknowledgement as SyncAcknowledgement | undefined;
                recordActorReceipt({ status: actor.exists() ? "found" : "missing",
                  operationId: actorOp?.opId, deviceId: actorOp?.deviceId, localSeq: actorOp?.localSeq,
                  baseRevision: actorOp?.baseRevision, operationType: actorOp?.type,
                  producerType: typeof actorData?.producerType === "string" ? actorData.producerType : undefined,
                  acknowledgedValueMatchesCurrent: actorAck ? canonicalSyncValue(
                    (actorAck.record ?? actorAck.pinnedNoteRecord ?? actorAck.featuresRecord)?.value) === canonicalSyncValue(current.value) : undefined });
              } catch { recordActorReceipt({ status: "read-failed" }); }
            }
            throw { code: "aborted", recoveryReason: "concurrent-user-change",
              message: "事前読込とtransaction内のデータが一致しません。変更元は未特定です。診断情報を確認してください。" };
          }
          if (request.diagnosticOnly) return {};
          if (request.targetType === "node" && (current as VersionedNode | undefined)?.value.purgedAt &&
              !request.desired.purgedAt)
            throw { code: "invalid-argument", message: "完全削除済みNodeは復活できません。" };
          const type = request.targetType !== "node" ? "update" : request.desired.purgedAt ? "purge"
            : request.desired.deletedAt ? "softDelete"
              : (current as VersionedNode | undefined)?.value.deletedAt ? "restore" : current ? "update" : "create";
          const operation: SyncOperation = { opId, deviceId, localSeq, targetNodeId,
            targetType: request.targetType, type, baseRevision: current?.revision ?? 0,
            payload: { [request.targetType === "node" ? "node" : request.targetType]: request.desired },
            createdAt, status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null };
          const acknowledgement = request.targetType === "node"
            ? applyRevisionOperation(current as VersionedNode | undefined, operation)
            : request.targetType === "pinnedNote"
              ? applyPinnedNoteOperation(current as VersionedPinnedNote | undefined, operation)
              : applyFeaturesOperation(current as VersionedFeatures | undefined, operation);
          if (acknowledgement.result !== "applied")
            throw { code: "invalid-argument", message: "自己修復operationがFirebase上で適用されませんでした。" };
          transaction.set(targetRef, { ownerUid: uid, schemaVersion: 2,
            record: acknowledgement.record ?? acknowledgement.pinnedNoteRecord ?? acknowledgement.featuresRecord,
            serverUpdatedAt: serverTimestamp() });
          transaction.set(receiptRef, { ownerUid: uid, schemaVersion: 2, operation, acknowledgement,
            serverReceivedAt: serverTimestamp() });
          return { operation, acknowledgement };
        });
      } catch (reason) { throw adapterError(reason); }
    },
    async readRecoverySnapshot() {
      const [nodes, pinnedNote, features, receiptCount] = await Promise.all([
        getDocsFromServer(collection(db, "users", uid, "nodesV2")),
        getDocFromServer(doc(db, "users", uid, "profileV2", "pinnedNote")),
        getDocFromServer(doc(db, "users", uid, "profileV2", "features")),
        getCountFromServer(collection(db, "users", uid, "syncOperationsV2")),
      ]);
      if (nodes.metadata.fromCache || pinnedNote.metadata.fromCache || features.metadata.fromCache)
        throw { code: "preflight-cache", kind: "temporary" };
      for (const snapshot of [pinnedNote, features]) {
        if (snapshot.exists() && (snapshot.data().ownerUid !== uid || snapshot.data().schemaVersion !== 2 ||
            !snapshot.data().record || !Number.isSafeInteger(snapshot.data().record.revision)))
          throw { code: "preflight-invalid-remote", kind: "permanent" };
      }
      for (const snapshot of nodes.docs) await recordRepairSnapshot(`node:${snapshot.id}`,
        snapshot.data().record, snapshot.metadata ?? {});
      await recordRepairSnapshot("pinnedNote:pinnedNote", pinnedNote.exists() ? pinnedNote.data().record : null, pinnedNote.metadata ?? {});
      await recordRepairSnapshot("features:features", features.exists() ? features.data().record : null, features.metadata ?? {});
      return {
        nodes: nodes.docs.map((snapshot) => {
          const data = snapshot.data();
          if (data.ownerUid !== uid || data.schemaVersion !== 2 || data.record?.value?.id !== snapshot.id)
            throw { code: "preflight-invalid-remote", kind: "permanent" };
          return data.record as VersionedNode;
        }),
        pinnedNote: pinnedNote.exists() ? pinnedNote.data().record : undefined,
        features: features.exists() ? features.data().record as VersionedFeatures : undefined,
        receiptDocumentCount: receiptCount.data().count,
      };
    },
    async auditOutbox(operations) {
      const seen = new Set<string>();
      for (const operation of operations) {
        if (seen.has(operation.opId)) throw { kind: "permanent", message: "ローカルoutboxに重複operation IDがあります。復旧を停止しました。" };
        seen.add(operation.opId);
      }
      let received = 0;
      let missing = 0;
      const receivedOperationIndexes: number[] = [];
      // Keep server reads bounded; never upload until every receipt is classified.
      const chunked = options.receiptReadMode !== "parallel" && options.receiptReadMode !== "serial";
      const batchSize = chunked ? RECEIPT_CHUNK_SIZE : 8;
      for (let offset = 0; offset < operations.length; offset += batchSize) {
        const batch = operations.slice(offset, offset + batchSize);
        const batchNumber = Math.floor(offset / batchSize) + 1;
        options.onReceiptBatch?.({ phase: "start", batch: batchNumber, completed: offset, total: operations.length, lastCompletedOperationIndex: offset - 1 });
        if (chunked) {
          // Query only the existing immutable receipt documents; a successful server snapshot also proves absence.
          const receipts = query(collection(db, "users", uid, "syncOperationsV2"), where(documentId(), "in", batch.map((operation) => operation.opId)));
          let documents: Map<string, Record<string, unknown>> | null = null;
          for (let attempt = 1; attempt <= RECEIPT_MAX_ATTEMPTS; attempt++) {
            const started = Date.now();
            const startedPerformance = monotonicNow();
            let timedOut = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            let timeoutDelayMs: number | null = null;
            let timeoutTimerSetAt: string | null = null;
            let timeoutScheduledAt: string | null = null;
            let timeoutFiredAt: string | null = null;
            const event = (phase: ReceiptReadEvent["phase"], returnedDocumentCount: number | null = null, retryDelayMs: number | null = null) => {
              try { options.onReceiptRead?.({ batch: batchNumber, firstOperationIndex: offset, operationCount: batch.length,
                attempt, phase, durationMs: Math.max(0, Date.now() - started), returnedDocumentCount, retryDelayMs,
                timeoutDelayMs, performanceElapsedMs: Math.max(0, monotonicNow() - startedPerformance),
                timeoutTimerSetAt, timeoutScheduledAt, timeoutFiredAt,
                browserOnline: typeof navigator === "undefined" || typeof navigator.onLine !== "boolean" ? null : navigator.onLine,
                pageVisibility: typeof document === "undefined" ? null : document.visibilityState,
                at: new Date().toISOString() }); }
              catch { /* Diagnostic callbacks must not affect recovery. */ }
            };
            try {
              const timeoutMs = options.receiptLookupTimeoutMs ?? 10_000;
              const timeoutPromise = timeoutMs && timeoutMs > 0 ? new Promise<never>((_, reject) => {
                const setAt = Date.now();
                const deadline = setAt + timeoutMs;
                timeoutTimerSetAt = new Date(setAt).toISOString();
                timeoutScheduledAt = new Date(deadline).toISOString();
                timer = setTimeout(() => {
                  timedOut = true;
                  const firedAt = Date.now();
                  timeoutFiredAt = new Date(firedAt).toISOString();
                  timeoutDelayMs = Math.max(0, firedAt - deadline);
                  reject({ kind: "temporary", code: "receipt-timeout", message: "Firebase receipt read timed out; recovery stopped." });
                }, timeoutMs);
              }) : null;
              event("start"); // Counts an actual getDocsFromServer invocation, not billable document reads.
              const serverRead = getDocsFromServer(receipts);
              void serverRead.then(() => { if (timedOut) event("late-resolve"); }, () => { if (timedOut) event("late-reject"); });
              const snapshot = timeoutPromise ? await Promise.race([serverRead, timeoutPromise]) : await serverRead;
              if (snapshot.metadata?.fromCache) throw { kind: "temporary", message: "Firebase receipt query returned cache data; recovery stopped." };
              const requested = new Set(batch.map((operation) => operation.opId));
              documents = new Map();
              for (const document of snapshot.docs) {
                if (!requested.has(document.id) || documents.has(document.id))
                  throw { kind: "permanent", message: "Firebaseのreceipt queryに予期しないdocumentがあります。復旧を停止しました。" };
                documents.set(document.id, document.data());
              }
              event("success", documents.size);
              if (attempt > 1) event("retry-success", documents.size);
              break;
            } catch (reason) {
              if (timer) { clearTimeout(timer); timer = undefined; }
              const normalized = reason && typeof reason === "object" && "kind" in reason ? reason : adapterError(reason);
              event(timedOut ? "timeout" : "error");
              if (normalized.kind === "permanent" || attempt === RECEIPT_MAX_ATTEMPTS) {
                event("final-failure");
                throw normalized;
              }
              const retryDelayMs = RECEIPT_RETRY_BASE_MS * 2 ** (attempt - 1);
              event("retry", null, retryDelayMs);
              await diagnosticPause(retryDelayMs);
            } finally {
              if (timer) clearTimeout(timer);
            }
          }
          if (!documents) throw { kind: "temporary", message: "Firebase receipt read did not complete." };
          for (const [slot, operation] of batch.entries()) {
            const data = documents.get(operation.opId);
            if (!data) { missing++; continue; }
            const acknowledgement = data.acknowledgement as SyncAcknowledgement | undefined;
            if (!sameOperation(data.operation, operation) || acknowledgement?.opId !== operation.opId ||
                (acknowledgement.result !== "applied" && acknowledgement.result !== "superseded"))
              throw { kind: "permanent", message: "Firebaseのoperation受領記録がローカルoutboxと矛盾します。復旧を停止しました。" };
            received++;
            receivedOperationIndexes.push(offset + slot);
          }
          options.onReceiptBatch?.({ phase: "complete", batch: batchNumber, completed: offset + batch.length, total: operations.length, lastCompletedOperationIndex: offset + batch.length - 1 });
          continue;
        }
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
        results.forEach((found, slot) => { if (found) receivedOperationIndexes.push(offset + slot); });
        options.onReceiptBatch?.({ phase: "complete", batch: batchNumber, completed: offset + batch.length, total: operations.length, lastCompletedOperationIndex: offset + batch.length - 1 });
      }
      return { received, missing, receivedOperationIndexes };
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

    async upload(operation: SyncOperation, expected?: SyncAcknowledgement,
      expectedCurrent?: VersionedNode | null, mayStart?: () => boolean) {
      return withOriginLock("shared", async () => {
      if (mayStart && !mayStart())
        throw { kind: "offline", message: "停止済みuploadを送信しません。" };
      recordSyncActivity("normalUploadAttempt", { operationId: operation.opId, deviceId: operation.deviceId });
      const emit = (event: RecoveryTransactionEvent) => {
        if (expected) try { options.onRecoveryTransaction?.(event); }
        catch { /* Diagnostics must never affect transaction behavior. */ }
      };
      try {
        const operationRef = doc(db, "users", uid, "syncOperationsV2", operation.opId);
        const pinnedNote = operation.targetType === "pinnedNote";
        const features = operation.targetType === "features";
        const targetRef = pinnedNote
          ? doc(db, "users", uid, "profileV2", "pinnedNote")
          : features
            ? doc(db, "users", uid, "profileV2", "features")
            : doc(db, "users", uid, "nodesV2", operation.targetNodeId);
        let outcome: RecoveryTransactionEvent = { phase: "success", receipt: null, nodeWrite: false, serverWinnerNoWrite: false };
        const acknowledgement = await runTransaction(db, async (transaction) => {
          emit({ phase: "start", receipt: null, nodeWrite: false, serverWinnerNoWrite: false });
          const lock = await transaction.get(repairLockRef());
          if (lock.exists() && leaseActive(lock.data())) {
            recordNormalUploadBlockedByRepair();
            throw { code: "aborted", message: "自己修復中のため通常同期書き込みを停止しました。" };
          }
          const existing = await transaction.get(operationRef);
          if (existing.exists()) {
            const data = existing.data();
            if (!sameOperation(data.operation, operation)) {
              throw { code: "invalid-argument", recoveryReason: "receipt-payload-mismatch", message: "opId collision with different payload" };
            }
            if (expected && !sameOperation(data.acknowledgement, expected))
              throw { code: "invalid-argument", recoveryReason: "receipt-acknowledgement-mismatch", message: "recovery acknowledgement differs from preflight" };
            outcome = { phase: "success", receipt: "existing", nodeWrite: false, serverWinnerNoWrite: false };
            return data.acknowledgement as SyncAcknowledgement;
          }
          const targetSnapshot = await transaction.get(targetRef);
          if (expectedCurrent !== undefined &&
              !sameOperation(targetSnapshot.exists() ? targetSnapshot.data().record : null, expectedCurrent))
            throw { code: "invalid-argument", recoveryReason: "predicted-base-mismatch",
              message: "recovery target changed after the saved preflight" };
          const acknowledgement = pinnedNote
            ? applyPinnedNoteOperation(targetSnapshot.exists() ? targetSnapshot.data().record : undefined, operation)
            : features
              ? applyFeaturesOperation(targetSnapshot.exists() ? targetSnapshot.data().record : undefined, operation)
              : applyRevisionOperation(targetSnapshot.exists() ? targetSnapshot.data().record as VersionedNode : undefined, operation);
          if (expected && !sameOperation(acknowledgement, expected))
            throw { code: "invalid-argument", recoveryReason: "predicted-winner-mismatch", message: "recovery winner differs from preflight" };
          if (acknowledgement.result === "applied") transaction.set(targetRef, { ownerUid: uid, schemaVersion: 2, record: pinnedNote ? acknowledgement.pinnedNoteRecord : features ? acknowledgement.featuresRecord : acknowledgement.record, serverUpdatedAt: serverTimestamp() });
          transaction.set(operationRef, { ownerUid: uid, schemaVersion: 2, operation, acknowledgement, serverReceivedAt: serverTimestamp() });
          outcome = { phase: "success", receipt: "created", nodeWrite: acknowledgement.result === "applied",
            serverWinnerNoWrite: acknowledgement.result === "superseded" };
          return acknowledgement;
        });
        emit(outcome);
        recordSyncActivity("normalUploadSucceeded", { operationId: operation.opId, deviceId: operation.deviceId });
        recordNormalWriteDuringRepair();
        return acknowledgement;
      } catch (reason) {
        emit({ phase: "failure", receipt: null, nodeWrite: false, serverWinnerNoWrite: false });
        throw adapterError(reason);
      }
      });
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
          recordSyncActivity("listenerReceived", { operationId: record?.lastOpId, deviceId: record?.lastDeviceId });
          if (record) void Promise.resolve(onRecord(record)).catch(onError);
        }
      }, onError);
    },
    subscribePinnedNote(onRecord, onError) {
      return onSnapshot(doc(db, "users", uid, "profileV2", "pinnedNote"), { includeMetadataChanges: true }, (snapshot) => {
        const record = snapshot.data()?.record;
        recordSyncActivity("listenerReceived", { operationId: record?.lastOpId, deviceId: record?.lastDeviceId });
        if (record) void Promise.resolve(onRecord(record)).catch(onError);
      }, onError);
    },
    subscribeFeatures(onRecord, onError) {
      return onSnapshot(doc(db, "users", uid, "profileV2", "features"), { includeMetadataChanges: true }, (snapshot) => {
        const record = snapshot.data()?.record as VersionedFeatures | undefined;
        recordSyncActivity("listenerReceived", { operationId: record?.lastOpId, deviceId: record?.lastDeviceId });
        if (record) void Promise.resolve(onRecord(record)).catch(onError);
      }, onError);
    },
  };
}
