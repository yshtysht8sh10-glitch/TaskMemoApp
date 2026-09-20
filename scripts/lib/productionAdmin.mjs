import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const PRODUCTION_PROJECT = "taskmemoapp-eabc3";
export const AUTHORITATIVE_SHA256 = "4da5ae29e427831025da485e40f84fc21180591421c40b26e62d3d7817bcae73";
export const EXPECTED_NODE_COUNT = 124;
export const TOOL_VERSION = 1;

export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
export const canonicalJson = value => JSON.stringify(canonical(value));

export function requireIdentity({ projectId, expectedProjectId, uid, migrationId }) {
  if (!projectId || projectId !== expectedProjectId || expectedProjectId !== PRODUCTION_PROJECT) throw new Error("Production project identity mismatch.");
  if (!uid || uid.trim() !== uid || uid.includes("/") || uid.length < 2) throw new Error("One explicit unambiguous UID is required.");
  if (!migrationId || migrationId.trim() !== migrationId) throw new Error("An explicit migration ID is required.");
}

export function writeAuditCreateOnly(path, report) {
  const safe = JSON.parse(JSON.stringify(report, (key, value) => /token|authorization|secret/i.test(key) ? undefined : value));
  writeFileSync(resolve(path), JSON.stringify(safe, null, 2), { flag: "wx" });
}

export function compareSnapshotPair(firstRaw, secondRaw, identity, expectedSnapshotCount) {
  requireIdentity(identity);
  const parse = raw => {
    const value = JSON.parse(raw);
    if (value.projectId !== identity.projectId || !Array.isArray(value.nodes)) throw new Error("Invalid snapshot/project.");
    if (value.nodes.some(item => item.uid !== identity.uid)) throw new Error("Snapshot contains an unexpected UID.");
    const entries = value.nodes.map(item => [String(item.node?.id), canonical(item.node)]).sort(([a], [b]) => a.localeCompare(b));
    if (entries.some(([id], index) => !id || (index && id === entries[index - 1][0]))) throw new Error("Snapshot has missing/duplicate Node IDs.");
    return { documentCount: entries.length, ids: entries.map(([id]) => id), canonicalSha256: sha256(canonicalJson(entries)) };
  };
  const first = parse(firstRaw); const second = parse(secondRaw);
  if (!Number.isInteger(expectedSnapshotCount) || expectedSnapshotCount < 1) throw new Error("Explicit expected snapshot count is required.");
  const stable = first.documentCount === expectedSnapshotCount && second.documentCount === expectedSnapshotCount && first.documentCount === second.documentCount && canonicalJson(first.ids) === canonicalJson(second.ids) && first.canonicalSha256 === second.canonicalSha256;
  return { decision: stable ? "PASS" : "STOP", first, second, migrationId: identity.migrationId };
}

export function sealBackupManifest({ snapshotRaw, sourceRaw, snapshotPath, sourcePath, acquisitionTime, commit, identity, expectedSnapshotCount, comparisonRaw, expectedSourceSha256 = AUTHORITATIVE_SHA256 }) {
  requireIdentity(identity);
  const snapshot = JSON.parse(snapshotRaw);
  const comparison = compareSnapshotPair(snapshotRaw, snapshotRaw, identity, expectedSnapshotCount);
  const comparisonAudit = JSON.parse(comparisonRaw);
  if (comparisonAudit.decision !== "PASS" || comparisonAudit.first?.canonicalSha256 !== comparison.first.canonicalSha256 || comparisonAudit.second?.canonicalSha256 !== comparison.first.canonicalSha256) throw new Error("Approved stable snapshot comparison is required.");
  if (sha256(sourceRaw) !== expectedSourceSha256) throw new Error("Authoritative source SHA-256 mismatch.");
  if (snapshot.nodes.length < 1) throw new Error("Snapshot is empty.");
  return {
    schemaVersion: 1, kind: "taskmemo-cutover-immutable-backup-manifest", toolVersion: TOOL_VERSION,
    projectId: identity.projectId, uid: identity.uid, migrationId: identity.migrationId,
    acquisitionTime, sealedAt: new Date().toISOString(), commit,
    snapshot: { path: snapshotPath, byteSha256: sha256(snapshotRaw), documentCount: snapshot.nodes.length, canonicalSha256: comparison.first.canonicalSha256 },
    snapshotPairComparisonSha256: sha256(comparisonRaw),
    authoritativeSource: { path: sourcePath, byteSha256: sha256(sourceRaw), expectedNodeCount: EXPECTED_NODE_COUNT },
  };
}

