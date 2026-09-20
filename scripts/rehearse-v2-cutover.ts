/// <reference types="node" />
import { constants, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, Timestamp, type Firestore } from "firebase/firestore";
import type { Node } from "../src/models/node";
import { createFirebaseSyncAdapter } from "../src/sync/firebaseSyncAdapter";
import { planV1ToV2Migration } from "../src/sync/migrationDryRun";
import type { SyncOperation } from "../src/sync/types";
import { assessFormalSourceInventory } from "./lib/formalRehearsalSource.mjs";
import type { ApplicationJournalPersistence } from "../src/sync/applicationStore";
import { TaskMemoV2ApplicationStore } from "../src/sync/taskMemoApplicationStore";
import { TaskMemoV2SyncController } from "../src/sync/taskMemoV2SyncController";
import { updateNode } from "../src/domain/nodeOperations";

const PROJECT = "demo-taskmemo-rehearsal";
const [input, migrationId, backup, reportPath, ...flags] = process.argv.slice(2);
const diagnosticContinuation = flags.includes("--continue-after-validation-stop=orphan-preservation-only");
const validationMustPass = flags.includes("--validation-must-pass");
const userApprovedProfileNonMigration = flags.includes("--profile-policy=user-approved-non-migration");
if (!input || !migrationId || !backup || !reportPath || (!diagnosticContinuation && !validationMustPass))
  throw new Error("Exact rehearsal arguments and either --validation-must-pass or the isolated diagnostic-continuation acknowledgement are required.");

const elapsed = (start: number) => Math.round((performance.now() - start) * 100) / 100;
const stable = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Timestamp) return { __firestoreTimestamp: { seconds: value.seconds, nanoseconds: value.nanoseconds } };
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
};
const hydrate = (source: Record<string, unknown>) => {
  const result = { ...source };
  for (const key of ["createdAt", "updatedAt", "deletedAt", "purgedAt", "dueAt", "completedAt"])
    if (typeof result[key] === "string") {
      const match = /^(.*:\d{2})(?:\.(\d{1,9}))?Z$/.exec(result[key] as string);
      if (!match) throw new Error(`Invalid timestamp field: ${key}`);
      result[key] = new Timestamp(Math.floor(Date.parse(`${match[1]}Z`) / 1000), Number((match[2] ?? "").padEnd(9, "0")));
    }
  return result;
};
const equal = (left: unknown, right: unknown) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const waitFor = async (predicate: () => boolean, timeout = 10_000) => {
  const started = Date.now();
  while (!predicate()) { if (Date.now() - started > timeout) throw new Error("Formal client convergence timeout."); await new Promise(resolveWait => setTimeout(resolveWait, 20)); }
};
class MemoryPersistence implements ApplicationJournalPersistence {
  committed: string | null = null; journal: string | null = null;
  loadCommitted = async () => this.committed; loadJournal = async () => this.journal;
  writeJournal = async (value: string) => { this.journal = value; };
  writeCommitted = async (value: string) => { this.committed = value; };
  clearJournal = async () => { this.journal = null; };
}

async function main() {
const started = performance.now();
mkdirSync(dirname(backup), { recursive: true });
const backupStarted = performance.now();
copyFileSync(input, backup, constants.COPYFILE_EXCL);
const backupMs = elapsed(backupStarted);
const source = JSON.parse(readFileSync(backup, "utf8")) as { projectId: string; documentCount: number; nodes: { uid: string; node: Record<string, unknown> }[]; localProfileInventory?: { complete?: boolean }; legacyPinnedNoteCandidates?: { body: string; updatedAt: string }[] };
if (source.projectId !== "taskmemoapp-eabc3" || source.documentCount !== source.nodes.length) throw new Error("Backup source identity/count mismatch.");
const users = [...new Set(source.nodes.map(item => item.uid))];
const environment = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: "127.0.0.1", port: 8280 } });
await environment.clearFirestore();
const restoreStarted = performance.now();
await environment.withSecurityRulesDisabled(async context => {
  const db = context.firestore();
  await setDoc(doc(db, "syncControl/current"), { schemaVersion: 1, writesEnabled: true });
  for (const uid of users) await setDoc(doc(db, `users/${uid}/syncMetadataV2/compatibility`), { schemaVersion: 1, minimumSyncProtocol: 1, v1WritesAllowed: true, v2Enabled: false });
  for (const item of source.nodes) await setDoc(doc(db, `users/${item.uid}/nodes/${item.node.id}`), hydrate(item.node));
});
const restoreMs = elapsed(restoreStarted);

