/// <reference types="node" />
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { Node } from "../src/models/node";
import { planV1ToV2Migration } from "../src/sync/migrationDryRun";

const [input, migrationId, output] = process.argv.slice(2);
if (!input || !migrationId || !output) throw new Error("Usage: tsx scripts/analyze-production-snapshot.ts <private-snapshot> <migration-id> <new-sanitized-report>");
const raw = readFileSync(input, "utf8");
const snapshot = JSON.parse(raw) as { projectId: string; documentCount: number; nodes: { uid: string; node: Record<string, unknown> }[] };
if (snapshot.projectId !== "taskmemoapp-eabc3") throw new Error("Expected the production read-only snapshot.");
const dateFields = ["createdAt", "updatedAt", "deletedAt", "purgedAt", "dueAt", "completedAt"];
const nodes = snapshot.nodes.map(item => {
  const node = { ...item.node };
  for (const field of dateFields) if (typeof node[field] === "string") node[field] = new Date(node[field] as string);
  return node as Node;
});
const plan = planV1ToV2Migration(nodes, migrationId);
const report = {
  schemaVersion: 1,
  sourceProject: snapshot.projectId,
  sourceMode: "read-only Firestore REST collection-group snapshot",
  sourceDocumentCount: snapshot.documentCount,
  sourceUserCount: new Set(snapshot.nodes.map(item => item.uid)).size,
  sourceSha256: createHash("sha256").update(raw).digest("hex"),
  migrationId,
  ...Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "records")),
  semanticMeaningChanges: plan.changedFields.length,
};
writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
if (plan.issues.length || plan.lostFieldCount || plan.changedFields.length) process.exitCode = 1;
