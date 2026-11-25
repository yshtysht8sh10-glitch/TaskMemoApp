// Offline preparation only. No Firebase SDK, credentials, network or cloud commands.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const BASE = 'c8a7fb858aebb34fd07ef1f8c2bfbd87b805d6c1';
const ancestors = ['007b2df750e6d9ed831a755a23e3ac279383f0cd', '74aad5f9731056aee01a1063f77f47c58f80ae99'];
const protectedProjects = new Set(['taskmemoapp-dev', 'taskmemoapp-eabc3']);
export function validatePlan(plan) {
  if (!plan || plan.productBaseSha !== BASE || plan.status !== 'proposal-only' || plan.ownerApproved !== false)
    throw Error('Only an unapproved fixed-base preparation plan is supported');
  if (JSON.stringify(plan.requiredAncestors) !== JSON.stringify(ancestors)) throw Error('Fixed ancestor list required');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(plan.projectId) || protectedProjects.has(plan.projectId) || plan.projectId.startsWith('demo-'))
    throw Error('Dedicated new project ID required');
  if (plan.hostingSite !== plan.projectId || plan.firestoreDatabase !== '(default)' || plan.firestoreLocation !== 'asia-northeast1')
    throw Error('Project/site/database/location mismatch');
  if (plan.billingPlan !== 'Spark' || plan.linkBillingAccount !== false || plan.deployFunctions !== false || plan.enableStorage !== false || plan.enableAnalytics !== false)
    throw Error('Paid services and additional deployment are outside this plan');
  if (plan.authProvider !== 'password' || plan.staticAssetsPublic !== true || plan.dataAccess !== 'explicit-tester-uid-and-owner-only')
    throw Error('Access policy requires review');
  if (!Array.isArray(plan.testerUids) || plan.testerUids.length > 2 || new Set(plan.testerUids).size !== plan.testerUids.length ||
    plan.testerUids.some(uid => !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) throw Error('Invalid tester UID list');
  return plan;
}
export function candidateFiles(plan, originalRules) {
  validatePlan(plan);
  const ownerLine = 'return request.auth != null && request.auth.uid == userId;';
  const globalLine = 'allow read: if request.auth != null;';
  if (originalRules.split(ownerLine).length !== 2 || originalRules.split(globalLine).length !== 2)
    throw Error('Fixed source Rules anchors changed');
  const helper = `function isolatedTester() {\n      return request.auth != null && request.auth.uid in ${JSON.stringify(plan.testerUids)}\n        && request.auth.token.firebase.sign_in_provider == 'password';\n    }\n\n    function ownsUser(userId) {`;
  const rules = originalRules.replace('function ownsUser(userId) {', helper)
    .replace(ownerLine, 'return isolatedTester() && request.auth.uid == userId;')
    .replace(globalLine, 'allow read: if isolatedTester();');
  const hosting = { site: plan.hostingSite, public: 'dist', ignore: ['**/.*', '**/node_modules/**'], cleanUrls: true,
    headers: [{ source: '**', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }],
    rewrites: [{ source: '**', destination: '/index.html' }] };
  return {
    'firebase.isolated.json': JSON.stringify({ hosting, firestore: { rules: 'firestore.isolated.rules' } }, null, 2) + '\n',
    'firestore.isolated.rules': rules,
    'firestore.closed.rules': "rules_version = '2';\nservice cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }\n",
    '.env.isolated.example': `# Not a usable build configuration until runtime guard support is approved.\n# No Storage resource is required. The existing export checker also needs separate review.\nEXPO_PUBLIC_TASKMEMO_ENV=development\nEXPO_PUBLIC_FIREBASE_PROJECT_ID=${plan.projectId}\nEXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=${plan.projectId}.firebaseapp.com\nEXPO_PUBLIC_FIREBASE_API_KEY=PENDING_NEW_PROJECT_PUBLIC_CONFIG\nEXPO_PUBLIC_FIREBASE_APP_ID=PENDING_NEW_PROJECT_APP_ID\nEXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=PENDING_NEW_PROJECT_NUMBER\nEXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=PENDING_PUBLIC_CONFIG_OR_REVIEWED_OPTIONAL_FIELD\n`,
    'bootstrap-spec.json': JSON.stringify({ projectId: plan.projectId, adminOnly: true, execute: false,
      global: { path: 'syncControl/current', value: { schemaVersion: 1, writesEnabled: true } },
      accounts: plan.testerUids.map(uid => ({ path: `users/${uid}/syncMetadataV2/compatibility`, value: { schemaVersion: 1, minimumSyncProtocol: 2, v1WritesAllowed: false, v2Enabled: true } })) }, null, 2) + '\n',
    'fixture-spec.json': JSON.stringify({ syntheticOnly: true, sourceProjectImportsAllowed: false, sessionDate: plan.sessionDate,
      states: ['completed', 'skipped', 'pending'], missedEnabled: false, cases: [0, 1, 7, 8, 50, 51, 125, 5000],
      identity: 'stable-definition-id + original-date', sameUidAcrossTwoTestDevices: true,
      forbidden: ['production-backup', 'shared-dev-backup', 'real-user-title', 'real-user-history', 'queue', 'missed'] }, null, 2) + '\n',
  };
}

const ownPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === ownPath) {
  const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const plan = validatePlan(JSON.parse(readFileSync(join(root, 'ops/isolated-routine-dev/plan.json'), 'utf8')));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  for (const sha of plan.requiredAncestors) git('merge-base', '--is-ancestor', sha, BASE);
  if (git('diff', '--name-only', BASE, '--', 'src', 'functions', 'firestore.rules', 'scripts/verify-firebase-environment.js'))
    throw Error('Product source must stay fixed');
  const originalRules = git('show', `${BASE}:firestore.rules`);
  const files = candidateFiles(plan, originalRules);
  const hashes = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, createHash('sha256').update(content).digest('hex')]));
  if (process.argv[2] === '--render') {
    if (!process.argv[3]) throw Error('New local output directory required');
    const output = resolve(process.argv[3]);
    mkdirSync(output, { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(output, name), content, { flag: 'wx' });
  } else if (process.argv[2] !== '--check') throw Error('Use --check or --render <new-local-directory>');
  console.log(JSON.stringify({ phase: 'OFFLINE_PREPARATION', sourceSha: BASE, ancestryVerified: true, productChanged: false,
    candidateProject: plan.projectId, candidateUrl: `https://${plan.hostingSite}.web.app`, sourceRulesHash: createHash('sha256').update(originalRules).digest('hex'), hashes,
    deploymentReady: false, blockers: ['Owner approval absent', 'project/global URL availability unverified', 'runtime and build guards reject new project', 'tester UIDs unassigned', 'resources and real Rules/Auth tests not provisioned'] }, null, 2));
}