const restoreValidationStarted = performance.now();
let restoredCount = 0;
await environment.withSecurityRulesDisabled(async context => {
  for (const uid of users) {
    const restored = await getDocs(collection(context.firestore(), `users/${uid}/nodes`));
    restoredCount += restored.size;
    const expected = new Map(source.nodes.filter(item => item.uid === uid).map(item => [String(item.node.id), hydrate(item.node)]));
    for (const snapshot of restored.docs) {
      if (!expected.has(snapshot.id) || !equal(snapshot.data(), expected.get(snapshot.id))) {
        const before = stable(expected.get(snapshot.id)) as Record<string, unknown>;
        const after = stable(snapshot.data()) as Record<string, unknown>;
        const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(key => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
        throw new Error(`Restore mismatch: ${snapshot.id}; fields=${fields.join(",")}`);
      }
    }
  }
});
if (restoredCount !== source.documentCount) throw new Error("Restore document count mismatch.");
const restoreValidationMs = elapsed(restoreValidationStarted);

const freezeStarted = performance.now();
await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "syncControl/current"), { schemaVersion: 1, writesEnabled: false }));
const plans = users.map(uid => ({ uid, plan: planV1ToV2Migration(source.nodes.filter(item => item.uid === uid).map(item => {
  const node = { ...item.node };
  for (const key of ["createdAt", "updatedAt", "deletedAt", "purgedAt", "dueAt", "completedAt"])
    if (typeof node[key] === "string") node[key] = new Date(node[key] as string);
  return node as Node;
}), migrationId) }));
const profileInventory = assessFormalSourceInventory(source, { userApprovedNonMigration: userApprovedProfileNonMigration });
const sourceIssues = [
  ...plans.flatMap(item => item.plan.issues),
  ...profileInventory.issues,
];
if (validationMustPass && sourceIssues.length) throw new Error(`Formal rehearsal stopped on ${sourceIssues.length} source validation issue(s).`);
const migrationStarted = performance.now();
await environment.withSecurityRulesDisabled(async context => {
  const db = context.firestore();
  for (const { uid, plan } of plans) for (const record of plan.records)
    await setDoc(doc(db, `users/${uid}/nodesV2/${record.value.id}`), { ownerUid: uid, schemaVersion: 2, record });
});
const migrationMs = elapsed(migrationStarted);
const migrationValidationStarted = performance.now();
await environment.withSecurityRulesDisabled(async context => {
  for (const { uid, plan } of plans) {
    const actual = await getDocs(collection(context.firestore(), `users/${uid}/nodesV2`));
    const expected = new Map(plan.records.map(record => [record.value.id, record]));
    if (actual.size !== expected.size) throw new Error("V2 count mismatch");
    for (const item of actual.docs) if (!equal(item.data().record, expected.get(item.id))) throw new Error(`V2 semantic mismatch: ${item.id}`);
  }
});
const migrationValidationMs = elapsed(migrationValidationStarted);
const gateStarted = performance.now();
await environment.withSecurityRulesDisabled(async context => {
  const db = context.firestore();
  for (const uid of users) await setDoc(doc(db, `users/${uid}/syncMetadataV2/compatibility`), { schemaVersion: 1, minimumSyncProtocol: 2, v1WritesAllowed: false, v2Enabled: true });
  await setDoc(doc(db, "syncControl/current"), { schemaVersion: 1, writesEnabled: true });
});
const gateMs = elapsed(gateStarted);

const uid = users[0];
const oldClient = environment.authenticatedContext(uid).firestore();
const sourceNode = source.nodes.find(item => item.uid === uid)!;
await assertFails(getDoc(doc(oldClient, `users/${uid}/nodes/${sourceNode.node.id}`)));
await assertFails(setDoc(doc(oldClient, `users/${uid}/nodes/${sourceNode.node.id}`), hydrate(sourceNode.node)));
const purged = source.nodes.find(item => item.uid === uid && item.node.purgedAt);
if (purged) await assertFails(setDoc(doc(oldClient, `users/${uid}/nodes/${purged.node.id}`), hydrate({ ...purged.node, purgedAt: null })));

