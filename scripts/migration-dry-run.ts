/// <reference types="node" />
/** Offline-only: no Firebase dependency, credentials, or network calls. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { nodeFromV2Value } from "../src/sync/nodeV2Codec";
import { planV1ToV2Migration } from "../src/sync/migrationDryRun";
import type { SyncNodeValue } from "../src/sync/types";

const [input, migrationId, output] = process.argv.slice(2);
if (!input || !migrationId || !output) throw new Error("Usage: tsx scripts/migration-dry-run.ts <input.json> <migration-id> <new-report.json>");
const raw = readFileSync(input, "utf8");
const source: unknown = JSON.parse(raw);
if (!Array.isArray(source)) throw new Error("Input must be an array of canonical V1 JSON Nodes (dates as ISO strings).");
// Decode dates without applying the codec's legacy memoType normalization:
// the report must observe missing/invalid source fields, not silently repair them.
const nodes = source.map(value => {
  if (!value || typeof value !== "object" || typeof value.id !== "string") throw new Error("Invalid Node input");
  const decoded = nodeFromV2Value(value as SyncNodeValue);
  if (!("memoType" in value) && decoded.type === "memo") delete decoded.memoType;
  return decoded;
});
const plan = planV1ToV2Migration(nodes, migrationId);
const report = { migrationId, source: input, sourceSha256: createHash("sha256").update(raw).digest("hex"), ...plan };
writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ ...report, records: `${plan.records.length} records in ${output}` }, null, 2));
if (plan.issues.length || plan.lostFieldCount) process.exitCode = 1;
