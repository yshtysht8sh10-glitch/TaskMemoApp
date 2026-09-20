import { describe, expect, it } from "vitest";
import type { Node } from "../models/node";
import { serializeNodeBackup } from "../services/nodeBackup";
import { nodeFromV2Value } from "./nodeV2Codec";
import { compareV1NodeSources, describeV1ExportValidationFailure, prepareSchema1V1Export, PRODUCTION_V1_PROFILE_POLICY } from "./v1ExportMigration";

const at = new Date("2026-09-20T00:00:00.000Z");
const nodes: Node[] = [
  { id: "category", type: "category", parentId: null, sortKey: "a0", title: "Category", createdAt: at, updatedAt: at, deletedAt: null },
  { id: "task", type: "memo", memoType: "task", parentId: "category", sortKey: "a0", title: "Task", body: "body", dueAt: at, duePreset: "custom", status: "completed", completedAt: at, repeatRule: { frequency: "week", interval: 1, startsOn: "2026-09-20", weekdays: [0] }, routineHistory: { "2026-09-20": at.toISOString() }, createdAt: at, updatedAt: at, deletedAt: null },
  { id: "idea", type: "memo", memoType: "idea", parentId: null, sortKey: "a1", title: "Idea", body: "idea", dueAt: null, duePreset: "none", status: "active", completedAt: null, createdAt: at, updatedAt: at, deletedAt: at },
  { id: "purged", type: "memo", memoType: "task", parentId: null, sortKey: "a2", title: "Purged", body: "", dueAt: null, duePreset: "none", status: "active", completedAt: null, createdAt: at, updatedAt: at, deletedAt: at, purgedAt: at },
];

describe("production schema 1 V1 Export migration", () => {
  it("validates and migrates all Nodes without semantic or field loss using deterministic identities", () => {
    const prepared = prepareSchema1V1Export(serializeNodeBackup(nodes, at), "iphone-export-1");
    expect(prepared.migration).toMatchObject({ sourceCount: 4, outputCount: 4, ideaCount: 1, routineCount: 1, completedCount: 1, deletedCount: 1, purgedCount: 1, changedFields: [], lostFieldCount: 0, issues: [] });
    expect(prepared.migration.records.map((item) => nodeFromV2Value(item.value))).toEqual(nodes);
    expect(prepared.migration.records.every((item) => item.revision === 0 && item.lastDeviceId === "migration:iphone-export-1" && item.operationType === "import")).toBe(true);
    expect(prepared.profilePolicy).toEqual(PRODUCTION_V1_PROFILE_POLICY);
  });

  it("uses deterministic empty V2 profile defaults independent of legacy device state", () => {
    expect(PRODUCTION_V1_PROFILE_POLICY).toEqual({ classification: "USER-APPROVED DATA LOSS", pinnedNote: { body: "", updatedAt: "1970-01-01T00:00:00.000Z" }, ideasEnabled: false, legacyPinnedNoteCandidates: [] });
  });

  it("rejects wrong schema and semantic sort-key normalization", () => {
    const wrong = JSON.parse(serializeNodeBackup(nodes, at)); wrong.schemaVersion = 2;
    expect(() => prepareSchema1V1Export(JSON.stringify(wrong), "x")).toThrow(/schemaVersion/);
    expect(() => prepareSchema1V1Export(serializeNodeBackup(nodes.map((node) => node.id === "idea" ? { ...node, sortKey: "zzzz" } : node), at), "x")).toThrow(/semantic normalization/);
  });

  it("classifies identical, export-only, Firestore-only and field differences without merging", () => {
    const firestore = [
      { ...nodes[0], createdAt: at.toISOString(), updatedAt: at.toISOString() },
      { ...nodes[1], title: "Cloud", createdAt: at.toISOString(), updatedAt: at.toISOString(), dueAt: at.toISOString(), completedAt: at.toISOString() },
      { ...nodes[2], id: "cloud-only", createdAt: at.toISOString(), updatedAt: at.toISOString(), deletedAt: at.toISOString() },
    ];
    const result = compareV1NodeSources(nodes.slice(0, 3), firestore);
    expect(result.map((item) => [item.nodeId, item.classification])).toEqual([
      ["category", "IDENTICAL"], ["cloud-only", "FIRESTORE_ONLY"], ["idea", "EXPORT_ONLY"], ["task", "FIELD_DIFFERENCE"],
    ]);
    expect(result.find((item) => item.nodeId === "task")?.differingFields).toContain("title");
  });

  it("reports the exact unresolved parent without exposing or repairing Node content", () => {
    const raw = serializeNodeBackup([{ ...nodes[2], id: "orphan", parentId: "missing" }], at);
    expect(describeV1ExportValidationFailure(raw, new Error("orphanの親参照が不正です。"))).toEqual({
      message: "orphanの親参照が不正です。", nodeId: "orphan", field: "parentId", value: "missing", parentExists: false, parentType: null, selfReference: false,
    });
  });
});
