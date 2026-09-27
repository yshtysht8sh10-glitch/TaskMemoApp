import { describe, expect, it } from "vitest";
import { beginSelfRepairDiagnostics, finishSelfRepairDiagnostics, getSelfRepairDiagnostics,
  recordRepairComparison, recordRepairSnapshot, recordSyncActivity } from "./selfRepairDiagnostics";

const before = { value: { id: "n", title: "private title", updatedAt: "2026-01-01", body: null },
  revision: 4, lastOpId: "old:4", lastDeviceId: "old", lastLocalSeq: 4, operationType: "update" };

describe("self repair evidence", () => {
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
});