export function firestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, firestoreValue(child)])) } };
}
export const firestoreFields = value => Object.fromEntries(Object.entries(value).map(([key, child]) => [key, firestoreValue(child)]));

export function makeMigrationPlan({ sourceRaw, prepared, identity, expectedSourceSha256 = AUTHORITATIVE_SHA256, expectedNodeCount = EXPECTED_NODE_COUNT }) {
  requireIdentity(identity);
  if (sha256(sourceRaw) !== expectedSourceSha256) throw new Error("Authoritative source SHA-256 mismatch.");
  if (prepared.sourceCount !== expectedNodeCount || prepared.outputCount !== expectedNodeCount) throw new Error("Expected Node count mismatch.");
  if (prepared.issues.length || prepared.changedFields.length || prepared.lostFieldCount) throw new Error("Migration is not lossless.");
  const ids = prepared.records.map(record => String(record.value.id));
  if (new Set(ids).size !== expectedNodeCount || ids.includes("ipa-morning")) throw new Error("Migration ID set is invalid.");
  const writes = prepared.records.map(record => ({
    update: { name: `projects/${identity.projectId}/databases/(default)/documents/users/${identity.uid}/nodesV2/${encodeURIComponent(record.value.id)}`, fields: firestoreFields({ ownerUid: identity.uid, schemaVersion: 2, record }) },
    currentDocument: { exists: false },
  }));
  return { schemaVersion: 1, projectId: identity.projectId, uid: identity.uid, migrationId: identity.migrationId, sourceSha256: sha256(sourceRaw), nodeCount: ids.length, ids: ids.sort(), semanticChanges: 0, lostFields: 0, writes };
}

export function validateV2({ sourceRaw, prepared, remoteRecords, profile, identity, expectedSourceSha256 = AUTHORITATIVE_SHA256, expectedNodeCount = EXPECTED_NODE_COUNT }) {
  const plan = makeMigrationPlan({ sourceRaw, prepared, identity, expectedSourceSha256, expectedNodeCount });
  const remote = new Map(remoteRecords.map(item => [String(item.record?.value?.id), item]));
  const mismatches = [];
  for (const expected of prepared.records) {
    const actual = remote.get(String(expected.value.id));
    if (!actual) mismatches.push({ nodeId: expected.value.id, kind: "missing" });
    else if (canonicalJson(actual.record) !== canonicalJson(expected)) mismatches.push({ nodeId: expected.value.id, kind: "field-difference" });
  }
  for (const id of remote.keys()) if (!plan.ids.includes(id)) mismatches.push({ nodeId: id, kind: "unexpected" });
  if (profile?.pinnedNote?.body !== "" || profile?.features?.ideasEnabled !== false || (profile?.legacyPinnedNoteCandidates?.length ?? 0) !== 0) mismatches.push({ kind: "profile" });
  return { decision: mismatches.length ? "STOP" : "PASS", nodeCount: remote.size, expectedNodeCount, mismatches };
}

