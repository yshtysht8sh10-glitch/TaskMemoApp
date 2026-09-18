import { describe, expect, it } from "vitest";
import type { MemoNode, Node } from "../models/node";
import { nodeFromV2Value } from "./nodeV2Codec";
import { planV1ToV2Migration } from "./migrationDryRun";

const at = new Date("2026-09-18T00:00:00.000Z");
const memo = (id: string, parentId: string | null = null): MemoNode => ({ id, type: "memo", memoType: "task", parentId, sortKey: "a", deadlineSortKey: "d", title: id, body: "body", dueAt: at, duePreset: "morning", status: "active", completedAt: null, repeatRule: { frequency: "day", interval: 1, startsOn: "2026-09-18" }, routineHistory: { "2026-09-18": at.toISOString() }, createdAt: at, updatedAt: at, deletedAt: null, purgedAt: null });

describe("V1 to V2 migration dry-run", () => {
  it("retains unknown fields, IDs, history tombstones and stable identities across export ordering", () => {
    const source = [{ ...memo("a"), extra: { nested: [1, "future", null] }, routineHistory: { day1: at.toISOString(), day2: null } }, { ...memo("b"), status: "completed" as const, completedAt: at }];
    const plan = planV1ToV2Migration(source, "fixture");
    expect(plan).toMatchObject({ lostFieldCount: 0, memoCount: 2, ideaCount: 0, categoryCount: 0, routineCount: 2, completedCount: 1, routineHistoryCount: 3, orphanCount: 0, unexpectedDataCount: 0, issues: [], unknownFields: [{ nodeId: "a", fields: ["extra"] }] });
    expect(plan.records.map(record => nodeFromV2Value(record.value))).toEqual(source);
    expect(planV1ToV2Migration([...source].reverse(), "fixture").records.reverse()).toEqual(plan.records);
  });
  it("preserves production-equivalent Node data without writing and assigns deterministic revision zero records", () => {
    const category: Node = { id: "c", type: "category", parentId: null, sortKey: "a", title: "C", createdAt: at, updatedAt: at, deletedAt: null, categoryKind: "routineRoot" };
    const purged = { ...memo("purged", "c"), deletedAt: at, purgedAt: at };
    const source = [category, memo("m", "c"), purged];
    const plan = planV1ToV2Migration(source, "dry-run-1");
    expect(plan).toMatchObject({ sourceCount: 3, outputCount: 3, activeCount: 2, deletedCount: 0, purgedCount: 1, issues: [] });
    expect(plan.records.every((record) => record.revision === 0 && record.operationType === "import")).toBe(true);
    expect(plan.records.map((record) => nodeFromV2Value(record.value))).toEqual(source);
  });

  it("reports duplicate IDs and orphan parents without silently repairing source data", () => {
    const plan = planV1ToV2Migration([memo("same"), memo("same"), memo("orphan", "missing")], "dry-run-2");
    expect(plan.issues.map((issue) => issue.kind)).toEqual(["duplicate-id", "orphan-parent"]);
    expect(plan.outputCount).toBe(plan.sourceCount);
  });
});
