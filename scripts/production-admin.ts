import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { prepareSchema1V1Export } from "../src/sync/v1ExportMigration";
import { applyRevisionOperation } from "../src/sync/revisionModel";
import type { SyncOperation, VersionedNode } from "../src/sync/types";
import { decodeFirestoreFields } from "./lib/readOnlyFirestoreSnapshot.mjs";
import {
  AUTHORITATIVE_SHA256, EXPECTED_NODE_COUNT, PRODUCTION_PROJECT, canonicalJson,
  collectDiagnosticEvidence, compareSnapshotPair, confirmationFor, firestoreFields,
  buildCanaryWrites, buildControlGateWrites, makeMigrationPlan, requireIdentity, sealBackupManifest, sha256, validateV2, writeAuditCreateOnly,
} from "./lib/productionAdmin.mjs";

type Args = Record<string, string | boolean>;
const [command, ...tokens] = process.argv.slice(2);
const args: Args = {};
for (let index = 0; index < tokens.length; index++) {
  const token = tokens[index];
  if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
  const [rawKey, inline] = token.slice(2).split("=", 2);
  args[rawKey] = inline ?? (tokens[index + 1] && !tokens[index + 1].startsWith("--") ? tokens[++index] : true);
}
const required = (name: string) => { const value = args[name]; if (typeof value !== "string" || !value) throw new Error(`--${name} is required`); return value; };
const identity = () => ({ projectId: required("project"), expectedProjectId: required("expected-project"), uid: required("uid"), migrationId: required("migration-id") });
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const raw = (path: string) => readFileSync(path, "utf8");
const audit = (payload: object, decision = "PASS") => {
  const report = { schemaVersion: 1, tool: `production-admin/${command}`, decision, generatedAt: new Date().toISOString(), ...payload };
  writeAuditCreateOnly(required("audit"), report);
  console.log(JSON.stringify({ decision, audit: required("audit") }));
  if (decision === "STOP") process.exitCode = 2;
};
const oauth = () => { const value = process.env.GOOGLE_OAUTH_ACCESS_TOKEN; if (!value) throw new Error("GOOGLE_OAUTH_ACCESS_TOKEN is required and is never persisted."); return value; };
const idToken = () => { const value = process.env.FIREBASE_ID_TOKEN; if (!value) throw new Error("FIREBASE_ID_TOKEN is required and is never persisted."); return value; };
const base = (project: string) => `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
async function request(url: string, token: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Firestore ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}
async function getAdminDoc(project: string, path: string) {
  const response = await fetch(`${base(project)}/${path}`, { headers: { Authorization: `Bearer ${oauth()}` } });
  if (response.status === 404) return null;
  const text = await response.text();
  if (!response.ok) throw new Error(`Firestore ${response.status}: ${text.slice(0, 500)}`);
  const document: any = JSON.parse(text);
  return { value: decodeFirestoreFields(document.fields ?? {}), updateTime: document.updateTime };
}
const commit = (project: string, writes: unknown[]) => request(`${base(project)}:commit`, oauth(), { method: "POST", body: JSON.stringify({ writes }) });
const mode = () => args.mode === "write" ? "write" : "dry-run";
function confirm(kind: string, suffix = "") { const expected = confirmationFor(kind, identity(), suffix); if (required("confirm") !== expected) throw new Error(`Exact confirmation required: ${expected}`); }
async function queryCollection(project: string, collectionId: string) {
  const rows = await request(`${base(project)}:runQuery`, oauth(), { method: "POST", body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants: true }] } }) });
  return rows.filter((row: any) => row.document).map((row: any) => ({ name: row.document.name, updateTime: row.document.updateTime, ...decodeFirestoreFields(row.document.fields ?? {}) }));
}

async function main() {
  if (!command) throw new Error("A production admin subcommand is required.");
  const id = identity(); requireIdentity(id);
  if (command === "compare-snapshots") {
    const result = compareSnapshotPair(raw(required("first")), raw(required("second")), id, Number(required("expected-count")));
    return audit({ identity: id, ...result }, result.decision);
  }
  if (command === "seal-backup") {
    const sourcePath = required("source"); const snapshotPath = required("snapshot");
    const manifest = sealBackupManifest({ snapshotRaw: raw(snapshotPath), sourceRaw: raw(sourcePath), snapshotPath, sourcePath, acquisitionTime: required("acquired-at"), commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), identity: id, expectedSnapshotCount: Number(required("expected-count")), comparisonRaw: raw(required("comparison")) });
    writeAuditCreateOnly(required("manifest"), manifest);
    return audit({ identity: id, manifest: required("manifest"), manifestSha256: sha256(JSON.stringify(manifest)) });
  }
  if (command === "control-gate") {
    const action = required("action");
    const writes: any[] = buildControlGateWrites(id, action);
    if (mode() === "write") {
      confirm("CONTROL", action);
      const expectedRaw = raw(required("expected-current"));
      if (sha256(expectedRaw) !== required("expected-current-sha")) throw new Error("Control precondition artifact SHA-256 mismatch.");
      const expected = JSON.parse(expectedRaw);
      const currentControl = await getAdminDoc(id.projectId, "syncControl/current");
      const currentGate = await getAdminDoc(id.projectId, `users/${id.uid}/syncMetadataV2/compatibility`);
      if (canonicalJson(currentControl?.value ?? null) !== canonicalJson(expected.control ?? null) || canonicalJson(currentGate?.value ?? null) !== canonicalJson(expected.gate ?? null)) throw new Error("Control/gate precondition changed; STOP.");
      writes[0].currentDocument = currentControl ? { updateTime: currentControl.updateTime } : { exists: false };
      if (writes[1]) writes[1].currentDocument = currentGate ? { updateTime: currentGate.updateTime } : { exists: false };
      await commit(id.projectId, writes);
    }
    return audit({ identity: id, mode: mode(), action, plannedWrites: writes.length });
  }
  if (command === "protocol-probe") {
    const protocol = Number(required("protocol")); const expected = required("expect");
    if (![1, 2].includes(protocol) || !["read-only", "writable", "denied"].includes(expected)) throw new Error("Invalid probe protocol/expectation.");
    const collection = protocol === 1 ? "nodes" : "nodesV2";
    const url = `${base(id.projectId)}/users/${id.uid}/${collection}?pageSize=1`;
    let readAllowed = true; try { await request(url, idToken()); } catch { readAllowed = false; }
    if ((expected === "denied") === readAllowed || (expected !== "denied" && !readAllowed)) return audit({ identity: id, protocol, expected, readAllowed }, "STOP");
    // Write probes are explicit and leave a uniquely identified marker only if cleanup itself fails.
    let writeAllowed: boolean | null = null;
    if (args["probe-write"] === true) {
      confirm("PROBE", `${protocol}:${expected}`);
      const probeId = `cutover-probe-${encodeURIComponent(id.migrationId)}`; const probeUrl = `${base(id.projectId)}/users/${id.uid}/${collection}/${probeId}`;
      try {
        await request(probeUrl, idToken(), { method: "PATCH", body: JSON.stringify({ fields: firestoreFields({ id: probeId, ownerUid: id.uid, probe: true }) }) });
        writeAllowed = true;
      } catch { writeAllowed = false; }
      if (writeAllowed) {
        try { await request(probeUrl, idToken(), { method: "DELETE" }); }
        catch { throw new Error(`Write probe cleanup failed for ${probeId}; STOP and remove only this exact marker after review.`); }
      }
      if ((expected === "writable") !== writeAllowed) return audit({ identity: id, protocol, expected, readAllowed, writeAllowed }, "STOP");
    }
    return audit({ identity: id, protocol, expected, readAllowed, writeAllowed });
  }
  if (command === "migrate") {
    const sourcePath = required("source"); const sourceRaw = raw(sourcePath); const prepared = prepareSchema1V1Export(sourceRaw, id.migrationId).migration;
    const plan = makeMigrationPlan({ sourceRaw, prepared, identity: id });
    let application = "planned";
    if (mode() === "write") {
      confirm("MIGRATE", AUTHORITATIVE_SHA256);
      const existing = (await queryCollection(id.projectId, "nodesV2")).filter((item: any) => item.name.includes(`/users/${id.uid}/`));
      if (existing.length) {
        const checked = validateV2({ sourceRaw, prepared, remoteRecords: existing.map((item: any) => ({ record: item.record })), profile: { pinnedNote: { body: "" }, features: { ideasEnabled: false }, legacyPinnedNoteCandidates: [] }, identity: id });
        if (checked.decision !== "PASS") return audit({ identity: id, mode: mode(), application: "precondition-stopped", validation: checked }, "STOP");
        application = "already-applied-idempotent";
      } else {
        await commit(id.projectId, plan.writes);
        const after = (await queryCollection(id.projectId, "nodesV2")).filter((item: any) => item.name.includes(`/users/${id.uid}/`));
        const checked = validateV2({ sourceRaw, prepared, remoteRecords: after.map((item: any) => ({ record: item.record })), profile: { pinnedNote: { body: "" }, features: { ideasEnabled: false }, legacyPinnedNoteCandidates: [] }, identity: id });
        if (checked.decision !== "PASS") return audit({ identity: id, mode: mode(), application: "post-write-stopped", validation: checked }, "STOP");
        application = "atomically-applied-and-validated";
      }
    }
    return audit({ identity: id, mode: mode(), application, sourceSha256: plan.sourceSha256, nodeCount: plan.nodeCount, semanticChanges: 0, lostFields: 0, deterministicIds: plan.ids });
  }
  if (command === "validate-v2") {
    const sourceRaw = raw(required("source")); const prepared = prepareSchema1V1Export(sourceRaw, id.migrationId).migration;
    const docs = args.fixture ? json(required("fixture")) : {
      nodes: await queryCollection(id.projectId, "nodesV2"),
      profile: { pinnedNote: (await queryCollection(id.projectId, "profileV2")).find((x: any) => x.name.endsWith("/pinnedNote"))?.record?.value ?? { body: "" }, features: (await queryCollection(id.projectId, "profileV2")).find((x: any) => x.name.endsWith("/features"))?.record?.value ?? { ideasEnabled: false }, legacyPinnedNoteCandidates: [] },
    };
    const records = docs.nodes.filter((item: any) => item.name?.includes(`/users/${id.uid}/`) || !item.name).map((item: any) => ({ record: item.record ?? item }));
    const result = validateV2({ sourceRaw, prepared, remoteRecords: records, profile: docs.profile, identity: id });
    return audit({ identity: id, ...result }, result.decision);
  }
  if (command === "collect-diagnostics") {
    const clientEvidence = json(required("client-evidence"));
    const fixture = args.fixture ? json(required("fixture")) : null;
    const owned = (items: any[]) => items.filter(item => !item.name || item.name.includes(`/users/${id.uid}/`));
    const nodes = owned(fixture?.nodes ?? await queryCollection(id.projectId, "nodesV2"));
    const receipts = owned(fixture?.receipts ?? await queryCollection(id.projectId, "syncOperationsV2"));
    const requests = owned(fixture?.functionRequests ?? await queryCollection(id.projectId, "externalAiRequestsV2"));
    const result = collectDiagnosticEvidence({ events: clientEvidence.events, clients: clientEvidence.clients, nodes: nodes.map((x: any) => x.record ?? x), receipts, functionRequests: requests });
    writeAuditCreateOnly(required("evidence"), result);
    return audit({ identity: id, evidence: required("evidence"), evidenceSha256: sha256(JSON.stringify(result)) });
  }
  if (command === "canary") {
    const canaryMode = required("canary-mode");
    if (canaryMode === "read") {
      const nodes = await queryCollection(id.projectId, "nodesV2");
      return audit({ identity: id, canaryMode, nodeCount: nodes.filter((x: any) => x.name.includes(`/users/${id.uid}/`)).length });
    }
    if (canaryMode !== "write") throw new Error("canary-mode must be read or write.");
    const specRaw = raw(required("operation")); const spec = JSON.parse(specRaw); const specSha = sha256(specRaw);
    if (mode() !== "write") return audit({ identity: id, canaryMode, mode: "dry-run", operationSha256: specSha, pointOfNoReturn: true });
    confirm("POINT-OF-NO-RETURN", specSha);
    const writes: any[] = buildCanaryWrites(id, spec);
    const control = await getAdminDoc(id.projectId, "syncControl/current");
    const gate = await getAdminDoc(id.projectId, `users/${id.uid}/syncMetadataV2/compatibility`);
    if (canonicalJson(control?.value) !== canonicalJson({ schemaVersion: 1, writesEnabled: true }) || canonicalJson(gate?.value) !== canonicalJson({ schemaVersion: 1, minimumSyncProtocol: 2, v1WritesAllowed: false, v2Enabled: true })) throw new Error("V2 writable gate precondition is not satisfied.");
    const current = await getAdminDoc(id.projectId, `users/${id.uid}/nodesV2/${encodeURIComponent(spec.nodeId)}`);
    if (!current || (current.value as { record?: VersionedNode }).record?.revision !== spec.expectedRevision) throw new Error("Canary Node revision precondition changed.");
    const evaluated = applyRevisionOperation((current.value as { record?: VersionedNode }).record, spec.operation as SyncOperation);
    if (evaluated.result !== "applied" || canonicalJson(evaluated.record) !== canonicalJson(spec.record)) throw new Error("Canary operation does not deterministically produce the reviewed winner record.");
    writes[0].currentDocument = { updateTime: current.updateTime };
    await commit(id.projectId, writes);
    return audit({ identity: id, canaryMode, mode: "write", operationSha256: specSha, opId: spec.opId, pointOfNoReturnCrossed: true });
  }
  throw new Error(`Unknown production admin subcommand: ${command}`);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  if (typeof args.audit === "string") {
    try { writeAuditCreateOnly(args.audit, { schemaVersion: 1, tool: `production-admin/${command ?? "unknown"}`, decision: "FAIL", generatedAt: new Date().toISOString(), error: message }); }
    catch { /* Never overwrite an existing audit while reporting the original failure. */ }
  }
  console.error(message);
  process.exitCode = 1;
});
