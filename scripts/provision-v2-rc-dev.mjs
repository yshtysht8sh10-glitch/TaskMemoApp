import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [credentialOutput, confirmation] = process.argv.slice(2);
if (!credentialOutput || confirmation !== "write-dev-only:taskmemoapp-dev") throw new Error("Exact dev-only confirmation is required.");
const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
if (!token) throw new Error("GOOGLE_OAUTH_ACCESS_TOKEN is required and is never stored.");
const envText = readFileSync(".env.local", "utf8");
const readEnv = name => new RegExp(`^\\s*${name}\\s*=\\s*[\"']?([^\"'\\r\\n]+)`, "m").exec(envText)?.[1]?.trim();
if (readEnv("EXPO_PUBLIC_TASKMEMO_ENV") !== "development" || readEnv("EXPO_PUBLIC_FIREBASE_PROJECT_ID") !== "taskmemoapp-dev") throw new Error("RC provisioning is restricted to taskmemoapp-dev.");
const apiKey = readEnv("EXPO_PUBLIC_FIREBASE_API_KEY");
if (!apiKey) throw new Error("Missing dev Firebase API key.");
const suffix = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const email = `taskmemo-v2-rc-${suffix}@example.test`;
const password = `RC-${randomBytes(15).toString("base64url")}!`;
const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
if (!authResponse.ok) throw new Error(`Dev Auth account creation failed: ${authResponse.status}`);
const account = await authResponse.json();
mkdirSync(dirname(credentialOutput), { recursive: true });
writeFileSync(credentialOutput, JSON.stringify({ projectId: "taskmemoapp-dev", releaseChannel: "v2-rc-20260919", email, password, uid: account.localId }, null, 2), { flag: "wx" });

const base = "https://firestore.googleapis.com/v1/projects/taskmemoapp-dev/databases/(default)/documents";
const integerValue = value => ({ integerValue: String(value) });
const stringValue = value => ({ stringValue: value });
const mapValue = fields => ({ mapValue: { fields } });
const patch = async (path, fields) => {
  const response = await fetch(`${base}/${path}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
  if (!response.ok) throw new Error(`Dev Firestore provisioning failed for ${path}: ${response.status} ${await response.text()}`);
};
await patch("syncControl/current", { schemaVersion: integerValue(1), writesEnabled: { booleanValue: true } });
await patch(`users/${account.localId}/syncMetadataV2/compatibility`, { schemaVersion: integerValue(1), minimumSyncProtocol: integerValue(2), v1WritesAllowed: { booleanValue: false }, v2Enabled: { booleanValue: true } });
const initialAt = "2026-09-19T00:00:00.000Z";
const value = { id: stringValue("system-routine"), type: stringValue("category"), categoryKind: stringValue("routineRoot"), parentId: { nullValue: null }, sortKey: stringValue("zzzz"), title: stringValue("ルーティーン"), createdAt: stringValue(initialAt), updatedAt: stringValue(initialAt), deletedAt: { nullValue: null } };
const record = { value: mapValue(value), revision: integerValue(0), lastOpId: stringValue("migration:v2-rc-20260919:system-routine"), lastDeviceId: stringValue("migration:v2-rc-20260919"), lastLocalSeq: integerValue(0), operationType: stringValue("import") };
await patch(`users/${account.localId}/nodesV2/system-routine`, { ownerUid: stringValue(account.localId), schemaVersion: integerValue(2), record: mapValue(record), serverUpdatedAt: { timestampValue: new Date().toISOString() } });
console.log(JSON.stringify({ projectId: "taskmemoapp-dev", uid: account.localId, credentialOutput, productionTouched: false }));
