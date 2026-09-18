// Creates a disposable emulator account and markers. No real Firebase endpoint.
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { ensureRoutineCategories } from "../src/domain/nodeOperations";
import { planV1ToV2Migration } from "../src/sync/migrationDryRun";

async function main() {
  const response = await fetch("http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "v2-ui@example.test", password: "emulator-only-password", returnSecureToken: true }),
  });
  let account = await response.json();
  if (!response.ok && account.error?.message === "EMAIL_EXISTS") {
    account = await (await fetch("http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "v2-ui@example.test", password: "emulator-only-password", returnSecureToken: true }),
    })).json();
  }
  if (!account.localId) throw new Error("Emulator account provisioning failed");
  const environment = await initializeTestEnvironment({ projectId: "demo-taskmemo-v2", firestore: { host: "127.0.0.1", port: 8180 } });
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "syncControl/current"), { schemaVersion: 1, writesEnabled: true });
    await setDoc(doc(db, `users/${account.localId}/syncMetadataV2/compatibility`), { schemaVersion: 1, minimumSyncProtocol: 2, v1WritesAllowed: false, v2Enabled: true });
    for (const record of planV1ToV2Migration(ensureRoutineCategories([], new Date(0)), "emulator-ui").records)
      await setDoc(doc(db, `users/${account.localId}/nodesV2/${record.value.id}`), { ownerUid: account.localId, schemaVersion: 2, record });
  });
  await environment.cleanup();
  console.log(`Emulator-only account ready: v2-ui@example.test; uid=${account.localId}`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
