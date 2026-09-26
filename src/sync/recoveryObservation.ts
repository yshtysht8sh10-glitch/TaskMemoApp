/** Diagnostic metadata only. Never store operation IDs, payloads, account IDs, or error messages. */
export const RECOVERY_OBSERVATION_KEY = "@taskmemo/recovery-observation/v1";

export type RecoveryObservation = {
  recoveryPhase: string;
  receiptComparisonTotal: number;
  receiptComparisonCompleted: number;
  currentBatch: number;
  lastCompletedOperationIndex: number;
  lastProgressAt: string;
  firebaseConnectionState: "not-started" | "connecting" | "connected" | "error";
  lastRecoveryError: string | null;
  receiptReadMode: "parallel" | "serial";
  receiptLookupTimeoutMs: number;
  batchEvents: { batch: number; phase: "start" | "complete"; completed: number; at: string }[];
  lookupEvents: { batch: number; slot: number; operationIndex: number; phase: "start" | "found" | "not-found" | "error" | "timeout"; durationMs: number; at: string }[];
};

const initial = (): RecoveryObservation => ({
  recoveryPhase: "starting",
  receiptComparisonTotal: 0,
  receiptComparisonCompleted: 0,
  currentBatch: 0,
  lastCompletedOperationIndex: -1,
  lastProgressAt: new Date().toISOString(),
  firebaseConnectionState: "not-started",
  lastRecoveryError: null,
  receiptReadMode: "parallel",
  receiptLookupTimeoutMs: 0,
  batchEvents: [],
  lookupEvents: [],
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

export function recordReceiptLookup(event: Omit<RecoveryObservation["lookupEvents"][number], "at">) {
  const at = new Date().toISOString();
  current = { ...current, lookupEvents: [...current.lookupEvents, { ...event, at }].slice(-32), lastProgressAt: at };
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
