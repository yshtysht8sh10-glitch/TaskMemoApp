import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { decodeFirestoreFields, productionV1ReadRequest } from "./lib/readOnlyFirestoreSnapshot.mjs";

const [outputPath, confirmation] = process.argv.slice(2);
if (!outputPath) throw new Error("Usage: node scripts/read-production-v1-snapshot.mjs <new-output.json> read-only:taskmemoapp-eabc3");
const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
if (!token) throw new Error("GOOGLE_OAUTH_ACCESS_TOKEN is required and is never written to output.");
const request = productionV1ReadRequest("taskmemoapp-eabc3", confirmation);
const response = await fetch(request.url, {
  method: request.method,
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(request.body),
});
if (!response.ok) throw new Error(`Read-only Firestore query failed: ${response.status} ${await response.text()}`);
const rows = await response.json();
const documents = rows.filter(row => row.document).map(row => row.document);
const nodes = documents.map(document => {
  const segments = document.name.split("/");
  return { uid: segments.at(-3), node: { ...decodeFirestoreFields(document.fields ?? {}), id: segments.at(-1) }, sourceName: document.name, createTime: document.createTime, updateTime: document.updateTime };
});
const payload = { schemaVersion: 1, projectId: "taskmemoapp-eabc3", capturedAt: new Date().toISOString(), query: "collectionGroup(nodes)", documentCount: nodes.length, rawDocuments: documents, nodes };
const json = JSON.stringify(payload, null, 2);
const absolute = resolve(outputPath);
mkdirSync(dirname(absolute), { recursive: true });
writeFileSync(absolute, json, { flag: "wx" });
console.log(JSON.stringify({ output: absolute, documentCount: nodes.length, sha256: createHash("sha256").update(json).digest("hex") }));
