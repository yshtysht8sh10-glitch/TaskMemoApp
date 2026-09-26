import { describe, expect, it } from "vitest";
import { planRecoverySortKeyOperations, planRecoverySortKeyRepair } from "./recoverySortKeyRepair";
import type { VersionedNode } from "./types";

const record = (id: string, sortKey: string, deletedAt: string | null = null): VersionedNode => ({
  value: { id, type: "category", parentId: null, sortKey, title: `private-${id}`,
    createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z", deletedAt,
    privateExtension: { retained: true } },
  revision: 7, lastOpId: `private-op-${id}`, lastDeviceId: "private-device", lastLocalSeq: 4,
  operationType: "update",
});

describe("read-only Recovery sortKey repair plan", () => {
  it("makes nine active sibling collision pairs unique without altering other fields or metadata", () => {
    const original = new Map<string, VersionedNode>();
    for (let index = 0; index < 9; index++) {
      original.set(`a${index}`, record(`a${index}`, `a${index}`));
      original.set(`b${index}`, record(`b${index}`, `a${index}`));
    }
    const deleted = record("deleted", "a0", "2026-09-26T01:00:00.000Z");
    original.set("deleted", deleted);
    const before = JSON.stringify([...original]);
    const { repaired, changedNodeCount } = planRecoverySortKeyRepair(original);
    const active = [...repaired.values()].filter((item) => item.value.deletedAt === null);
    expect(changedNodeCount).toBe(9);
    expect(new Set(active.map((item) => item.value.sortKey)).size).toBe(18);
    expect(repaired.get("deleted")).toBe(deleted);
    for (const [id, record] of original) {
      expect({ ...repaired.get(id), value: { ...repaired.get(id)?.value, sortKey: record.value.sortKey } })
        .toEqual(record);
    }
    expect(JSON.stringify([...original])).toBe(before);
    expect(planRecoverySortKeyRepair(repaired).changedNodeCount).toBe(0);
  });

  it("uses fresh deterministic identities and refuses an existing receipt identity", () => {
    const candidate = new Map([["a", record("a", "a0")], ["b", record("b", "a0")]]);
    const first = planRecoverySortKeyOperations(candidate, "device", 42,
      "2026-09-26T00:00:00.000Z", new Set(["device:41"]));
    expect(first.operations).toMatchObject([{ opId: "device:42", localSeq: 42,
      type: "update", baseRevision: 7 }]);
    expect(first.final.get("b")?.revision).toBe(8);
    expect(new Set([...first.final.values()].map((item) => item.value.sortKey)).size).toBe(2);
    expect(planRecoverySortKeyOperations(candidate, "device", 42,
      "2026-09-26T00:00:00.000Z", new Set()).operations).toEqual(first.operations);
    expect(() => planRecoverySortKeyOperations(candidate, "device", 42,
      "2026-09-26T00:00:00.000Z", new Set(["device:42"]))).toThrow("overlaps Outbox");
  });
});
