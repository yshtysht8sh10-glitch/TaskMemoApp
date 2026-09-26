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

  it("separates static remote revisions from per-operation conflicts and reports anonymous counts", () => {
    const remote = record("node", 2);
    const journal = record("node", 5);
    const ops = [operation("device:1", "node", "update", 1),
      operation("device:2", "node", "update", 5),
      operation("device:3", "node", "create", 2)];
    const report = compareRecoveryState(envelope([remote]), envelope([journal], ops),
      { nodes: [remote], receiptDocumentCount: 0 }, true);
    expect(report.remoteRevisionConflictCount).toBe(0);
    expect(report.dryRunConflictCount).toBe(3);
    expect(report.dryRunConflictByType).toMatchObject({ update: 2, create: 1 });
    expect(report.dryRunConflictByReason).toEqual({ staleBaseRevision: 1, futureBaseRevision: 1,
      createTargetExists: 1, candidateSuperseded: 0 });
    expect(report.dryRunConflictNodeCount).toBe(1);
    expect(report.dryRunConflictCountsPerNodeDescending).toEqual([3]);
    expect(JSON.stringify(report)).not.toMatch(/device:|"node"|private-title/);
  });

  it("distinguishes Node existence, revision, sortKey, metadata, visible content and unknown fields", () => {
    const make = (id: string) => ({ ...record(id), value: { ...record(id).value, sortKey: "a", updatedAt: "old", title: "same" } });
    const expected = [make("exact"), make("revision"), make("sort"), make("metadata"), make("content"), make("other"), make("journal-only")];
    const simulated = [make("exact"), { ...make("revision"), revision: 1 },
      { ...make("sort"), value: { ...make("sort").value, sortKey: "b" } },
      { ...make("metadata"), value: { ...make("metadata").value, updatedAt: "new" } },
      { ...make("content"), value: { ...make("content").value, title: "changed" } },
      { ...make("other"), value: { ...make("other").value, unknownField: "changed" } }, make("remote-only")];
    const report = compareRecoveryState(envelope([]), envelope(expected),
      { nodes: simulated, receiptDocumentCount: 0 }, true);
    expect(report.dryRunJournalNodeDifference).toEqual({ exactRecord: 1, dryRunOnly: 1, journalOnly: 1,
      revisionOnly: 1, sortKeyOnly: 1, metadataOnly: 1, userContent: 1, other: 1,
      noUserContentDifference: 4 });
    expect(report.dryRunOtherFieldCounts["value.unknownField"]).toBe(1);
    expect(report.dryRunMetadataOnlyFieldCounts["value.updatedAt"]).toBe(1);
    expect(report.semanticNodeStateMatchesJournal).toBe(false);
    expect(report.semanticNodeStateReasons).toEqual({ nodeExistenceDifferenceCount: 2,
      meaningfulFieldDifferenceNodeCount: 3, unknownFieldDifferenceNodeCount: 1,
      internalOnlyDifferenceNodeCount: 1 });
    expect(JSON.stringify(report)).not.toMatch(/"unknownField"|"remote-only"|"journal-only"/);
  });

  it("identifies sync-control-only divergence as semantically equal but still blocks recovery", () => {
    const local = record("private-node");
    const actual = { ...local, revision: 4, lastOpId: "private-operation" };
    const report = compareRecoveryState(envelope([local]), envelope([local]),
      { nodes: [actual], receiptDocumentCount: 0 }, true);
    expect(report.dryRunJournalNodeDifference.other).toBe(1);
    expect(report.dryRunOtherFieldCounts.revision).toBe(1);
    expect(report.dryRunOtherFieldCounts.lastOpId).toBe(1);
    expect(report.semanticNodeStateMatchesJournal).toBe(true);
    expect(report.semanticNodeStateReasons).toMatchObject({ meaningfulFieldDifferenceNodeCount: 0,
      unknownFieldDifferenceNodeCount: 0, internalOnlyDifferenceNodeCount: 1 });
    expect(report.decision).toBe("blocked");
    expect(JSON.stringify(report)).not.toMatch(/private-node|private-operation/);
  });

  it("does not call createdAt or updatedAt semantically equal because app behavior uses them", () => {
    const local = { ...record("private-node"), value: { id: "private-node", createdAt: "old", updatedAt: "old" } };
    const actual = { ...local, value: { ...local.value, createdAt: "new", updatedAt: "new" } };
    const report = compareRecoveryState(envelope([local]), envelope([local]),
      { nodes: [actual], receiptDocumentCount: 0 }, true);
    expect(report.dryRunJournalNodeDifference.metadataOnly).toBe(1);
    expect(report.dryRunMetadataOnlyFieldCounts["value.createdAt"]).toBe(1);
    expect(report.dryRunMetadataOnlyFieldCounts["value.updatedAt"]).toBe(1);
    expect(report.semanticNodeStateMatchesJournal).toBe(false);
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
