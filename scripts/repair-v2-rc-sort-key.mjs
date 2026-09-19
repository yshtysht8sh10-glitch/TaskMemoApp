import { readFileSync } from "node:fs";
import { createProvisionedSortKey } from "./lib/v2Provisioning.mjs";

const [credentialPath, confirmation] = process.argv.slice(2);
if (!credentialPath || confirmation !== "repair-dev-only:taskmemoapp-dev:system-routine")
  throw new Error("Exact dev-only repair confirmation is required.");
const envText = readFileSync(".env.local", "utf8");
const readEnv = name => new RegExp(`^\\s*${name}\\s*=\\s*[\"']?([^\"'\\r\\n]+)`, "m").exec(envText)?.[1]?.trim();
const projectId = readEnv("EXPO_PUBLIC_FIREBASE_PROJECT_ID");
const environment = readEnv("EXPO_PUBLIC_TASKMEMO_ENV");
const apiKey = readEnv("EXPO_PUBLIC_FIREBASE_API_KEY");
if (environment !== "development" || projectId !== "taskmemoapp-dev" || !apiKey)
  throw new Error("Repair is restricted to development/taskmemoapp-dev.");
const credentials = JSON.parse(readFileSync(credentialPath, "utf8"));
if (credentials.projectId !== projectId || !credentials.uid || !credentials.email || !credentials.password)
  throw new Error("Credential scope does not match taskmemoapp-dev.");

const auth = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: credentials.email, password: credentials.password, returnSecureToken: true }),
});
if (!auth.ok) throw new Error(`Dev Auth failed: ${auth.status}`);
const session = await auth.json();
if (session.localId !== credentials.uid) throw new Error("Authenticated UID does not match the RC credential.");
const documentUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${credentials.uid}/nodesV2/system-routine`;
const headers = { Authorization: `Bearer ${session.idToken}`, "Content-Type": "application/json" };
const beforeResponse = await fetch(documentUrl, { headers });
if (!beforeResponse.ok) throw new Error(`Dev Firestore read failed: ${beforeResponse.status}`);
const document = await beforeResponse.json();
const fields = document.fields;
if (fields?.ownerUid?.stringValue !== credentials.uid || fields?.schemaVersion?.integerValue !== "2")
  throw new Error("Unexpected RC document ownership/schema.");
const record = fields.record?.mapValue?.fields;
const value = record?.value?.mapValue?.fields;
if (value?.id?.stringValue !== "system-routine") throw new Error("Unexpected RC node identity.");
const beforeSortKey = value.sortKey?.stringValue;
const replacement = createProvisionedSortKey();
if (beforeSortKey !== replacement) {
  if (beforeSortKey !== "zzzz") throw new Error(`Refusing to repair unexpected sortKey: ${String(beforeSortKey)}`);
  value.sortKey = { stringValue: replacement };
  record.revision = { integerValue: String(Number(record.revision?.integerValue ?? 0) + 1) };
  record.lastOpId = { stringValue: "repair:v2-rc-20260919:system-routine-sort-key" };
  record.lastDeviceId = { stringValue: "repair:v2-rc-20260919" };
  record.lastLocalSeq = { integerValue: "0" };
  record.operationType = { stringValue: "update" };
  fields.serverUpdatedAt = { timestampValue: new Date().toISOString() };
  const write = await fetch(documentUrl, { method: "PATCH", headers, body: JSON.stringify({ fields }) });
  if (!write.ok) throw new Error(`Dev Firestore repair failed: ${write.status} ${await write.text()}`);
}
const verifyResponse = await fetch(documentUrl, { headers });
if (!verifyResponse.ok) throw new Error(`Dev Firestore verification failed: ${verifyResponse.status}`);
const verified = await verifyResponse.json();
const verifiedRecord = verified.fields?.record?.mapValue?.fields;
const afterSortKey = verifiedRecord?.value?.mapValue?.fields?.sortKey?.stringValue;
if (afterSortKey !== replacement) throw new Error("Dev Firestore repair verification failed.");
console.log(JSON.stringify({ projectId, uid: credentials.uid, nodeId: "system-routine", beforeSortKey, afterSortKey, revision: verifiedRecord.revision?.integerValue, productionTouched: false }));
