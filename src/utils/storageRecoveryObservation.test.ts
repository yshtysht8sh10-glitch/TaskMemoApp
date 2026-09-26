import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

const script = readFileSync("public/storage-diagnostics.js", "utf8");

it("exports only validated recovery metadata, never injected IDs or private strings", () => {
  const handlers = new Map<string, () => void>();
  const result = { value: "", focus() {}, select() {} };
  const status = { textContent: "" };
  const stored = JSON.stringify({ recoveryPhase: "receipt-batch-start", receiptComparisonTotal: 1024,
    receiptComparisonCompleted: 8, currentBatch: 2, lastCompletedOperationIndex: 7,
    receiptReadMode: "serial", receiptLookupTimeoutMs: 10000, receiptLookupIntervalMs: 100,
    receiptChunkSize: 20, receiptMaxAttempts: 3, receiptServerReadCalls: 2,
    receiptServerDocumentsReturned: 4, receiptRetryCount: 1,
    lastProgressAt: "2026-09-26T07:00:00.000Z", firebaseConnectionState: "connected",
    lastRecoveryError: "private@example.com", opId: "SECRET_OP", title: "SECRET_TITLE",
    preflight: { remoteNodeCount: 150, journalNodeCount: 151, journalOnlyNodeCount: 1,
      dryRunSuccessCount: 1024, dryRunMatchesJournal: true, localCopyMatches: true,
      dryRunConflictCount: 664, dryRunConflictByType: { update: 664, title: "SECRET_TITLE" },
      dryRunConflictByReason: { staleBaseRevision: 664, opId: "SECRET_OP" },
      dryRunConflictCountsPerNodeDescending: [19, 17],
      dryRunJournalNodeDifference: { userContent: 0, revisionOnly: 3, title: "SECRET_TITLE" },
      decision: "review-required", opId: "SECRET_OP", title: "SECRET_TITLE" },
    batchEvents: [{ batch: 2, phase: "start", completed: 8, at: "2026-09-26T07:00:00.000Z", opId: "SECRET_OP" }],
    lookupEvents: [{ batch: 84, slot: 0, operationIndex: 664, phase: "timeout", durationMs: 20000,
      startedAt: "2026-09-26T07:00:00.000Z", performanceElapsedMs: 20001,
      timeoutTimerSetAt: "2026-09-26T07:00:00.000Z", timeoutScheduledAt: "2026-09-26T07:00:10.000Z",
      timeoutFiredAt: "2026-09-26T07:00:20.000Z", timeoutDelayMs: 10000,
      at: "2026-09-26T07:00:20.000Z", opId: "SECRET_OP", title: "SECRET_TITLE" }],
    receiptReadEvents: [{ batch: 1, firstOperationIndex: 0, operationCount: 20, attempt: 2, phase: "retry-success",
      durationMs: 77, returnedDocumentCount: 4, retryDelayMs: null, timeoutDelayMs: null,
      at: "2026-09-26T07:00:20.000Z", opId: "SECRET_OP", title: "SECRET_TITLE" }] });
  runInNewContext(script, {
    document: {
      getElementById: (id: string) => id === "result" ? result : id === "status" ? status : { addEventListener: (_event: string, action: () => void) => handlers.set(id, action) },
      querySelector: (selector: string) => ({ content: selector.includes("version") ? "1.0.0" : "COMMIT" }),
    },
    window: { localStorage: { length: 0, key: () => null, getItem: () => null },
      sessionStorage: { getItem: () => stored }, matchMedia: () => ({ matches: true }) },
    location: { origin: "https://taskmemoapp-eabc3.web.app" }, navigator: { standalone: true },
  });
  handlers.get("measure")!();
  const output = JSON.parse(result.value);
  expect(output.recoveryObservation).toMatchObject({ recoveryPhase: "receipt-batch-start", receiptComparisonTotal: 1024,
    receiptComparisonCompleted: 8, currentBatch: 2, lastCompletedOperationIndex: 7, lastRecoveryError: null,
    receiptReadMode: "serial", receiptLookupTimeoutMs: 10000, receiptLookupIntervalMs: 100 });
  expect(output.recoveryObservation).toMatchObject({ receiptChunkSize: 20, receiptMaxAttempts: 3,
    receiptServerReadCalls: 2, receiptServerDocumentsReturned: 4, receiptRetryCount: 1 });
  expect(output.recoveryObservation.receiptReadEvents).toMatchObject([{ attempt: 2, phase: "retry-success", returnedDocumentCount: 4 }]);
  expect(output.recoveryObservation.preflight).toMatchObject({ remoteNodeCount: 150, journalNodeCount: 151,
    dryRunSuccessCount: 1024, decision: "review-required",
    dryRunConflictByType: { update: 664 }, dryRunConflictByReason: { staleBaseRevision: 664 },
    dryRunConflictCountsPerNodeDescending: [19, 17], dryRunJournalNodeDifference: { userContent: 0, revisionOnly: 3 } });
  expect(output.recoveryObservation.batchEvents).toMatchObject([{ batch: 2, phase: "start", completed: 8 }]);
  expect(output.recoveryObservation.lookupEvents).toMatchObject([{ batch: 84, slot: 0, operationIndex: 664, phase: "timeout", durationMs: 20000,
    startedAt: "2026-09-26T07:00:00.000Z", performanceElapsedMs: 20001, timeoutDelayMs: 10000 }]);
  expect(result.value).not.toMatch(/SECRET_OP|SECRET_TITLE|private@example.com/);
  expect(script).not.toMatch(/\.(?:setItem|removeItem|clear)\s*\(/);
});
