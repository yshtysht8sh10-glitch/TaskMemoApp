import { afterEach, describe, expect, it, vi } from "vitest";
import { beginSelfRepairDiagnostics, finishSelfRepairDiagnostics, getSelfRepairDiagnostics,
  recordRepairComparison, recordRepairSnapshot, recordSyncActivity, SELF_REPAIR_DIAGNOSTICS_KEY,
  SELF_REPAIR_READ_ONLY_EVIDENCE_KEY } from "./selfRepairDiagnostics";

const before = { value: { id: "n", title: "private title", updatedAt: "2026-01-01", body: null },
  revision: 4, lastOpId: "old:4", lastDeviceId: "old", lastLocalSeq: 4, operationType: "update" };

describe("self repair evidence", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("records field hashes, metadata and baseline mutation without exporting user text", async () => {
    beginSelfRepairDiagnostics("local-device", true);
    const expected = structuredClone(before);
    await recordRepairSnapshot("node:n", expected, { fromCache: false, hasPendingWrites: true });
    expected.value.updatedAt = "2026-02-01";
    await recordRepairComparison("node:n", expected, before, "conflict", { fromCache: false, hasPendingWrites: false });
    const report = getSelfRepairDiagnostics()!;
    expect(report.conflict).toMatchObject({ target: "node:n", conflictNodeId: "n", differentFields: ["updatedAt"],
      baselineMutatedInMemory: true, beforeMetadata: { revision: 4 }, afterMetadata: { lastOpId: "old:4" } });
    expect(report.conflict?.beforeFields.updatedAt.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(report)).not.toContain("private title");
    expect(report.conflict?.initialRead).toMatchObject({ hasPendingWrites: true });
    finishSelfRepairDiagnostics("failed");
  });
  it("records actual activity and freezes counters after the run", () => {
    beginSelfRepairDiagnostics("device", true);
    recordSyncActivity("normalUploadAttempt", { operationId: "device:7" });
    recordSyncActivity("outboxGenerated", {}, 3);
    finishSelfRepairDiagnostics("diagnosed");
    recordSyncActivity("normalUploadAttempt");
    expect(getSelfRepairDiagnostics()?.counters).toMatchObject({ normalUploadAttempt: 1, outboxGenerated: 3 });
  });
  it("archives the completed 159-comparison read-only evidence before a write run and durably records its conflict", async () => {
    const session = new Map<string, string>(), local = new Map<string, string>();
    const storage = (values: Map<string, string>) => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    vi.stubGlobal("window", { sessionStorage: storage(session), localStorage: storage(local) });
    session.set(SELF_REPAIR_DIAGNOSTICS_KEY, JSON.stringify({
      version: 1, status: "diagnosed", readOnly: true, comparisons: 159, conflict: null, differences: [] }));
    beginSelfRepairDiagnostics("local", false);
    expect(JSON.parse(local.get(SELF_REPAIR_READ_ONLY_EVIDENCE_KEY)!)).toMatchObject({ comparisons: 159, readOnly: true });
    recordSyncActivity("repairCommitted", { operationId: "repair:1" });
    await recordRepairComparison("node:n", before, { ...before, value: { ...before.value, title: "changed" } },
      "conflict", { fromCache: false, hasPendingWrites: false }, "repair:2");
    finishSelfRepairDiagnostics("failed");
    const saved = JSON.parse(local.get(SELF_REPAIR_DIAGNOSTICS_KEY)!);
    expect(saved).toMatchObject({ status: "failed", conflict: { conflictNodeId: "n", operationId: "repair:2",
      differentFields: ["title"], lastSuccessfulRepairOperationId: "repair:1" },
    counters: { repairCommitted: 1, normalUploadAttempt: 0, listenerReceived: 0, outboxGenerated: 0 } });
    expect(JSON.stringify(saved)).not.toContain("private title");
    expect(JSON.parse(local.get(SELF_REPAIR_READ_ONLY_EVIDENCE_KEY)!)).toMatchObject({ comparisons: 159 });
  });
  it("refuses a write run if durable diagnostic storage is unavailable", () => {
    vi.stubGlobal("window", { sessionStorage: { getItem: () => null, setItem: () => undefined },
      localStorage: { getItem: () => null, setItem: () => { throw new Error("quota"); } } });
    expect(() => beginSelfRepairDiagnostics("local", false)).toThrow("永続保存できません");
    try { finishSelfRepairDiagnostics("failed"); } catch { /* Expected storage failure. */ }
  });
});
