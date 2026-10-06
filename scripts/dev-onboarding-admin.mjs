import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const project = 'taskmemoapp-dev';
const root = process.env.TASKMEMO_FIREBASE_TOOLS_LIB;
if (!root || process.argv[2] !== project) throw new Error('Exact DEV project and CLI library required');
const require = createRequire(import.meta.url), auth = require(`${root}/auth.js`), scopes = require(`${root}/scopes.js`);
const account = auth.getGlobalDefaultAccount();
const token = await auth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM]);
export async function request(url, method = 'GET', body) {
  const devLogRead = url === 'https://logging.googleapis.com/v2/entries:list' && method === 'POST'
    && body?.resourceNames?.length === 1 && body.resourceNames[0] === `projects/${project}`;
  if (!url.includes(project) && !url.includes('1045397314197') && !devLogRead) throw new Error('DEV URL guard');
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${url}: HTTP ${response.status} ${JSON.stringify(value)}`);
  return value;
}
const mode = process.argv[3];
if (mode === 'preflight') {
  const billing = await request(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`);
  if (!billing.billingEnabled) throw new Error('Billing not enabled');
  const snapshot = { project: await request(`https://firebase.googleapis.com/v1beta1/projects/${project}`), billingEnabled: true,
    iam: await request(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`, 'POST'),
    rules: await request(`https://firebaserules.googleapis.com/v1/projects/${project}/releases`),
    global: await request(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/syncControl/current`) };
  for (const release of snapshot.rules.releases ?? []) release.backup = await request(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  mkdirSync('artifacts/private/dev-onboarding', { recursive: true });
  writeFileSync('artifacts/private/dev-onboarding/preflight.json', JSON.stringify(snapshot, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ projectId: snapshot.project.projectId, billingEnabled: true, backupsSaved: true }));
} else if (mode === 'enable') {
  const result = await request(`https://serviceusage.googleapis.com/v1/projects/${project}/services:batchEnable`, 'POST',
    { serviceIds: ['cloudfunctions.googleapis.com', 'cloudbuild.googleapis.com', 'artifactregistry.googleapis.com', 'run.googleapis.com',
      'eventarc.googleapis.com', 'firebaseappcheck.googleapis.com', 'recaptchaenterprise.googleapis.com', 'iam.googleapis.com'] });
  console.log(JSON.stringify(result));
} else if (mode === 'iam') {
  const email = `taskmemo-onboarding@${project}.iam.gserviceaccount.com`;
  let sa;
  try { sa = await request(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${email}`); }
  catch (error) { if (!String(error).includes('HTTP 404')) throw error;
    sa = await request(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`, 'POST', { accountId: 'taskmemo-onboarding', serviceAccount: { displayName: 'TaskMemo DEV onboarding only' } }); }
  const policy = await request(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`, 'POST');
  for (const role of ['roles/datastore.user', 'roles/firebaseauth.viewer']) {
    let binding = policy.bindings.find(b => b.role === role && !b.condition);
    if (!binding) { binding = { role, members: [] }; policy.bindings.push(binding); }
    if (!binding.members.includes(`serviceAccount:${email}`)) binding.members.push(`serviceAccount:${email}`);
  }
  await request(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:setIamPolicy`, 'POST', { policy });
  console.log(JSON.stringify({ project, serviceAccount: sa.email, roles: ['roles/datastore.user', 'roles/firebaseauth.viewer'] }));
} else if (mode === 'appcheck') {
  const keys = await request(`https://recaptchaenterprise.googleapis.com/v1/projects/${project}/keys`);
  let key = (keys.keys ?? []).find(k => k.displayName === 'TaskMemo DEV onboarding Web');
  if (!key) key = await request(`https://recaptchaenterprise.googleapis.com/v1/projects/${project}/keys`, 'POST',
    { displayName: 'TaskMemo DEV onboarding Web', webSettings: { allowedDomains: ['taskmemoapp-dev.web.app', 'taskmemoapp-dev.firebaseapp.com'], integrationType: 'SCORE', allowAllDomains: false } });
  const app = 'projects/1045397314197/apps/1:1045397314197:web:4306f8798dde332d7c599c';
  const config = await request(`https://firebaseappcheck.googleapis.com/v1/${app}/recaptchaEnterpriseConfig?updateMask=siteKey,tokenTtl`, 'PATCH',
    { name: `${app}/recaptchaEnterpriseConfig`, siteKey: key.name.split('/').at(-1), tokenTtl: '3600s' });
  writeFileSync('artifacts/private/dev-onboarding/appcheck.json', JSON.stringify({ key, config }, null, 2));
  console.log(JSON.stringify({ project, siteKey: config.siteKey, allowedDomains: key.webSettings.allowedDomains }));
}
