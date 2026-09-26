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
  it("traces candidate-only sortKey collisions to partial Node-level winners without changing recovery", () => {
    const make = (id: string, sortKey: string, revision: number): VersionedNode => ({
      ...record(id, revision), value: { id, type: "category", parentId: null, sortKey, title: id,
        createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z", deletedAt: null },
    });
    const remoteA = make("a", "a0", 0), remoteB = make("b", "a1", 3);
    const moveA = { ...operation("device:1", "a", "update", 0), payload: { node: make("a", "a1", 1).value } };
    const moveB = { ...operation("device:2", "b", "update", 0), payload: { node: make("b", "a2", 1).value } };
    const report = compareRecoveryState(envelope([remoteA, remoteB]),
      envelope([make("a", "a1", 1), make("b", "a2", 1)], [moveA, moveB]),
      { nodes: [remoteA, remoteB], receiptDocumentCount: 0 }, true);
    expect(report.structureChecks.remote.valid).toBe(true);
    expect(report.structureChecks.journal.valid).toBe(true);
    expect(report.finalPreflight.sortKeyRepairPreview.structureBefore.duplicateActiveSortKeyGroupCount).toBe(1);
    expect(report.finalPreflight.candidateStructure.duplicateActiveSortKeyGroupCount).toBe(0);
    expect(report.finalPreflight.sortKeyRepairPreview).toMatchObject({ changedNodeCount: 1,
      structureAfter: { valid: true, duplicateActiveSortKeyNodeCount: 0,
        duplicateActiveSortKeyGroupCount: 0 },
      nonSortKeyValueDifferenceNodeCount: 0, requiresAdditionalOperations: true,
      planValid: false }); // Minimal fixture has no persistent device sequence.
    expect(report.finalPreflight.authorizesRecovery).toBe(false);
    expect(report.candidateSortKeyCollisionTrace).toMatchObject([{
      sortKey: "a1", nodes: [
        { nodeId: "a", candidate: { sortKey: "a1" }, operations: [{ result: "applied" }] },
        { nodeId: "b", candidate: { sortKey: "a1" }, operations: [{ result: "superseded", reason: "higherRevisionWins" }] },
      ],
    }]);
  });
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
    expect(report.dryRunConflictReasonByType.update).toMatchObject({ staleBaseRevision: 1,
      futureBaseRevision: 1, createTargetExists: 0 });
    expect(report.dryRunConflictReasonByType.create.createTargetExists).toBe(1);
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

  it("compares four states pairwise and separates semantic, metadata, and exact matches", () => {
    const base = record("private-node");
    const metadataChanged = { ...base, revision: 1 };
    const report = compareRecoveryState(envelope([base]), envelope([metadataChanged]),
      { nodes: [base], receiptDocumentCount: 0 }, true);
    expect(report.nodeComparisons.applicationRemote).toMatchObject({ semanticMatches: true,
      syncMetadataMatches: true, exactMatches: true });
    expect(report.nodeComparisons.applicationJournal).toMatchObject({ semanticMatches: true,
      syncMetadataMatches: false, exactMatches: false });
    expect(report.semanticNodeStateMatchesJournal).toBe(true);
    expect(report.syncMetadataMatchesJournal).toBe(false);
    expect(report.exactNodeStateMatchesJournal).toBe(false);
  });

  it("finds parent, cycle, and sortKey defects without reporting identities", () => {
    const make = (id: string, parentId: string | null, sortKey: string, type = "category") => ({
      ...record(id), value: { ...record(id).value, type, parentId, sortKey, deletedAt: null },
    });
    const nodes = [make("a", "b", "a0"), make("b", "a", "a0"),
      make("orphan", "missing-private", "a0"), make("invalid-rank", null, ""), make("root", null, "a0"),
      make("duplicate-rank", null, "a0")];
    const report = compareRecoveryState(envelope(nodes), envelope(nodes),
      { nodes, receiptDocumentCount: 0 }, true);
    expect(report.structureChecks.journal).toMatchObject({ nodeCount: 6, missingParentCount: 1,
      cycleNodeCount: 2, invalidActiveSortKeyCount: 1, duplicateActiveSortKeyGroupCount: 1,
      valid: false });
    expect(report.recoverySafetyDecision).toBe("blocked");
    expect(JSON.stringify(report)).not.toMatch(/missing-private|"orphan"|"invalid-rank"/);
  });

  it("contrasts strict, create-compatible, and server-winner replay without mutating inputs", () => {
    const remote = record("private-node", 0);
    const create = operation("private-device:1", "private-node", "create", 0);
    const journal = applyRevisionOperation(remote, create).record!;
    const raw = JSON.stringify({ remote, create, journal });
    const report = compareRecoveryState(envelope([remote]), envelope([journal], [create]),
      { nodes: [remote], receiptDocumentCount: 0 }, true);
    expect(report.replayStrategies.strict.exactMatchesJournal).toBe(false);
    expect(report.replayStrategies.strict.skippedCreateExisting).toBe(1);
    expect(report.replayStrategies.createCompatible.exactMatchesJournal).toBe(true);
    expect(report.replayStrategies.serverWinner.exactMatchesJournal).toBe(true);
    expect(report.recoverySafetyDecision).toBe("blocked");
    expect(JSON.stringify({ remote, create, journal })).toBe(raw);
  });

  it("classifies 55 creates and 967 updates without exporting target IDs", () => {
    const creates = Array.from({ length: 55 }, (_, index) => operation(`private:${index + 1}`, `new-${index}`, "create", 0));
    const updates = Array.from({ length: 967 }, (_, index) => operation(`private:${index + 56}`, `node-${index % 62}`, "update", 0));
    const completes = [operation("private:1023", "node-0", "complete", 0), operation("private:1024", "node-1", "complete", 0)];
    const report = compareRecoveryState(envelope([]), envelope([], [...creates, ...updates, ...completes]),
      { nodes: [], receiptDocumentCount: 0 }, true);
    expect(report.operationTypeCounts).toMatchObject({ create: 55, update: 967, complete: 2 });
    expect(report.createAnalysis).toMatchObject({ total: 55, uniqueTargets: 55,
      maxSameTimestampCount: 55, targetAlreadyRemote: 0 });
    expect(report.updateAnalysis).toMatchObject({ total: 967, uniqueTargets: 62 });
    expect(report.dryRunResultsByType.update.missing + report.dryRunResultsByType.update.conflict +
      report.dryRunResultsByType.update.success + report.dryRunResultsByType.update.inconsistency +
      report.dryRunResultsByType.update.duplicate).toBe(967);
    expect(Object.values(report.dryRunInconsistencyByReason).reduce((a, b) => a + b, 0))
      .toBe(report.dryRunInconsistencyCount);
    expect(JSON.stringify(report)).not.toMatch(/private:|new-0|node-0/);
  });

  it("flags a changed second server snapshot and leaves every persistence method read-only", async () => {
    const raw = JSON.stringify(envelope([record("private-node")]));
    const persistence: ApplicationJournalPersistence = {
      loadCommitted: vi.fn(async () => raw), loadJournal: vi.fn(async () => raw),
      writeJournal: vi.fn(), writeCommitted: vi.fn(), clearJournal: vi.fn(),
    };
    const adapter = { auditOutbox: vi.fn(async () => ({ received: 0, missing: 0 })), readRecoverySnapshot: vi.fn()
      .mockResolvedValueOnce({ nodes: [record("private-node")], receiptDocumentCount: 0 })
      .mockResolvedValueOnce({ nodes: [record("private-node", 1)], receiptDocumentCount: 0 }),
      upload: vi.fn() } as unknown as SyncAdapter;
    const report = await runRecoveryPreflight(persistence, adapter, "test-scope",
      { received: 0, missing: 0 }, persistence);
    expect(adapter.readRecoverySnapshot).toHaveBeenCalledTimes(2);
    expect(adapter.auditOutbox).toHaveBeenCalledTimes(1);
    expect(report.remoteSnapshotStable).toBe(false);
    expect(report.finalPreflight.finalRecoverySafetyDecision).toBe("blocked");
    expect(report.finalPreflight.blockReasons.remoteSnapshotUnstable).toBe(1);
    expect(report.recoverySafetyBlockReasons.remoteSnapshotUnstable).toBe(1);
    expect(report.recoverySafetyDecision).toBe("blocked");
    expect(persistence.writeJournal).not.toHaveBeenCalled();
    expect(persistence.writeCommitted).not.toHaveBeenCalled();
    expect(persistence.clearJournal).not.toHaveBeenCalled();
    expect(adapter.upload).not.toHaveBeenCalled();
  });

  it("keeps even an exact stable preflight at manual review, never authorizes recovery", () => {
    const complete = { ...record("private-node"), value: { id: "private-node", type: "category",
      parentId: null, sortKey: "a0", title: "private-title", createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z", deletedAt: null } };
    const report = compareRecoveryState(envelope([complete]), envelope([complete]),
      { nodes: [complete], receiptDocumentCount: 0 }, true);
    expect(report.structureChecks.journal.valid).toBe(true);
    expect(report.semanticNodeStateMatchesJournal).toBe(true);
    expect(report.syncMetadataMatchesJournal).toBe(true);
    expect(report.exactNodeStateMatchesJournal).toBe(true);
    expect(report.remoteSnapshotStable).toBe(true);
    expect(report.recoverySafetyDecision).toBe("manual-review");
    expect(Object.values(report.recoverySafetyBlockReasons).every((count) => count === 0)).toBe(true);
    expect(report.finalPreflight.finalRecoverySafetyDecision).toBe("blocked");
    expect(report.finalPreflight.blockReasons.receiptAuditIncompleteOrReceived).toBe(1);
  });

  it("produces a read-only final candidate with independent journal/application and receipt checks", () => {
    const create = operation("device:1", "private-new", "create", 0);
    const initial = record("private-existing");
    const added = applyRevisionOperation(undefined, create).record!;
    const report = compareRecoveryState(envelope([initial]), envelope([initial, added], [create]),
      { nodes: [initial], receiptDocumentCount: 16964 }, true, 0, 1, true,
      { nodes: [initial], receiptDocumentCount: 16964 }, { received: 0, missing: 1 });
    const final = report.finalPreflight;
    expect(final.remoteToCandidate).toMatchObject({ create: 1, update: 0, delete: 0, unchanged: 1 });
    expect(final.candidateJournal).toMatchObject({ exactMatches: true, profileMatches: true });
    expect(final.candidateApplication).toMatchObject({ leftOnly: 1, semanticMatches: false });
    expect(final.journalOnlyFromApplication).toMatchObject({ count: 1, remoteAbsent: 1,
      candidatePresent: 1, createOperationCount: 1 });
    expect(final.candidateStructure.valid).toBe(false); // minimal test Node lacks structural fields
    expect(final.finalRecoverySafetyDecision).toBe("blocked");
    expect(final.authorizesRecovery).toBe(false);
    expect(JSON.stringify(final)).not.toMatch(/private-existing|private-new|device:1/);
  });

  it("classifies a stale server-winner operation by revision without exporting its ID", () => {
    const current = record("private-node", 5);
    const stale = operation("device:1", "private-node", "update", 0);
    const report = compareRecoveryState(envelope([current]), envelope([current], [stale]),
      { nodes: [current], receiptDocumentCount: 0 }, true, 0, 1, true,
      { nodes: [current], receiptDocumentCount: 0 }, { received: 0, missing: 1 });
    expect(report.finalPreflight.superseded).toMatchObject({ total: 1, classified: 1,
      byReason: { higherRevisionWins: 1 }, byType: { update: { higherRevisionWins: 1 } } });
  });

  it("marks a fully validated stable snapshot safe for review, never authorizes recovery", () => {
    const complete = { ...record("private-node"), value: { id: "private-node", type: "category",
      parentId: null, sortKey: "a0", title: "private-title", createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z", deletedAt: null } };
    const state = envelope([complete]);
    const snapshot = { nodes: [complete], receiptDocumentCount: 0 };
    const report = compareRecoveryState(state, state, snapshot, true, 0, 0, true, snapshot,
      { received: 0, missing: 0 });
    expect(report.finalPreflight.finalRecoverySafetyDecision).toBe("safe");
    expect(report.finalPreflight.authorizesRecovery).toBe(true);
    expect(report.finalPreflight.receiptSafety.bothAuditsCompleteAndMissing).toBe(true);
    expect(report.finalPreflight.candidateJournal.exactMatches).toBe(true);
    expect(report.finalPreflight.candidateStructure.valid).toBe(true);
  });

  it("blocks when the second receipt audit finds an acknowledged operation", () => {
    const complete = { ...record("private-node"), value: { id: "private-node", type: "category",
      parentId: null, sortKey: "a0", title: "private-title", createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z", deletedAt: null } };
    const op = operation("device:1", "private-node", "update", 0);
    const state = envelope([complete], [op]);
    const snapshot = { nodes: [complete], receiptDocumentCount: 1 };
    const report = compareRecoveryState(state, state, snapshot, true, 0, 1, true, snapshot,
      { received: 1, missing: 0 });
    expect(report.finalPreflight.finalRecoverySafetyDecision).toBe("blocked");
    expect(report.finalPreflight.blockReasons.receiptAuditIncompleteOrReceived).toBe(1);
  });

  it("blocks an unrecognized or invalid operation even if the candidate equals the journal", () => {
    const complete = { ...record("private-node"), value: { id: "private-node", type: "category",
      parentId: null, sortKey: "a0", title: "private-title", createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z", deletedAt: null } };
    const bad = { ...operation("device:1", "private-node", "update", 0), type: "unknown" } as unknown as SyncOperation;
    const state = envelope([complete], [bad]);
    const snapshot = { nodes: [complete], receiptDocumentCount: 0 };
    const report = compareRecoveryState(state, state, snapshot, true, 0, 1, true, snapshot,
      { received: 0, missing: 1 });
    expect(report.finalPreflight.candidateJournal.exactMatches).toBe(true);
    expect(report.finalPreflight.finalRecoverySafetyDecision).toBe("blocked");
    expect(report.finalPreflight.blockReasons.unrecognizedOperationType).toBe(1);
    expect(report.finalPreflight.blockReasons.invalidOperation).toBe(1);
  });

  it("blocks a valid-structure candidate whose journal content differs", () => {
    const base = { ...record("private-node"), value: { id: "private-node", type: "category",
      parentId: null, sortKey: "a0", title: "private-title", createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z", deletedAt: null } };
    const state = envelope([{ ...base, value: { ...base.value, title: "journal-secret" } }]);
    const snapshot = { nodes: [base], receiptDocumentCount: 0 };
    const report = compareRecoveryState(state, state, snapshot, true, 0, 0, true, snapshot,
      { received: 0, missing: 0 });
    expect(report.finalPreflight.candidateStructure.valid).toBe(true);
    expect(report.finalPreflight.finalRecoverySafetyDecision).toBe("blocked");
    expect(report.finalPreflight.blockReasons.candidateSemanticMismatch).toBe(1);
  });

  it("classifies remote create, update, logical delete and unchanged nodes without writing", () => {
    const base = (id: string) => ({ ...record(id), value: { id, type: "category" as const,
      parentId: null, sortKey: `a${id}`, title: "private-title", createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z", deletedAt: null } });
    const remote = [base("1"), base("2"), base("3")];
    const created = base("4");
    const changed = { ...base("1"), revision: 1, lastOpId: "changed", value: { ...base("1").value, title: "changed" } };
    const deleted = { ...base("2"), revision: 1, lastOpId: "deleted", value: { ...base("2").value,
      deletedAt: "2026-09-26T01:00:00.000Z" } };
    const ops = [
      { ...operation("device:1", "1", "update", 0), payload: { node: changed.value } },
      { ...operation("device:2", "2", "softDelete", 0), payload: { node: deleted.value } },
      { ...operation("device:3", "4", "create", 0), payload: { node: created.value } },
    ];
    const journalNodes = [applyRevisionOperation(remote[0], ops[0]).record!,
      applyRevisionOperation(remote[1], ops[1]).record!, remote[2],
      applyRevisionOperation(undefined, ops[2]).record!];
    const report = compareRecoveryState(envelope(remote), envelope(journalNodes, ops),
      { nodes: remote, receiptDocumentCount: 0 }, true, 0, 3, true,
      { nodes: remote, receiptDocumentCount: 0 }, { received: 0, missing: 3 });
    expect(report.finalPreflight.remoteToCandidate).toMatchObject({ create: 1, update: 1,
      delete: 1, unchanged: 1, semanticUpdate: 1, logicalDelete: 1 });
    expect(report.finalPreflight.candidateJournal.exactMatches).toBe(true);
    expect(report.finalPreflight.candidateApplication.differingFieldCounts["value.title"]).toBe(1);
    expect(report.finalPreflight.candidateApplication.differingFieldCounts["value.deletedAt"]).toBe(1);
    expect(report.finalPreflight.replay).toMatchObject({ total: 3, applied: 3, inconsistency: 0 });
    expect(JSON.stringify(report.finalPreflight)).not.toMatch(/"changed"|"deleted"|private-title|device:1/);
  });

  it("shows stale operations as skipped versus server-superseded without applying them", () => {
    const remote = record("private-node", 5);
    const stale = operation("private-device:1", "private-node", "update", 0);
    const report = compareRecoveryState(envelope([remote]), envelope([remote], [stale]),
      { nodes: [remote], receiptDocumentCount: 0 }, true);
    expect(report.replayStrategies.strict.skippedStale).toBe(1);
    expect(report.replayStrategies.skipStale.skippedStale).toBe(1);
    expect(report.replayStrategies.serverWinner.superseded).toBe(1);
    expect(report.replayStrategies.serverWinner.exactMatchesJournal).toBe(true);
    expect(report.recoverySafetyDecision).toBe("blocked");
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
