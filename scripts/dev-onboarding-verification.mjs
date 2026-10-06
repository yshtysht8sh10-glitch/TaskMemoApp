// DEV-only readback and create-only activation. Credentials and user records stay gitignored.
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { request } from './dev-onboarding-admin.mjs';
const project = 'taskmemoapp-dev';
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const file = 'artifacts/private/dev-onboarding/existing-users.json';
const mode = process.argv[3];
async function snapshot(uids) {
  const result = {};
  for (const uid of uids) {
    result[uid] = {};
    for (const collection of ['nodes', 'nodesV2', 'profileV2', 'syncOperationsV2', 'syncMetadataV2']) {
      const value = await request(`${base}/users/${uid}/${collection}?pageSize=1000`);
      if (value.nextPageToken) throw new Error('Inventory pagination required; stop');
      result[uid][collection] = value.documents ?? [];
    }
  }
  return result;
}
if (mode === 'baseline') {
  const accounts = await request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet?maxResults=1000`);
  if (accounts.nextPageToken) throw new Error('Auth pagination required; stop');
  const values = await snapshot((accounts.users ?? []).map(u => u.localId));
  writeFileSync(file, JSON.stringify(values, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ project, existingAccounts: Object.keys(values).length, baselineSaved: true }));
} else if (mode === 'policy') {
  const now = new Date().toISOString();
  const fields = { schemaVersion: { integerValue: '1' }, enabled: { booleanValue: true }, protocol: { integerValue: '2' },
    policyVersion: { stringValue: 'dev-onboarding-20261004' }, eligibleCreatedAfter: { timestampValue: now }, writerFenceVersion: { integerValue: '1' } };
  const value = await request(`${base}:commit`, 'POST', { writes: [{ update: { name: `${base.replace('https://firestore.googleapis.com/v1/', '')}/syncControl/onboarding`, fields }, currentDocument: { exists: false } }] });
  writeFileSync('artifacts/private/dev-onboarding/policy.json', JSON.stringify({ project, eligibleCreatedAfter: now, fields, result: value }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ project, eligibleCreatedAfter: now, createdOnly: true }));
} else if (mode === 'verify-existing') {
  const previous = JSON.parse(readFileSync(file, 'utf8'));
  const current = await snapshot(Object.keys(previous));
  if (!isDeepStrictEqual(previous, current)) throw new Error('Existing DEV account data changed; investigate');
  const original = JSON.parse(readFileSync('artifacts/private/dev-onboarding/preflight.json', 'utf8'));
  const global = await request(`${base}/syncControl/current`);
  if (!isDeepStrictEqual(global, original.global)) throw new Error('Global control changed');
  console.log(JSON.stringify({ project, existingAccountsUnchanged: Object.keys(previous).length, globalUnchanged: true }));
}
