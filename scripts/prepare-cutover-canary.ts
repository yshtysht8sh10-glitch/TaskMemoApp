import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { prepareSchema1V1Export } from "../src/sync/v1ExportMigration";
import { applyRevisionOperation } from "../src/sync/revisionModel";
import type { SyncOperation } from "../src/sync/types";

const [sourcePath, snapshotPath, outputPath, reportPath, migrationId, confirmation] = process.argv.slice(2);
if (!sourcePath || !snapshotPath || !outputPath || !reportPath || migrationId !== "iphone-authoritative-20260920" || confirmation !== "prepare:no-op-canary:124") throw new Error("Exact canary preparation arguments/confirmation are required.");
const sourceRaw = readFileSync(sourcePath, "utf8");
const sourceSha256 = createHash("sha256").update(sourceRaw).digest("hex");
if (sourceSha256 !== "4da5ae29e427831025da485e40f84fc21180591421c40b26e62d3d7817bcae73") throw new Error("Authoritative source SHA mismatch.");
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as { nodes?: { uid?: string }[] };
const uids = [...new Set((snapshot.nodes ?? []).map(item => item.uid).filter(Boolean))];
if (uids.length !== 1) throw new Error("Exactly one approved production UID is required.");
const prepared = prepareSchema1V1Export(sourceRaw, migrationId).migration;
if (prepared.records.length !== 124 || prepared.issues.length || prepared.changedFields.length || prepared.lostFieldCount) throw new Error("Authoritative migration plan is not exact/lossless.");
const before = prepared.records.filter(record => record.value.type === "memo" && record.value.status === "active" && !record.value.deletedAt && !record.value.purgedAt).sort((a, b) => String(a.value.id).localeCompare(String(b.value.id)))[0];
if (!before) throw new Error("No safe active Memo canary target exists.");
const deviceId = `cutover-canary:${migrationId}`;
const operation: SyncOperation = {
  opId: `${deviceId}:${encodeURIComponent(String(before.value.id))}:1`, deviceId, localSeq: 1,
  targetNodeId: String(before.value.id), targetType: "node", type: "update", baseRevision: 0,
  payload: { node: before.value }, createdAt: "2026-09-20T00:00:00.000Z", status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
};
const acknowledgement = applyRevisionOperation(before, operation);
if (acknowledgement.result !== "applied" || !acknowledgement.record || JSON.stringify(acknowledgement.record.value) !== JSON.stringify(before.value)) throw new Error("Canary must be a semantic no-op revision advance.");
const artifact = {
  schemaVersion: 1, kind: "taskmemo-v2-first-write-canary", projectId: "taskmemoapp-eabc3", uid: uids[0], migrationId,
  sourceSha256, expectedSourceNodeCount: 124, targetNodeId: before.value.id, operationType: "update", semanticIntent: "no-op content update; revision/receipt only",
  expectedRevision: 0, beforeState: before, expectedAfterState: acknowledgement.record, expectedReceipt: acknowledgement,
  opId: operation.opId, nodeId: operation.targetNodeId, record: acknowledgement.record, operation,
};
const serialized = JSON.stringify(artifact, null, 2);
writeFileSync(outputPath, serialized, { flag: "wx" });
const artifactSha256 = createHash("sha256").update(serialized).digest("hex");
writeFileSync(reportPath, JSON.stringify({ decision: "PASS", outputPath, artifactSha256, targetNodeId: before.value.id, semanticChangeCount: 0, expectedRevisionBefore: 0, expectedRevisionAfter: 1, expectedReceipt: acknowledgement }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ decision: "PASS", artifactSha256, targetNodeId: before.value.id }));
