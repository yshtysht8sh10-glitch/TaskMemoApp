/** Diagnostic metadata only. Never store operation IDs, payloads, account IDs, or raw error messages. */
import type { ReceiptLookupEvent, ReceiptReadEvent, RecoveryTransactionEvent } from "./firebaseSyncAdapter";
import type { RecoveryPreflight } from "./recoveryPreflight";
import type { RecoveryFailureReason } from "./recoveryFailure";

export const RECOVERY_OBSERVATION_KEY = "@taskmemo/recovery-observation/v1";

export type RecoveryExecutionPhase = "final-safety-check" | "pre-execution-receipt-audit" |
  "upload" | "post-execution-receipt-audit" | "local-state-finalization" | "completed";

export type RecoveryExecutionObservation = {
  startedAt: string | null; endedAt: string | null;
  status: "not-started" | "running" | "succeeded" | "failed";
  totalOperations: number; uploadAttemptedCount: number; uploadSucceededCount: number;
  uploadFailedCount: number; uploadSupersededCount: number;
  lastCompletedOperationIndex: number; currentOperationIndex: number | null;
  lastSuccessfulOperationIndex: number; elapsedMs: number;
  currentPhase: RecoveryExecutionPhase | null; lastCompletedPhase: RecoveryExecutionPhase | null;
  failurePhase: RecoveryExecutionPhase | null; failedOperationIndex: number | null;
  failedOperationType: string | null; errorCode: string | null;
  errorMessage: string | null; failureReason: RecoveryFailureReason | null;
  preExecutionReceiptReceivedCount: number | null; preExecutionReceiptMissingCount: number | null;
  postExecutionReceiptReceivedCount: number | null; postExecutionReceiptMissingCount: number | null;
  postExecutionReceiptAuditCompleted: boolean; postExecutionReceiptAuditError: string | null;
  transactionStartedCount: number; transactionSucceededCount: number; transactionFailedCount: number;
  receiptExistingCount: number; receiptCreatedCount: number; nodeWriteCount: number;
  serverWinnerNoWriteCount: number;
};

const initialExecution = (): RecoveryExecutionObservation => ({
  startedAt: null, endedAt: null, status: "not-started", totalOperations: 0,
  uploadAttemptedCount: 0, uploadSucceededCount: 0, uploadFailedCount: 0,
  uploadSupersededCount: 0, lastCompletedOperationIndex: -1, currentOperationIndex: null,
  lastSuccessfulOperationIndex: -1, elapsedMs: 0, currentPhase: null,
  lastCompletedPhase: null, failurePhase: null, failedOperationIndex: null,
  failedOperationType: null, errorCode: null, errorMessage: null, failureReason: null,
  preExecutionReceiptReceivedCount: null, preExecutionReceiptMissingCount: null,
  postExecutionReceiptReceivedCount: null, postExecutionReceiptMissingCount: null,
  postExecutionReceiptAuditCompleted: false, postExecutionReceiptAuditError: null,
  transactionStartedCount: 0, transactionSucceededCount: 0, transactionFailedCount: 0,
  receiptExistingCount: 0, receiptCreatedCount: 0, nodeWriteCount: 0,
  serverWinnerNoWriteCount: 0,
});

export type RecoveryObservation = {
  recoveryPhase: string;
  receiptComparisonTotal: number;
  receiptComparisonCompleted: number;
  receiptReceivedCount: number;
  receiptMissingCount: number;
  currentBatch: number;
  lastCompletedOperationIndex: number;
  lastProgressAt: string;
  firebaseConnectionState: "not-started" | "connecting" | "connected" | "error";
  lastRecoveryError: string | null;
  receiptReadMode: "chunked" | "parallel" | "serial";
  receiptLookupTimeoutMs: number;
  receiptLookupIntervalMs: number;
  receiptChunkSize: number;
  receiptMaxAttempts: number;
  receiptServerReadCalls: number;
  receiptServerDocumentsReturned: number;
  receiptRetryCount: number;
  batchEvents: { batch: number; phase: "start" | "complete"; completed: number; at: string }[];
  lookupEvents: (ReceiptLookupEvent & { at: string })[];
  receiptReadEvents: ReceiptReadEvent[];
  preflight: RecoveryPreflight | null;
  execution: RecoveryExecutionObservation;
};

