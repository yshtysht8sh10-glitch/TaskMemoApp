import { createHash } from "node:crypto";
import { compareV1NodeSources, prepareSchema1V1Export } from "./v1ExportMigration";

export const APPROVED_AUTHORITATIVE_SOURCE = {
  classification: "USER-APPROVED AUTHORITATIVE SOURCE DECISION" as const,
  sourceSha256: "4da5ae29e427831025da485e40f84fc21180591421c40b26e62d3d7817bcae73",
  expectedNodeCount: 124,
  comparison: { IDENTICAL: 10, EXPORT_ONLY: 4, FIRESTORE_ONLY: 0, FIELD_DIFFERENCE: 110 },
  policy: "Use every field/value from the repaired iPhone V1 Export; do not merge Firestore values.",
};

export function createAuthoritativeV1RehearsalBundle(exportRaw: string, snapshotRaw: string, migrationId: string, approval = APPROVED_AUTHORITATIVE_SOURCE) {
  const sourceSha256 = createHash("sha256").update(exportRaw).digest("hex");
  if (sourceSha256 !== approval.sourceSha256) throw new Error("Repaired Export SHA-256 does not match the authoritative decision.");
  const snapshot = JSON.parse(snapshotRaw) as { projectId?: string; nodes?: { uid: string; node: Record<string, unknown> }[] };
  if (snapshot.projectId !== "taskmemoapp-eabc3" || !Array.isArray(snapshot.nodes)) throw new Error("Expected the approved production read-only snapshot.");
  const uids = [...new Set(snapshot.nodes.map((item) => item.uid))];
  if (uids.length !== 1) throw new Error("Expected exactly one production UID.");
  const prepared = prepareSchema1V1Export(exportRaw, migrationId);
  if (prepared.nodes.length !== approval.expectedNodeCount) throw new Error("Authoritative Node count mismatch.");
  const comparison = compareV1NodeSources(prepared.nodes, snapshot.nodes.map((item) => item.node));
  const counts = Object.fromEntries(["IDENTICAL", "EXPORT_ONLY", "FIRESTORE_ONLY", "FIELD_DIFFERENCE"].map((kind) => [kind, comparison.filter((item) => item.classification === kind).length]));
  if (JSON.stringify(counts) !== JSON.stringify(approval.comparison)) throw new Error("Comparison no longer matches the approved decision.");
  const bundle = {
    schemaVersion: 2,
    projectId: "taskmemoapp-eabc3",
    capturedAt: new Date().toISOString(),
    sourceKind: "approved-repaired-iphone-v1-export",
    documentCount: prepared.nodes.length,
    nodes: prepared.canonicalNodes.map((node) => ({ uid: uids[0], node })),
    localProfileInventory: { complete: false, policy: "USER-APPROVED DATA LOSS" },
  };
  return {
    bundle,
    audit: {
      ...approval,
      migrationId,
      productionUid: uids[0],
      firestoreSnapshotSha256: createHash("sha256").update(snapshotRaw).digest("hex"),
      authoritativeNodeCount: prepared.nodes.length,
      semanticChanges: prepared.migration.changedFields.length,
      lostFields: prepared.migration.lostFieldCount,
      generatedAt: bundle.capturedAt,
    },
  };
}
