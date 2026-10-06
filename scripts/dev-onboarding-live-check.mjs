import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { request } from './dev-onboarding-admin.mjs';
const project = 'taskmemoapp-dev';
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const credentials = JSON.parse(readFileSync('artifacts/private/dev-onboarding/test-account.json', 'utf8'));
const users = await request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet?maxResults=1000`);
const user = users.users?.find(u => u.email === credentials.email);
if (!user) throw new Error('Exact verification account not found');
const uid = user.localId;
const gate = await request(`${base}/users/${uid}/syncMetadataV2/compatibility`);
const receipt = await request(`${base}/accountProvisioningV2/${uid}`);
const lifecycle = await request(`${base}/accountLifecycleV2/${uid}`);
const nodes = await request(`${base}/users/${uid}/nodesV2?pageSize=1000`);
const operations = await request(`${base}/users/${uid}/syncOperationsV2?pageSize=1000`);
if (gate.fields.v2Enabled?.booleanValue !== true || gate.fields.v1WritesAllowed?.booleanValue !== false ||
    receipt.fields.uid?.stringValue !== uid || receipt.fields.projectId?.stringValue !== project ||
    lifecycle.fields.state?.stringValue !== 'onboarded' || !nodes.documents?.some(d => d.fields.record?.mapValue?.fields.value?.mapValue?.fields.title?.stringValue === '#85 DEV onboarding 匿名取り込み検証'))
  throw new Error('Live onboarding evidence incomplete');
const env = readFileSync('.env.local', 'utf8');
if (!env.includes('taskmemoapp-dev')) throw new Error('DEV env required');
const apiKey = env.match(/^EXPO_PUBLIC_FIREBASE_API_KEY\s*=\s*["']?([^"'\r\n]+)/m)?.[1];
const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials, returnSecureToken: true }) });
const auth = await authResponse.json();
if (!authResponse.ok || auth.localId !== uid) throw new Error('DEV test identity mismatch');
const headers = { Authorization: `Bearer ${auth.idToken}`, 'Content-Type': 'application/json' };
const forbidden = await fetch(`${base}/users/${uid}/syncMetadataV2/compatibility`, { method: 'PATCH', headers, body: JSON.stringify({ fields: gate.fields }) });
const receiptRead = await fetch(`${base}/accountProvisioningV2/${uid}`, { headers });
const missingAppCheck = await fetch('https://asia-northeast1-taskmemoapp-dev.cloudfunctions.net/ensureAccountV2Ready', {
  method: 'POST', headers, body: JSON.stringify({ data: { schemaVersion: 1, protocol: 2 } }) });
if (forbidden.status !== 403 || receiptRead.status !== 403 || missingAppCheck.status !== 401) throw new Error('Live protection check failed');
const readback = await request(`${base}/users/${uid}/syncMetadataV2/compatibility`);
if (!isDeepStrictEqual(gate, readback)) throw new Error('Gate changed');
const result = { project, uid, gate, receipt, lifecycle, nodes, operations,
  checks: { clientGateWriteDenied: true, clientReceiptReadDenied: true, missingAppCheckDenied: true },
  nodesHash: createHash('sha256').update(JSON.stringify(nodes)).digest('hex') };
writeFileSync('artifacts/private/dev-onboarding/live-result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ project, gateAndReceiptCreated: true, importedNodes: nodes.documents.length,
  operationReceipts: operations.documents?.length ?? 0, ...result.checks }));
