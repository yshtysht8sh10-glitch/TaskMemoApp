import { describe, expect, it } from "vitest";
import { generateNKeysBetween } from "fractional-indexing";
import { planJournalAuthoritativeRecovery } from "./journalAuthoritativeRecovery";
import type { VersionedNode } from "./types";

const record = (id: string, sortKey: string, revision = 1, deletedAt: string | null = null): VersionedNode => ({
  value: { id, type: "memo", parentId: null, title: id, body: `${id}-body`, sortKey,
    createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z", deletedAt },
  revision, lastOpId: `old:${id}`, lastDeviceId: "old", lastLocalSeq: 1, operationType: "create",
});

describe("journal-authoritative recovery projection", () => {
  it("preserves a 151/151 union as 152 Nodes despite 38 differing sync metadata records", () => {
    const keys = generateNKeysBetween(null, null, 152);
    const journal = Array.from({ length: 151 }, (_, index) => record(`j${index}`, keys[index], 1));
    const remote = journal.slice(0, 150).map((item, index) => index < 38
      ? { ...item, revision: 10, lastOpId: `remote:${index}` } : item);
    remote.push(record("remote-only", keys[0], 3));
    const plan = planJournalAuthoritativeRecovery(remote, journal, {
      deviceId: "device", nextLocalSeq: 2000, existingOperationIds: new Set(),
      createdAt: "2026-09-26T00:00:00.000Z",
    });
    expect(plan.summary).toMatchObject({ journalNodeCount: 151, remoteNodeCount: 151,
      candidateNodeCount: 152, commonNodeCount: 150, journalOnlyNodeCount: 1,
      remoteOnlyNodeCount: 1, markedNodeCount: 1, journalMetadataDifferenceNodeCount: 38,
      missingJournalNodeCount: 0, nonSortKeyJournalDifferenceNodeCount: 0,
      duplicateActiveSortKeyGroupCount: 0 });
    expect(plan.final.get("remote-only")?.value.title).toBe("⭐⭐⭐remote-only");
  });

  it("keeps journal values, marks remote-only data, repairs sibling ranks, and uses fresh revisions", () => {
    const remote = [record("a", "a0", 9), record("extra", "a1", 3)];
    const journal = [record("a", "a1", 4), record("local", "a1", 1)];
    const plan = planJournalAuthoritativeRecovery(remote, journal, {
      deviceId: "device", nextLocalSeq: 2000, existingOperationIds: new Set(["device:1999"]),
      createdAt: "2026-09-26T00:00:00.000Z",
    });
    expect(plan.summary).toMatchObject({ journalNodeCount: 2, remoteNodeCount: 2,
      candidateNodeCount: 3, remoteOnlyNodeCount: 1, markedNodeCount: 1,
      duplicateActiveSortKeyGroupCount: 0, missingJournalNodeCount: 0,
      nonSortKeyJournalDifferenceNodeCount: 0 });
    expect(plan.final.get("extra")?.value.title).toBe("⭐⭐⭐extra");
    expect(plan.final.get("a")?.value.body).toBe("a-body");
    expect(plan.final.get("a")?.revision).toBe(10);
    expect(new Set([...plan.final.values()].map((node) => node.value.sortKey)).size).toBe(3);
    expect(plan.operations.every((operation) => operation.localSeq >= 2000)).toBe(true);
    expect(remote[1].value.title).toBe("extra");
  });

  it("retains a remote-only tombstone without reviving it", () => {
    const deleted = record("extra", "a0", 3, "2026-09-26T01:00:00.000Z");
    const plan = planJournalAuthoritativeRecovery([deleted], [], {
      deviceId: "device", nextLocalSeq: 1, existingOperationIds: new Set(),
      createdAt: "2026-09-26T00:00:00.000Z",
    });
    expect(plan.final.get("extra")?.value.deletedAt).toBe(deleted.value.deletedAt);
    expect(plan.final.get("extra")?.value.title).toBe("⭐⭐⭐extra");
  });

  it("refuses to resurrect a purged remote node or overwrite an unknown value field", () => {
    const purged = { ...record("a", "a0", 10), value: { ...record("a", "a0").value,
      purgedAt: "2026-09-26T01:00:00.000Z" } };
    const options = { deviceId: "device", nextLocalSeq: 1,
      existingOperationIds: new Set<string>(), createdAt: "2026-09-26T00:00:00.000Z" };
    expect(() => planJournalAuthoritativeRecovery([purged], [record("a", "a0")], options))
      .toThrow("purged");
    const unknown = { ...record("a", "a0"), value: { ...record("a", "a0").value, unknownPrivate: "keep" } };
    expect(() => planJournalAuthoritativeRecovery([unknown], [record("a", "a0")], options))
      .toThrow("unknown");
  });
});
