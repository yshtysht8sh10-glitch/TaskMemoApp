import { describe, expect, it } from "vitest";
import { buildCanaryWrites, buildControlGateWrites, compareSnapshotPair, collectDiagnosticEvidence, confirmationFor, makeMigrationPlan, requireIdentity, sealBackupManifest, sha256, validateV2 } from "./productionAdmin.mjs";

const identity = { projectId: "taskmemoapp-eabc3", expectedProjectId: "taskmemoapp-eabc3", uid: "owner", migrationId: "m1" };
const snapshot = nodes => JSON.stringify({ projectId: identity.projectId, nodes: nodes.map(node => ({ uid: identity.uid, node })) });

describe("production admin fail-closed core", () => {
  it("compares stable snapshots and stops on any canonical difference", () => {
    expect(compareSnapshotPair(snapshot([{ id: "a", title: "A" }]), snapshot([{ title: "A", id: "a" }]), identity, 1).decision).toBe("PASS");
    expect(compareSnapshotPair(snapshot([{ id: "a", title: "A" }]), snapshot([{ id: "a", title: "B" }]), identity, 1).decision).toBe("STOP");
  });
  it("rejects project and UID ambiguity", () => {
    expect(() => requireIdentity({ ...identity, projectId: "wrong" })).toThrow(/project/);
    expect(() => requireIdentity({ ...identity, uid: "" })).toThrow(/UID/);
  });
  it("makes confirmation identity-specific", () => {
    expect(confirmationFor("WRITE", identity)).toBe("WRITE:taskmemoapp-eabc3:owner:m1");
  });
  it("builds deterministic gate writes and rejects an unknown transition", () => {
    expect(buildControlGateWrites(identity, "v2-frozen")).toHaveLength(2);
    expect(buildControlGateWrites(identity, "v2-frozen")).toEqual(buildControlGateWrites(identity, "v2-frozen"));
    expect(() => buildControlGateWrites(identity, "dual")).toThrow(/Unknown/);
  });
  it("builds the same create-only migration on retry", () => {
    const sourceRaw = "fixture";
    const prepared = { sourceCount: 2, outputCount: 2, issues: [], changedFields: [], lostFieldCount: 0, records: Array.from({ length: 2 }, (_, i) => ({ value: { id: `n${i}` }, revision: 0, lastOpId: `migration:m1:n${i}`, lastDeviceId: "migration:m1", lastLocalSeq: 0, operationType: "import" })) };
    const options = { sourceRaw, prepared, identity, expectedSourceSha256: sha256(sourceRaw), expectedNodeCount: 2 };
    expect(makeMigrationPlan(options)).toEqual(makeMigrationPlan(options));
    expect(makeMigrationPlan(options).writes.every(write => write.currentDocument.exists === false)).toBe(true);
  });
  it("seals only a matching stable comparison into a deterministic evidence shape", () => {
    const sourceRaw = "source"; const snapshotRaw = snapshot([{ id: "a" }]);
    const comparison = { decision: "PASS", ...compareSnapshotPair(snapshotRaw, snapshotRaw, identity, 1) };
    const result = sealBackupManifest({ snapshotRaw, sourceRaw, snapshotPath: "snapshot", sourcePath: "source", acquisitionTime: "2026-09-20T00:00:00.000Z", commit: "abc", identity, expectedSnapshotCount: 1, comparisonRaw: JSON.stringify(comparison), expectedSourceSha256: sha256(sourceRaw) });
    expect(result.snapshot.documentCount).toBe(1);
    expect(() => sealBackupManifest({ snapshotRaw, sourceRaw: "wrong", snapshotPath: "snapshot", sourcePath: "source", acquisitionTime: "x", commit: "abc", identity, expectedSnapshotCount: 1, comparisonRaw: JSON.stringify(comparison), expectedSourceSha256: sha256(sourceRaw) })).toThrow(/SHA/);
  });
  it("builds an atomic PONR winner plus create-only receipt", () => {
    const writes = buildCanaryWrites(identity, { uid: identity.uid, migrationId: identity.migrationId, nodeId: "n", opId: "device:1", expectedRevision: 0, record: { value: { id: "n" }, revision: 1 }, operation: { opId: "device:1" } });
    expect(writes).toHaveLength(2); expect(writes[0].currentDocument).toBeUndefined(); expect(writes[1].currentDocument.exists).toBe(false);
  });
  it("collects duplicate/missing/regression/partial transaction STOP evidence", () => {
    const result = collectDiagnosticEvidence({ events: [{ kind: "v1-write-attempt", count: 0 }, { kind: "schema-owner-failure", count: 0 }, { kind: "permanent-sync-error", count: 0 }], clients: [{ id: "a", syncPhase: "synced", outboxOldestAgeMs: 0, networkConfirmedOnline: true, convergenceHash: "h" }], nodes: [{ revision: -1 }, { revision: 1, lastOpId: "missing" }], receipts: [{ opId: "dup" }, { opId: "dup" }], functionRequests: [{}] });
    expect(Object.fromEntries(result.events.map(item => [item.kind, item.count]))).toMatchObject({ "receipt-missing": 1, "duplicate-receipt": 1, "revision-regression": 1, "functions-partial-transaction": 1 });
  });
  it("validates exact V2 records and profile", () => {
    const prepared = { sourceCount: 2, outputCount: 2, issues: [], changedFields: [], lostFieldCount: 0, records: Array.from({ length: 2 }, (_, i) => ({ value: { id: `n${i}` }, revision: 0, lastOpId: `migration:m1:n${i}`, lastDeviceId: "migration:m1", lastLocalSeq: 0, operationType: "import" })) };
    const options = { sourceRaw: "fixture", prepared, remoteRecords: prepared.records.map(record => ({ record })), profile: { pinnedNote: { body: "" }, features: { ideasEnabled: false }, legacyPinnedNoteCandidates: [] }, identity, expectedSourceSha256: sha256("fixture"), expectedNodeCount: 2 };
    expect(validateV2(options).decision).toBe("PASS");
    expect(validateV2({ ...options, remoteRecords: options.remoteRecords.slice(1) }).decision).toBe("STOP");
  });
});