const v2db = environment.authenticatedContext(uid).firestore() as unknown as Firestore;
const adapter = createFirebaseSyncAdapter(v2db, uid, "test", { emulator: true });
await adapter.connect();
const persistenceA = new MemoryPersistence(); const persistenceB = new MemoryPersistence();
let storeA = await TaskMemoV2ApplicationStore.open(persistenceA, [], { deviceId: "formal-client-a", initialPinnedNote: { body: "", updatedAt: new Date(0) }, initialIdeasEnabled: false });
const storeB = await TaskMemoV2ApplicationStore.open(persistenceB, [], { deviceId: "formal-client-b", initialPinnedNote: { body: "", updatedAt: new Date(0) }, initialIdeasEnabled: false });
let controllerA = new TaskMemoV2SyncController(storeA, createFirebaseSyncAdapter(v2db, uid, "test", { emulator: true }));
const controllerB = new TaskMemoV2SyncController(storeB, createFirebaseSyncAdapter(environment.authenticatedContext(uid).firestore() as unknown as Firestore, uid, "test", { emulator: true }));
await Promise.all([controllerA.start(), controllerB.start()]);
await waitFor(() => storeA.nodes.length === source.documentCount && storeB.nodes.length === source.documentCount);
const sourceIds = [...source.nodes.map(item => String(item.node.id))].sort();
if (JSON.stringify(storeA.nodes.map(node => node.id).sort()) !== JSON.stringify(sourceIds) || JSON.stringify(storeB.nodes.map(node => node.id).sort()) !== JSON.stringify(sourceIds)) throw new Error("V2 client Node IDs differ from the authoritative source.");
if (storeA.pinnedNote.body !== "" || storeA.ideasEnabled !== false || storeA.legacyPinnedNoteCandidates.length) throw new Error("Approved initial profile policy mismatch.");
const editable = storeA.nodes.find(node => node.type === "memo" && !node.purgedAt)!;
const originalTitle = editable.title; const rehearsalTitle = `${originalTitle} [formal-rehearsal]`;
await controllerA.command("formal edit", "update", nodes => updateNode(nodes, editable.id, { title: rehearsalTitle }, new Date("2026-09-20T08:00:00.000Z")));
await waitFor(() => storeB.nodes.find(node => node.id === editable.id)?.title === rehearsalTitle);
await controllerA.undo(); await waitFor(() => storeB.nodes.find(node => node.id === editable.id)?.title === originalTitle);
await controllerA.redo(); await waitFor(() => storeB.nodes.find(node => node.id === editable.id)?.title === rehearsalTitle);
controllerA.stop();
await storeA.command("formal offline edit", "update", nodes => updateNode(nodes, editable.id, { title: `${rehearsalTitle} offline` }, new Date("2026-09-20T08:01:00.000Z")));
storeA = await TaskMemoV2ApplicationStore.open(persistenceA, [], { deviceId: "ignored-after-restart" });
controllerA = new TaskMemoV2SyncController(storeA, createFirebaseSyncAdapter(v2db, uid, "test", { emulator: true }));
await controllerA.start();
await waitFor(() => storeB.nodes.find(node => node.id === editable.id)?.title === `${rehearsalTitle} offline`);
await controllerA.updatePinnedNote("formal pinned note", 0); await waitFor(() => storeB.pinnedNote.body === "formal pinned note");
await controllerA.updateIdeasEnabled(true); await waitFor(() => storeB.ideasEnabled === true);
if (storeA.nodes.filter(node => Boolean(node.purgedAt)).length !== plans[0].plan.purgedCount || storeB.nodes.filter(node => Boolean(node.purgedAt)).length !== plans[0].plan.purgedCount) throw new Error("Purged tombstone resurrection detected.");
const applicationIntegration = { loadedNodeCount: source.documentCount, nodeIdsMatch: true, twoClientConverged: true, undoRedo: true, offlineRestartReconnect: true, walOutboxReceipts: storeA.outbox.length === 0, pinnedNoteSynced: storeB.pinnedNote.body === "formal pinned note", ideasEnabledSynced: storeB.ideasEnabled === true, initialProfile: { pinnedNote: "", ideasEnabled: false, legacyPinnedNoteCandidates: 0 }, tombstonesPreserved: true };
controllerA.stop(); controllerB.stop();
const operation: SyncOperation = { opId: "rehearsal-client:1", deviceId: "rehearsal-client", localSeq: 1, targetNodeId: "rehearsal-v2-smoke", type: "create", baseRevision: 0, payload: { node: { id: "rehearsal-v2-smoke", type: "memo", memoType: "task", parentId: null, sortKey: "zz", title: "Rehearsal smoke", body: "", dueAt: null, duePreset: "none", status: "active", completedAt: null, createdAt: "2026-09-19T00:00:00.000Z", updatedAt: "2026-09-19T00:00:00.000Z", deletedAt: null } }, createdAt: "2026-09-19T00:00:00.000Z", status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null };
const acknowledgement = await adapter.upload(operation);
if (acknowledgement.result !== "applied") throw new Error("V2 smoke operation was not applied.");
const freezeMs = elapsed(freezeStarted);
const report = {
  schemaVersion: 1, rehearsalProject: PROJECT, sourceProject: source.projectId, sourceAccess: "read-only",
  productionProfileMigrationPolicy: userApprovedProfileNonMigration ? "USER-APPROVED DATA LOSS" : "PRESERVE_OR_STOP",
  status: sourceIssues.length ? "BLOCKED_SOURCE_VALIDATION" : "PASSED",
  diagnosticContinuationAfterStop: diagnosticContinuation,
  counts: { backup: source.documentCount, restored: restoredCount, migrated: plans.reduce((sum, item) => sum + item.plan.outputCount, 0) },
  equality: { documentIdsFieldsValuesNestedTombstonesUnknownFields: true, migrationSemanticChanges: plans.reduce((sum, item) => sum + item.plan.changedFields.length, 0), lostFields: plans.reduce((sum, item) => sum + item.plan.lostFieldCount, 0) },
  sourceIssues, oldClient: { readRejected: true, writeRejected: true, tombstoneResurrectionRejected: Boolean(purged) }, v2SmokeApplied: true,
  applicationIntegration,
  profileInventory: { status: profileInventory.profileStatus },
  legacyPinnedNoteRecovery: { candidateCount: profileInventory.candidateCount, status: profileInventory.candidateStatus },
  timingMs: { backup: backupMs, restore: restoreMs, restoreValidation: restoreValidationMs, migration: migrationMs, migrationValidation: migrationValidationMs, gate: gateMs, writeFreezeDiagnosticWindow: freezeMs, total: elapsed(started) },
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
await environment.cleanup();
if (sourceIssues.length) process.exitCode = 2;
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
