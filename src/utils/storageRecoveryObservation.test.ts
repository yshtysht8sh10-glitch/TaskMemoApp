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
    receiptReadMode: "serial", receiptLookupTimeoutMs: 10000,
    lastProgressAt: "2026-09-26T07:00:00.000Z", firebaseConnectionState: "connected",
    lastRecoveryError: "private@example.com", opId: "SECRET_OP", title: "SECRET_TITLE",
    batchEvents: [{ batch: 2, phase: "start", completed: 8, at: "2026-09-26T07:00:00.000Z", opId: "SECRET_OP" }],
    lookupEvents: [{ batch: 84, slot: 0, operationIndex: 664, phase: "timeout", durationMs: 20000,
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
    receiptReadMode: "serial", receiptLookupTimeoutMs: 10000 });
  expect(output.recoveryObservation.batchEvents).toMatchObject([{ batch: 2, phase: "start", completed: 8 }]);
  expect(output.recoveryObservation.lookupEvents).toMatchObject([{ batch: 84, slot: 0, operationIndex: 664, phase: "timeout", durationMs: 20000 }]);
  expect(result.value).not.toMatch(/SECRET_OP|SECRET_TITLE|private@example.com/);
  expect(script).not.toMatch(/\.(?:setItem|removeItem|clear)\s*\(/);
});
