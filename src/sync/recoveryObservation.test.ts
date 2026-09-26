import { afterEach, describe, expect, it, vi } from "vitest";

import { beginRecoveryObservation, recordReceiptLookup, recordRecoveryObservation, recoveryErrorCode, RECOVERY_OBSERVATION_KEY } from "./recoveryObservation";

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
    recordReceiptLookup({ batch: 2, slot: 0, operationIndex: 8, phase: "timeout", durationMs: 20000 });
    expect(JSON.parse(session.get(RECOVERY_OBSERVATION_KEY)!).lookupEvents).toMatchObject([{ batch: 2, slot: 0, operationIndex: 8, phase: "timeout", durationMs: 20000 }]);
    expect(localWrite).not.toHaveBeenCalled();
    expect(session.size).toBe(1);
  });

  it("does not copy arbitrary exception messages or user data into the error code", () => {
    expect(recoveryErrorCode(new Error("secret@example.com op-id:123"))).toBe("Error");
    expect(recoveryErrorCode({ code: "secret@example.com" })).toBe("unknown");
    expect(recoveryErrorCode({ kind: "offline", message: "private title" })).toBe("offline");
  });
});
