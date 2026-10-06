// Exact read-only Firestore receipt inspection. Never prints Node title/body or credentials.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { decodeFirestoreFields } from "./lib/readOnlyFirestoreSnapshot.mjs";

const cliRoot = process.env.TASKMEMO_FIREBASE_TOOLS_LIB;
const identityPath = process.env.TASKMEMO_PRIVATE_IDENTITY;
if (!cliRoot || !identityPath) throw new Error("Set TASKMEMO_FIREBASE_TOOLS_LIB and TASKMEMO_PRIVATE_IDENTITY.");
const require = createRequire(import.meta.url);
const auth = require(`${cliRoot}/auth.js`);
const scopes = require(`${cliRoot}/scopes.js`);
const uid = JSON.parse(readFileSync(identityPath, "utf8")).identity?.uid;
if (typeof uid !== "string" || !uid) throw new Error("Private identity UID unavailable.");
const account = auth.getGlobalDefaultAccount();
const token = await auth.getAccessToken(account?.tokens?.refresh_token, [scopes.CLOUD_PLATFORM]);
const project = "taskmemoapp-eabc3";
const deviceId = "taskmemo-mu9yhy0n-raqz15zixjp";
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/users/${encodeURIComponent(uid)}/syncOperationsV2/`;
const ids = Array.from({ length: 104 }, (_, index) => 9493 + index);
const receipts = [];
for (let offset = 0; offset < ids.length; offset += 8) {
  const batch = await Promise.all(ids.slice(offset, offset + 8).map(async seq => {
    const response = await fetch(base + encodeURIComponent(`${deviceId}:${seq}`),
      { method: "GET", headers: { Authorization: `Bearer ${token.access_token}` } });
    if (response.status === 404) return { seq, missing: true };
    if (!response.ok) throw new Error(`Read ${seq} failed: HTTP ${response.status}`);
    const document = await response.json();
    const fields = decodeFirestoreFields(document.fields ?? {});
    const operation = fields.operation ?? {};
    const value = operation.payload?.node ?? null;
    const ack = fields.acknowledgement?.record ?? null;
    return { seq, missing: false, operation, value, ack,
      serverReceivedAt: fields.serverReceivedAt ?? null, receiptUpdateTime: document.updateTime ?? null };
  }));
  receipts.push(...batch);
}
const observed = receipts.filter(receipt => !receipt.missing);
const previousByTarget = new Map();
const summaries = observed.map(receipt => {
  const { operation: op, value, ack } = receipt;
  const target = `${op.targetType ?? "node"}:${op.targetNodeId}`;
  const previous = previousByTarget.get(target);
  const before = previous?.ack?.value ?? null;
  const changedFieldsFromPreviousReceipt = before && value
    ? [...new Set([...Object.keys(before), ...Object.keys(value)])]
      .filter(key => JSON.stringify(before[key]) !== JSON.stringify(value[key])).sort()
    : null;
  previousByTarget.set(target, receipt);
  return { seq: receipt.seq, opId: op.opId, type: op.type, target,
    parentId: value?.parentId ?? null,
    previousReceiptSeq: previous?.seq ?? null,
    previousAcknowledgedRevision: previous?.ack?.revision ?? null,
    createdAt: op.createdAt, serverReceivedAt: receipt.serverReceivedAt,
    receiptUpdateTime: receipt.receiptUpdateTime, baseRevision: op.baseRevision,
    acknowledgedRevision: ack?.revision ?? null, acknowledgedLastOpId: ack?.lastOpId ?? null,
    payloadFieldNames: value ? Object.keys(value).sort() : [],
    changedFieldsFromPreviousReceipt };
});
const clusters = Object.entries(Object.groupBy(summaries, item => item.createdAt ?? "missing"))
  .map(([createdAt, group]) => ({ createdAt, count: group.length,
    firstSeq: group[0].seq, lastSeq: group.at(-1).seq,
    uniqueTargets: new Set(group.map(item => item.target)).size,
    parentGroups: Object.entries(Object.groupBy(group, item => item.parentId ?? "root"))
      .map(([parentId, items]) => ({ parentId, count: items.length })) }));
console.log(JSON.stringify({ project, deviceId, requested: ids.length, found: observed.length,
  missingSeqs: receipts.filter(receipt => receipt.missing).map(receipt => receipt.seq),
  clusters, focus: summaries.filter(item => item.seq === 9544 || item.seq >= 9595),
  operations: summaries.filter(item => item.seq >= 9543).map(item => ({
    seq: item.seq, type: item.type, target: item.target, createdAt: item.createdAt,
    serverReceivedAt: item.serverReceivedAt, changedFieldsFromPreviousReceipt: item.changedFieldsFromPreviousReceipt,
  })) }, null, 2));
