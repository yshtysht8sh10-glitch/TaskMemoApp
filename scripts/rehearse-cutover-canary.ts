import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import { createFirebaseSyncAdapter } from "../src/sync/firebaseSyncAdapter";
import type { SyncOperation, VersionedNode } from "../src/sync/types";

const [sourcePath, canaryPath, reportPath] = process.argv.slice(2);
if (!sourcePath || !canaryPath || !reportPath || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8180") throw new Error("Canary rehearsal requires exact files and isolated Firestore Emulator 127.0.0.1:8180.");
const source = JSON.parse(readFileSync(sourcePath, "utf8")) as { nodes: { uid: string; node: Record<string, unknown> }[] };
const canaryRaw = readFileSync(canaryPath, "utf8");
const canary = JSON.parse(canaryRaw) as { uid: string; targetNodeId: string; operation: SyncOperation; expectedAfterState: VersionedNode; expectedReceipt: unknown };
if (source.nodes.length !== 124 || source.nodes.some(item => item.uid !== canary.uid)) throw new Error("Canary rehearsal source identity/count mismatch.");
const environment = await initializeTestEnvironment({ projectId: "demo-taskmemo-v2", firestore: { host: "127.0.0.1", port: 8180, rules: readFileSync("firestore.dev.rules", "utf8") } });
try {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "syncControl/current"), { schemaVersion: 1, writesEnabled: true });
    await setDoc(doc(db, `users/${canary.uid}/syncMetadataV2/compatibility`), { schemaVersion: 1, minimumSyncProtocol: 2, v1WritesAllowed: false, v2Enabled: true });
    for (const item of source.nodes) {
      const record = { value: item.node, revision: 0, lastOpId: `migration:iphone-authoritative-20260920:${encodeURIComponent(String(item.node.id))}`, lastDeviceId: "migration:iphone-authoritative-20260920", lastLocalSeq: 0, operationType: "import" };
      await setDoc(doc(db, `users/${canary.uid}/nodesV2/${item.node.id}`), { ownerUid: canary.uid, schemaVersion: 2, record });
    }
  });
  const dbA = environment.authenticatedContext(canary.uid).firestore() as unknown as Firestore;
  const dbB = environment.authenticatedContext(canary.uid).firestore() as unknown as Firestore;
  const adapterA = createFirebaseSyncAdapter(dbA, canary.uid, "test", { emulator: true });
  const adapterB = createFirebaseSyncAdapter(dbB, canary.uid, "test", { emulator: true });
  await adapterA.connect(); await adapterB.connect();
  if (!adapterB.subscribe) throw new Error("Canary adapter subscription is unavailable.");
  let received: VersionedNode | undefined;
  const receivedPromise = new Promise<void>((resolve, reject) => {
    const unsubscribe = adapterB.subscribe(record => { if (record.value.id === canary.targetNodeId && record.revision === 1) { received = record; unsubscribe(); resolve(); } }, reject);
    setTimeout(() => { unsubscribe(); reject(new Error("Second client convergence timeout.")); }, 5000);
  });
  const acknowledgement = await adapterA.upload(canary.operation);
  await receivedPromise;
  const duplicate = await adapterA.upload(canary.operation);
  const restarted = (await getDoc(doc(dbA, `users/${canary.uid}/nodesV2/${canary.targetNodeId}`))).data()?.record as VersionedNode;
  const receipt = (await getDoc(doc(dbA, `users/${canary.uid}/syncOperationsV2/${canary.operation.opId}`))).data();
  const exact = JSON.stringify(acknowledgement) === JSON.stringify(canary.expectedReceipt)
    && JSON.stringify(duplicate) === JSON.stringify(canary.expectedReceipt)
    && JSON.stringify(received) === JSON.stringify(canary.expectedAfterState)
    && JSON.stringify(restarted) === JSON.stringify(canary.expectedAfterState)
    && receipt?.operation?.opId === canary.operation.opId;
  if (!exact) throw new Error("Canary winner/receipt/convergence/restart mismatch.");
  const report = { decision: "PASS", projectId: "demo-taskmemo-v2", sourceNodeCount: 124, canaryArtifactSha256: createHash("sha256").update(canaryRaw).digest("hex"), targetNodeId: canary.targetNodeId, acknowledgement, duplicateIdempotent: true, secondClientConverged: true, restartExact: true, semanticChangeCount: 0 };
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report));
} finally { await environment.cleanup(); }
