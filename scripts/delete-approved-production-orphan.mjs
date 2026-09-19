import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { decodeFirestoreFields, productionV1ReadRequest } from "./lib/readOnlyFirestoreSnapshot.mjs";

const PROJECT = "taskmemoapp-eabc3";
const NODE_ID = "ipa-morning";
const [backupPath, confirmation] = process.argv.slice(2);
if (!backupPath || confirmation !== `delete-only:${PROJECT}:${NODE_ID}`)
  throw new Error(`Usage: node scripts/delete-approved-production-orphan.mjs <new-private-backup.json> delete-only:${PROJECT}:${NODE_ID}`);
const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
if (!token) throw new Error("GOOGLE_OAUTH_ACCESS_TOKEN is required and is never stored.");

const query = async () => {
  const request = productionV1ReadRequest(PROJECT, `read-only:${PROJECT}`);
  const response = await fetch(request.url, {
    method: request.method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(request.body),
  });
  if (!response.ok) throw new Error(`Production verification query failed: ${response.status}`);
  return (await response.json()).filter(row => row.document).map(row => row.document);
};

const before = await query();
const targets = before.filter(document => document.name.split("/").at(-1) === NODE_ID);
if (targets.length !== 1) throw new Error(`Expected exactly one ${NODE_ID}; found ${targets.length}.`);
const target = targets[0];
const decoded = decodeFirestoreFields(target.fields ?? {});
if (decoded.parentId !== "ipa" || !decoded.deletedAt || decoded.purgedAt)
  throw new Error("Live target no longer matches the approved deleted-orphan shape.");
const children = before.filter(document => decodeFirestoreFields(document.fields ?? {}).parentId === NODE_ID);
if (children.length) throw new Error(`Refusing deletion because ${children.length} child Node(s) reference ${NODE_ID}.`);

const absoluteBackup = resolve(backupPath);
mkdirSync(dirname(absoluteBackup), { recursive: true });
writeFileSync(absoluteBackup, JSON.stringify({ schemaVersion: 1, projectId: PROJECT, capturedAt: new Date().toISOString(), approvedNodeId: NODE_ID, document: target }, null, 2), { flag: "wx" });

const deleteUrl = `https://firestore.googleapis.com/v1/${target.name}?currentDocument.updateTime=${encodeURIComponent(target.updateTime)}`;
const deletion = await fetch(deleteUrl, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
if (!deletion.ok) throw new Error(`Exact production deletion failed: ${deletion.status} ${await deletion.text()}`);

const after = await query();
if (after.some(document => document.name === target.name)) throw new Error("Deleted document is still present.");
if (after.length !== before.length - 1) throw new Error(`Unexpected document count after deletion: ${before.length} -> ${after.length}.`);
const targetName = target.name;
const stable = value => JSON.stringify(value);
const afterByName = new Map(after.map(document => [document.name, document]));
for (const document of before) {
  if (document.name === targetName) continue;
  if (!afterByName.has(document.name) || stable(afterByName.get(document.name)) !== stable(document))
    throw new Error(`Non-target production document changed: ${document.name}`);
}

console.log(JSON.stringify({ projectId: PROJECT, deletedNodeId: NODE_ID, beforeCount: before.length, afterCount: after.length, childCount: children.length, nonTargetDocumentsUnchanged: true, backup: absoluteBackup }));
