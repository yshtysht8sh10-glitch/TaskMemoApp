import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const [projectId, expectedProjectId, output, confirmation] = process.argv.slice(2);
const region = "asia-northeast1"; const functionName = "taskMemoMcp";
if (projectId !== "taskmemoapp-eabc3" || expectedProjectId !== projectId || confirmation !== "read-only:functions:taskmemoapp-eabc3:asia-northeast1:taskMemoMcp") throw new Error("Exact production Functions read-only confirmation is required.");
const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
if (!token) throw new Error("GOOGLE_OAUTH_ACCESS_TOKEN is required and is never persisted.");
const url = `https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/${region}/functions/${functionName}`;
const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!response.ok) throw new Error(`Functions metadata read failed: ${response.status} ${await response.text()}`);
const value = await response.json();
const sanitize = input => Array.isArray(input) ? input.map(sanitize) : input && typeof input === "object"
  ? Object.fromEntries(Object.entries(input).map(([key, child]) => /token|secret|environmentVariables/i.test(key) ? [key, "[REDACTED]"] : [key, sanitize(child)]))
  : input;
const artifact = { schemaVersion: 1, kind: "taskmemo-functions-rollback-metadata", capturedAt: new Date().toISOString(), projectId, region, functionName, metadata: sanitize(value) };
const serialized = JSON.stringify(artifact, null, 2);
writeFileSync(output, serialized, { flag: "wx" });
console.log(JSON.stringify({ output, sha256: createHash("sha256").update(serialized).digest("hex"), warning: "Metadata is evidence, not a restorable source artifact." }));
