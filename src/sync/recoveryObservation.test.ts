import { afterEach, describe, expect, it, vi } from "vitest";

import { beginRecoveryObservation, recordReceiptLookup, recordReceiptRead, recordRecoveryObservation,
  recordRecoveryExecution, recordRecoveryTransaction, recoveryErrorCode, RECOVERY_OBSERVATION_KEY } from "./recoveryObservation";
import { recoveryFailureDetails } from "./recoveryFailure";

afterEach(() => vi.unstubAllGlobals());

describe("session-only recovery metadata", () => {
  it("records only counts, phase, and timestamps outside localStorage and IndexedDB", () => {
    const session = new Map<string, string>();
    const localWrite = vi.fn();
    vi.stubGlobal("window", { sessionStorage: { setItem: (key: string, value: string) => session.set(key, value) }, localStorage: { setItem: localWrite } });
    beginRecoveryObservation();
    recordRecoveryObservation({ recoveryPhase: "receipt-batch-start", receiptComparisonTotal: 1024,
      receiptComparisonCompleted: 8, currentBatch: 2, lastCompletedOperationIndex: 7, firebaseConnectionState: "connected" });
    const saved = JSON.parse(session.get(RECOVERY_OBSERVATION_KEY)!);
    expect(saved).toMatchObject({ recoveryPhase: "receipt-batch-start", receiptComparisonTotal: 1024,
      receiptComparisonCompleted: 8, currentBatch: 2, lastCompletedOperationIndex: 7, firebaseConnectionState: "connected" });
    expect(saved.batchEvents).toMatchObject([{ batch: 2, phase: "start", completed: 8 }]);
    recordRecoveryObservation({ receiptReadMode: "serial", receiptLookupIntervalMs: 100, receiptLookupTimeoutMs: 10000 });
    recordReceiptLookup({ batch: 2, slot: 0, operationIndex: 8, phase: "timeout", startedAt: "2026-09-26T07:00:00.000Z",
      durationMs: 20000, performanceElapsedMs: 20001, timeoutTimerSetAt: "2026-09-26T07:00:00.000Z",
      timeoutScheduledAt: "2026-09-26T07:00:10.000Z", timeoutFiredAt: "2026-09-26T07:00:20.000Z", timeoutDelayMs: 10000 });
    expect(JSON.parse(session.get(RECOVERY_OBSERVATION_KEY)!).lookupEvents).toMatchObject([{ batch: 2, slot: 0, operationIndex: 8, phase: "timeout", durationMs: 20000 }]);
    expect(JSON.parse(session.get(RECOVERY_OBSERVATION_KEY)!)).toMatchObject({ receiptReadMode: "serial", receiptLookupIntervalMs: 100, receiptLookupTimeoutMs: 10000 });
    const read = (phase: "start" | "retry" | "success" | "retry-success", attempt: number, returnedDocumentCount: number | null = null) =>
      recordReceiptRead({ batch: 1, firstOperationIndex: 0, operationCount: 20, attempt, phase, durationMs: 10,
        returnedDocumentCount, retryDelayMs: phase === "retry" ? 500 : null, timeoutDelayMs: null, at: "2026-09-26T07:00:00.000Z" });
    read("start", 1); read("retry", 1); read("start", 2); read("success", 2, 4); read("retry-success", 2, 4);
    expect(JSON.parse(session.get(RECOVERY_OBSERVATION_KEY)!)).toMatchObject({ receiptServerReadCalls: 2,
      receiptServerDocumentsReturned: 4, receiptRetryCount: 1 });
    expect(localWrite).not.toHaveBeenCalled();
    expect(session.size).toBe(1);
  });

  it("does not copy arbitrary exception messages or user data into the error code", () => {
    expect(recoveryErrorCode(new Error("secret@example.com op-id:123"))).toBe("Error");
    expect(recoveryErrorCode({ code: "secret@example.com" })).toBe("unknown");
    expect(recoveryErrorCode({ kind: "offline", message: "private title" })).toBe("offline");
  });

  it("persists execution progress and committed transaction counters without content", () => {
    const session = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: { setItem: (key: string, value: string) => session.set(key, value) } });
    beginRecoveryObservation();
    recordRecoveryExecution({ status: "running", totalOperations: 1024, currentPhase: "upload",
      uploadAttemptedCount: 465, uploadSucceededCount: 464, currentOperationIndex: 464,
      lastSuccessfulOperationIndex: 463 });
    recordRecoveryTransaction({ phase: "start", receipt: null, nodeWrite: false, serverWinnerNoWrite: false });
    recordRecoveryTransaction({ phase: "success", receipt: "created", nodeWrite: false, serverWinnerNoWrite: true });
    recordRecoveryExecution({ status: "failed", uploadFailedCount: 1, failedOperationIndex: 464,
      failurePhase: "upload", ...recoveryFailureDetails({ code: "invalid-argument",
        recoveryReason: "predicted-winner-mismatch", message: "private title" }) });
    expect(JSON.parse(session.get(RECOVERY_OBSERVATION_KEY)!).execution).toMatchObject({
      status: "failed", totalOperations: 1024, uploadAttemptedCount: 465,
      uploadSucceededCount: 464, uploadFailedCount: 1, failedOperationIndex: 464,
      lastSuccessfulOperationIndex: 463, failureReason: "predicted-winner-mismatch",
      errorCode: "invalid-argument", transactionStartedCount: 1, transactionSucceededCount: 1,
      receiptCreatedCount: 1, nodeWriteCount: 0, serverWinnerNoWriteCount: 1 });
    expect(session.get(RECOVERY_OBSERVATION_KEY)).not.toContain("private title");
  });

  it("classifies plain objects and SDK errors without storing arbitrary messages", () => {
    expect(recoveryFailureDetails({ code: "invalid-argument", recoveryReason: "receipt-payload-mismatch",
      message: "secret title" })).toMatchObject({ errorCode: "invalid-argument",
      failureReason: "receipt-payload-mismatch" });
    expect(recoveryFailureDetails(Object.assign(new Error("secret path"), { code: "invalid-argument" })))
      .toMatchObject({ errorCode: "invalid-argument", failureReason: "firestore-sdk-error" });
    expect(recoveryFailureDetails({ code: "permission-denied", message: "secret account" }))
      .toMatchObject({ errorCode: "permission-denied", failureReason: "permission-denied" });
    expect(JSON.stringify(recoveryFailureDetails({ code: "invalid-argument", message: "secret title" })))
      .not.toContain("secret title");
  });
});
