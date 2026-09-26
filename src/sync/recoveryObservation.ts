/** Diagnostic metadata only. Never store operation IDs, payloads, account IDs, or error messages. */
import type { ReceiptLookupEvent, ReceiptReadEvent } from "./firebaseSyncAdapter";
import type { RecoveryPreflight } from "./recoveryPreflight";

export const RECOVERY_OBSERVATION_KEY = "@taskmemo/recovery-observation/v1";

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
