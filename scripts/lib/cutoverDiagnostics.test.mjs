import { describe, expect, it } from "vitest";
import { assessCutoverDiagnostics } from "./cutoverDiagnostics.mjs";

const clear = { events: [], clients: [{ id: "a", syncPhase: "synced", outboxOldestAgeMs: 0, networkConfirmedOnline: true, convergenceHash: "same" }, { id: "b", syncPhase: "synced", outboxOldestAgeMs: 0, networkConfirmedOnline: true, convergenceHash: "same" }] };

describe("cutover canary diagnostics", () => {
  it("continues only when critical counters are zero and clients converge", () => expect(assessCutoverDiagnostics(clear)).toEqual({ decision: "CONTINUE", reasons: [] }));
  it.each(["v1-write-attempt", "schema-owner-failure", "receipt-missing", "revision-regression", "functions-partial-transaction"])("stops on one %s", (kind) => {
    expect(assessCutoverDiagnostics({ ...clear, events: [{ kind, count: 1 }] }).decision).toBe("STOP");
  });
  it("stops on an online outbox older than five minutes or convergence mismatch", () => {
    expect(assessCutoverDiagnostics({ ...clear, clients: [{ ...clear.clients[0], outboxOldestAgeMs: 300_001 }] }).decision).toBe("STOP");
    expect(assessCutoverDiagnostics({ ...clear, clients: [clear.clients[0], { ...clear.clients[1], convergenceHash: "different" }] }).decision).toBe("STOP");
  });
});