const initial = (): RecoveryObservation => ({
  recoveryPhase: "starting",
  receiptComparisonTotal: 0,
  receiptComparisonCompleted: 0,
  receiptReceivedCount: 0,
  receiptMissingCount: 0,
  currentBatch: 0,
  lastCompletedOperationIndex: -1,
  lastProgressAt: new Date().toISOString(),
  firebaseConnectionState: "not-started",
  lastRecoveryError: null,
  receiptReadMode: "chunked",
  receiptLookupTimeoutMs: 0,
  receiptLookupIntervalMs: 0,
  receiptChunkSize: 20,
  receiptMaxAttempts: 3,
  receiptServerReadCalls: 0,
  receiptServerDocumentsReturned: 0,
  receiptRetryCount: 0,
  batchEvents: [],
  lookupEvents: [],
  receiptReadEvents: [],
  preflight: null,
  execution: initialExecution(),
});

let current = initial();

export function beginRecoveryObservation() {
  current = initial();
  persist();
}

export function recordRecoveryObservation(update: Partial<Omit<RecoveryObservation, "lastProgressAt">>) {
  const at = new Date().toISOString();
  const phase: "start" | "complete" | null = update.recoveryPhase === "receipt-batch-start" ? "start"
    : update.recoveryPhase === "receipt-batch-complete" ? "complete" : null;
  const batchEvents = phase && Number.isSafeInteger(update.currentBatch) && Number.isSafeInteger(update.receiptComparisonCompleted)
    ? [...current.batchEvents, { batch: update.currentBatch!, phase, completed: update.receiptComparisonCompleted!, at }]
    : current.batchEvents;
  const lookupEvents = phase === "start" ? [] : current.lookupEvents;
  current = { ...current, ...update, batchEvents, lookupEvents, lastProgressAt: at };
  persist();
}

export function recordRecoveryExecution(update: Partial<RecoveryExecutionObservation>) {
  current = { ...current, execution: { ...current.execution, ...update }, lastProgressAt: new Date().toISOString() };
  persist();
}

export function recordRecoveryTransaction(event: RecoveryTransactionEvent) {
  const execution = current.execution;
  const increment = (condition: boolean) => Number(condition);
  recordRecoveryExecution({
    transactionStartedCount: execution.transactionStartedCount + increment(event.phase === "start"),
    transactionSucceededCount: execution.transactionSucceededCount + increment(event.phase === "success"),
    transactionFailedCount: execution.transactionFailedCount + increment(event.phase === "failure"),
    receiptExistingCount: execution.receiptExistingCount + increment(event.phase === "success" && event.receipt === "existing"),
    receiptCreatedCount: execution.receiptCreatedCount + increment(event.phase === "success" && event.receipt === "created"),
    nodeWriteCount: execution.nodeWriteCount + increment(event.phase === "success" && event.nodeWrite),
    serverWinnerNoWriteCount: execution.serverWinnerNoWriteCount + increment(event.phase === "success" && event.serverWinnerNoWrite),
  });
}

export function recordReceiptLookup(event: ReceiptLookupEvent) {
  const at = new Date().toISOString();
  current = { ...current,
    receiptServerReadCalls: current.receiptServerReadCalls + (event.phase === "start" ? 1 : 0),
    receiptServerDocumentsReturned: current.receiptServerDocumentsReturned + (event.phase === "found" ? 1 : 0),
    lookupEvents: [...current.lookupEvents, { ...event, at }].slice(-32), lastProgressAt: at };
  persist();
}

export function recordReceiptRead(event: ReceiptReadEvent) {
  current = { ...current,
    receiptServerReadCalls: current.receiptServerReadCalls + (event.phase === "start" ? 1 : 0),
    receiptServerDocumentsReturned: current.receiptServerDocumentsReturned + (event.phase === "success" ? event.returnedDocumentCount ?? 0 : 0),
    receiptRetryCount: current.receiptRetryCount + (event.phase === "retry" ? 1 : 0),
    receiptReadEvents: [...current.receiptReadEvents, event].slice(-64), lastProgressAt: event.at };
  persist();
}

export function recoveryErrorCode(reason: unknown): string {
  if (reason && typeof reason === "object") {
    const candidate = "code" in reason ? reason.code : "kind" in reason ? reason.kind : "name" in reason ? reason.name : null;
    if (typeof candidate === "string" && /^[a-z0-9/_-]{1,80}$/i.test(candidate)) return candidate;
  }
  return "unknown";
}

function persist() {
  try {
    if (typeof window !== "undefined") window.sessionStorage.setItem(RECOVERY_OBSERVATION_KEY, JSON.stringify(current));
  } catch { /* Observation must never change recovery behavior. */ }
}
