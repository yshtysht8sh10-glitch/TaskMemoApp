/// <reference types="node" />
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { prepareSchema1V1Export, compareV1NodeSources } from "../src/sync/v1ExportMigration";

const [exportPath, snapshotPath, migrationId, reportPath] = process.argv.slice(2);
if (!exportPath || !snapshotPath || !migrationId || !reportPath) throw new Error("Usage: tsx scripts/intake-v1-export.ts <iphone-schema1-export.json> <production-read-only-snapshot.json> <migration-id> <new-private-report.json>");
const exportRaw = readFileSync(exportPath, "utf8");
const snapshotRaw = readFileSync(snapshotPath, "utf8");
const snapshot = JSON.parse(snapshotRaw) as { projectId?: string; nodes?: { uid: string; node: Record<string, unknown> }[] };
if (snapshot.projectId !== "taskmemoapp-eabc3" || !Array.isArray(snapshot.nodes)) throw new Error("Expected a production read-only snapshot.");
const uids = [...new Set(snapshot.nodes.map((item) => item.uid))];
if (uids.length !== 1) throw new Error(`Expected exactly one production UID, found ${uids.length}. Add an explicit reviewed UID selection before continuing.`);
const prepared = prepareSchema1V1Export(exportRaw, migrationId);
const comparison = compareV1NodeSources(prepared.nodes, snapshot.nodes.map((item) => item.node));
const counts = Object.fromEntries(["IDENTICAL", "EXPORT_ONLY", "FIRESTORE_ONLY", "FIELD_DIFFERENCE"].map((classification) => [classification, comparison.filter((item) => item.classification === classification).length]));
const report = {
  schemaVersion: 1,
  classification: Object.values(counts).slice(1).some((count) => count > 0) ? "USER_DECISION_REQUIRED" : "IDENTICAL",
  migrationId,
  productionUid: uids[0],
  export: { sha256: createHash("sha256").update(exportRaw).digest("hex"), exportedAt: prepared.exportedAt, nodeCount: prepared.nodes.length },
  firestore: { sha256: createHash("sha256").update(snapshotRaw).digest("hex"), nodeCount: snapshot.nodes.length },
  counts,
  comparison,
  migration: { ...prepared.migration, records: prepared.migration.records },
  profilePolicy: prepared.profilePolicy,
};
writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ reportPath, classification: report.classification, counts, sourceCount: prepared.migration.sourceCount, outputCount: prepared.migration.outputCount, semanticChanges: prepared.migration.changedFields.length, lostFields: prepared.migration.lostFieldCount }, null, 2));
if (report.classification !== "IDENTICAL") process.exitCode = 2;
