import { describe, expect, it, vi } from "vitest";
import { compareRecoveryState, runRecoveryPreflight } from "./recoveryPreflight";
import type { ApplicationJournalPersistence } from "./applicationStore";
import type { SyncAdapter, SyncOperation, VersionedNode } from "./types";
import { applyRevisionOperation } from "./revisionModel";

const record = (id: string, revision = 0, title = "private-title"): VersionedNode => ({
  value: { id, title }, revision, lastOpId: "initial", lastDeviceId: "initial", lastLocalSeq: 0,
  operationType: "import",
});
const operation = (opId: string, targetNodeId: string, type: SyncOperation["type"], baseRevision: number): SyncOperation => ({
  opId, deviceId: "private-device", localSeq: Number(opId.split(":").at(-1)), targetNodeId,
  type, baseRevision, payload: { node: { id: targetNodeId, title: "private-title" } },
  createdAt: "2026-09-26T00:00:00.000Z", status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
});
const envelope = (nodes: VersionedNode[], outbox: SyncOperation[] = []) => ({
  version: 2, domain: Object.fromEntries(nodes.map((node) => [node.value.id, node])), sync: { outbox },
  profile: { pinnedNote: { synced: null, localBody: "", dirtySince: null, migrationPending: false },
    features: { synced: null, localIdeasEnabled: false, migrationPending: false } },
});

describe("read-only recovery preflight", () => {
  it("compares remote and journal and simulates ordered operations without exporting private data", () => {
    const create = operation("private-device:1", "new", "create", 0);
    const journal = envelope([record("existing"), applyRevisionOperation(undefined, create).record!], [create]);
    const report = compareRecoveryState(envelope([record("existing")]), journal,
      { nodes: [record("existing")], receiptDocumentCount: 0 }, true);
    expect(report).toMatchObject({ remoteNodeCount: 1, journalNodeCount: 2,
      journalOnlyNodeCount: 1, nodeMatchCount: 1, dryRunSuccessCount: 1, dryRunNodeCount: 2,
      dryRunMatchesJournal: true, decision: "review-required" });
    expect(JSON.stringify(report)).not.toMatch(/private|existing|new/);
    expect(journal.sync.outbox).toEqual([create]);
  });

  it("classifies every outbox entry exactly once and blocks missing, conflict and inconsistency", () => {
    const ops = [operation("device:1", "missing", "update", 0),
      operation("device:2", "existing", "update", 5),
      operation("device:2", "existing", "update", 0),
      operation("device:3", "created", "create", 0)];
    const report = compareRecoveryState(envelope([record("existing")]), envelope([record("existing")], ops),
      { nodes: [record("existing")], receiptDocumentCount: 0 }, true);
    expect(report).toMatchObject({ dryRunMissingCount: 1, dryRunConflictCount: 1,
      dryRunInconsistencyCount: 1, dryRunSuccessCount: 1, decision: "blocked" });
    expect(report.dryRunMissingCount + report.dryRunConflictCount + report.dryRunInconsistencyCount +
      report.dryRunSuccessCount + report.dryRunDuplicateCount).toBe(ops.length);
  });

  it("simulates 1024 sequential updates and blocks a divergent remote revision", () => {
    const initial = record("node", 0);
    const operations = Array.from({ length: 1024 }, (_, index) => operation(`device:${index + 1}`, "node", "update", index));
    const last = applyRevisionOperation({ ...initial, revision: 1023 }, operations[1023]).record!;
    const report = compareRecoveryState(envelope([initial]), envelope([last], operations),
      { nodes: [initial], receiptDocumentCount: 0 }, true);
    expect(report).toMatchObject({ journalOutboxCount: 1024, dryRunSuccessCount: 1024,
      dryRunNodeCount: 1, dryRunMatchesJournal: true, decision: "review-required" });
    const conflicted = compareRecoveryState(envelope([initial]), envelope([last], operations),
      { nodes: [record("node", 7, "remote-private")], receiptDocumentCount: 0 }, true);
    expect(conflicted.dryRunConflictCount).toBeGreaterThan(0);
    expect(conflicted.decision).toBe("blocked");
  });

  it("never writes committed, journal, outbox or Firebase when a local copy disagrees", async () => {
    const raw = JSON.stringify(envelope([record("existing")]));
    const persistence: ApplicationJournalPersistence = {
      loadCommitted: vi.fn(async () => raw), loadJournal: vi.fn(async () => raw),
      writeJournal: vi.fn(), writeCommitted: vi.fn(), clearJournal: vi.fn(),
    };
    const adapter = { readRecoverySnapshot: vi.fn(), upload: vi.fn() } as unknown as SyncAdapter;
    const legacy = { ...persistence, loadCommitted: vi.fn(async () => null) };
    await expect(runRecoveryPreflight(persistence, adapter, "test-scope", { received: 0, missing: 0 }, legacy)).rejects.toMatchObject({ code: "preflight-local-copy-mismatch" });
    expect(adapter.readRecoverySnapshot).not.toHaveBeenCalled();
    expect(adapter.upload).not.toHaveBeenCalled();
    expect(persistence.writeJournal).not.toHaveBeenCalled();
    expect(persistence.writeCommitted).not.toHaveBeenCalled();
    expect(persistence.clearJournal).not.toHaveBeenCalled();
  });
});
