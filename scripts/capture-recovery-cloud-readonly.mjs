// Read-only Firestore export for the same account encoded in a local recovery bundle.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { decodeFirestoreFields } from './lib/readOnlyFirestoreSnapshot.mjs';

const [source, destination] = process.argv.slice(2);
const cliRoot = process.env.TASKMEMO_FIREBASE_TOOLS_LIB;
if (!source || !destination || !cliRoot) throw new Error('Usage: TASKMEMO_FIREBASE_TOOLS_LIB=<firebase-tools/lib> node scripts/capture-recovery-cloud-readonly.mjs <bundle> <new-output>');
const archive = JSON.parse(readFileSync(source, 'utf8'));
if (archive.origin !== 'https://taskmemoapp-eabc3.web.app') throw new Error('Unexpected origin');
const scopes = [...new Set(archive.indexedDb.records.map(record => record.scope))];
if (scopes.length !== 1 || !scopes[0].startsWith('taskmemoapp-eabc3/')) throw new Error('Account scope unavailable or ambiguous');
const uid = scopes[0].slice('taskmemoapp-eabc3/'.length);
if (!uid) throw new Error('UID unavailable');
const require = createRequire(import.meta.url);
const auth = require(`${cliRoot}/auth.js`);
const oauthScopes = require(`${cliRoot}/scopes.js`);
const account = auth.getGlobalDefaultAccount();
const token = await auth.getAccessToken(account?.tokens?.refresh_token, [oauthScopes.CLOUD_PLATFORM]);
const base = `https://firestore.googleapis.com/v1/projects/taskmemoapp-eabc3/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
const readCollection = async name => {
  const documents = [];
  let pageToken;
  do {
    const url = new URL(`${base}/${name}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!response.ok) throw new Error(`Cloud ${name} read failed: HTTP ${response.status}`);
    const page = await response.json();
    documents.push(...(page.documents ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return documents;
};
const [nodes, profile, syncMetadata] = await Promise.all([
  readCollection('nodesV2'), readCollection('profileV2'), readCollection('syncMetadataV2'),
]);
const payload = { format: 'taskmemo-recovery-cloud-v2', capturedAt: new Date().toISOString(),
  project: 'taskmemoapp-eabc3', scope: scopes[0], nodes, profile, syncMetadata };
const json = JSON.stringify(payload, null, 2);
writeFileSync(destination, json, { flag: 'wx' });
const decoded = nodes.map(document => decodeFirestoreFields(document.fields ?? {}));
console.log(JSON.stringify({ output: destination, nodeCount: nodes.length,
  idSetHash: createHash('sha256').update(JSON.stringify(decoded.map(node => node.value?.id ?? node.id).sort())).digest('hex'),
  sha256: createHash('sha256').update(json).digest('hex') }));
