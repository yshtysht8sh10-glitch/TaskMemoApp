import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Node } from "../models/node";
import { serializeNodeBackup } from "../services/nodeBackup";
import { createAuthoritativeV1RehearsalBundle } from "./authoritativeV1Source";

const at = new Date("2026-09-20T00:00:00.000Z");
const node: Node = { id: "a", type: "category", parentId: null, sortKey: "a0", title: "A", createdAt: at, updatedAt: at, deletedAt: null };

describe("authoritative V1 source decision", () => {
  it("uses only Export values after matching the exact approved hash and comparison", () => {
    const raw = serializeNodeBackup([node], at);
    const snapshotRaw = JSON.stringify({ projectId: "taskmemoapp-eabc3", nodes: [{ uid: "owner", node: { ...node, title: "Cloud", createdAt: at.toISOString(), updatedAt: at.toISOString() } }] });
    const result = createAuthoritativeV1RehearsalBundle(raw, snapshotRaw, "approved", {
      classification: "USER-APPROVED AUTHORITATIVE SOURCE DECISION", sourceSha256: createHash("sha256").update(raw).digest("hex"), expectedNodeCount: 1,
      comparison: { IDENTICAL: 0, EXPORT_ONLY: 0, FIRESTORE_ONLY: 0, FIELD_DIFFERENCE: 1 }, policy: "Export wins",
    });
    expect(result.bundle.nodes[0].node.title).toBe("A");
    expect(result.audit).toMatchObject({ classification: "USER-APPROVED AUTHORITATIVE SOURCE DECISION", semanticChanges: 0, lostFields: 0 });
  });

  it("fails closed when the comparison changed", () => {
    const raw = serializeNodeBackup([node], at);
    const snapshotRaw = JSON.stringify({ projectId: "taskmemoapp-eabc3", nodes: [{ uid: "owner", node: { ...node, createdAt: at.toISOString(), updatedAt: at.toISOString() } }] });
    expect(() => createAuthoritativeV1RehearsalBundle(raw, snapshotRaw, "approved", {
      classification: "USER-APPROVED AUTHORITATIVE SOURCE DECISION", sourceSha256: createHash("sha256").update(raw).digest("hex"), expectedNodeCount: 1,
      comparison: { IDENTICAL: 0, EXPORT_ONLY: 0, FIRESTORE_ONLY: 0, FIELD_DIFFERENCE: 1 }, policy: "Export wins",
    })).toThrow(/Comparison/);
  });
});