export function collectDiagnosticEvidence({ events, clients, nodes, receipts, functionRequests }) {
  for (const kind of ["v1-write-attempt", "schema-owner-failure", "permanent-sync-error"])
    if (!events.some(item => item.kind === kind)) throw new Error(`Required diagnostic evidence is missing: ${kind}`);
  if (!clients.length) throw new Error("At least one client diagnostic is required.");
  const receiptIds = receipts.map(item => item.operation?.opId ?? item.opId).filter(Boolean);
  const receiptSet = new Set(receiptIds);
  const duplicates = receiptIds.length - new Set(receiptIds).size;
  const missing = nodes.filter(node => node.lastOpId && !String(node.lastOpId).startsWith("migration:") && node.lastOpId !== "initial" && !receiptSet.has(node.lastOpId) && node.revision > 0).length;
  const regressions = nodes.filter(node => Number(node.revision) < 0).length;
  const partial = functionRequests.filter(item => !item.completedAt || !Array.isArray(item.operationIds) || item.operationIds.some(opId => !receiptSet.has(opId))).length;
  const counts = new Map(events.map(item => [item.kind, item.count]));
  counts.set("receipt-missing", (counts.get("receipt-missing") ?? 0) + missing);
  counts.set("duplicate-receipt", (counts.get("duplicate-receipt") ?? 0) + duplicates);
  counts.set("revision-regression", (counts.get("revision-regression") ?? 0) + regressions);
  counts.set("functions-partial-transaction", (counts.get("functions-partial-transaction") ?? 0) + partial);
  return { capturedAt: new Date().toISOString(), events: [...counts].map(([kind, count]) => ({ kind, count })), clients };
}

export function confirmationFor(kind, identity, suffix = "") {
  return `${kind}:${identity.projectId}:${identity.uid}:${identity.migrationId}${suffix ? `:${suffix}` : ""}`;
}

export function buildControlGateWrites(identity, action) {
  requireIdentity(identity);
  const states = {
    "v1-enabled": [{ schemaVersion: 1, writesEnabled: true }, { schemaVersion: 1, minimumSyncProtocol: 1, v1WritesAllowed: true, v2Enabled: false }],
    freeze: [{ schemaVersion: 1, writesEnabled: false }, null],
    "v2-frozen": [{ schemaVersion: 1, writesEnabled: false }, { schemaVersion: 1, minimumSyncProtocol: 2, v1WritesAllowed: false, v2Enabled: true }],
    "v2-enabled": [{ schemaVersion: 1, writesEnabled: true }, { schemaVersion: 1, minimumSyncProtocol: 2, v1WritesAllowed: false, v2Enabled: true }],
  };
  if (!states[action]) throw new Error("Unknown control/gate action.");
  const [control, gate] = states[action];
  const writes = [{ update: { name: `projects/${identity.projectId}/databases/(default)/documents/syncControl/current`, fields: firestoreFields(control) } }];
  if (gate) writes.push({ update: { name: `projects/${identity.projectId}/databases/(default)/documents/users/${identity.uid}/syncMetadataV2/compatibility`, fields: firestoreFields(gate) } });
  return writes;
}

export function buildCanaryWrites(identity, spec) {
  requireIdentity(identity);
  if (spec.uid !== identity.uid || spec.migrationId !== identity.migrationId || !spec.opId || !spec.nodeId || !spec.record || !spec.operation || !spec.expectedUpdateTime) throw new Error("Invalid canary operation specification.");
  return [
    { update: { name: `projects/${identity.projectId}/databases/(default)/documents/users/${identity.uid}/nodesV2/${encodeURIComponent(spec.nodeId)}`, fields: firestoreFields({ ownerUid: identity.uid, schemaVersion: 2, record: spec.record }) }, currentDocument: { updateTime: spec.expectedUpdateTime } },
    { update: { name: `projects/${identity.projectId}/databases/(default)/documents/users/${identity.uid}/syncOperationsV2/${encodeURIComponent(spec.opId)}`, fields: firestoreFields({ ownerUid: identity.uid, schemaVersion: 2, operation: spec.operation }) }, currentDocument: { exists: false } },
  ];
}
