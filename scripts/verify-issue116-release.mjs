// Read-only release gate. Does not deploy or open the application.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const directory = process.argv[2] ?? 'dist';
const manifest = JSON.parse(readFileSync(join(directory, 'taskmemo-build-manifest.json')));
assert.equal(manifest.environment, 'production');
assert.equal(manifest.firebaseProjectId, 'taskmemoapp-eabc3');
assert.equal(manifest.recoveryObservationOnly, false, 'Startup cleanup is a write: never label this release observation-only');
assert.equal(manifest.redundantJournalPolicy, 'raw-equal-empty-outbox-cloud-verified-cas');
const hash = value => createHash('sha256').update(value).digest('hex');
assert.equal(hash(readFileSync(join(directory, 'service-worker.js'))), 'f822154bcce363cf7918ecece703715ea665ad88fecaad898db83332d9c339c0', 'Preserve deployed de5bd08 SW bytes; do not trigger an unreviewed SW activation');
const files = dir => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : [path]; }).filter(path => !path.endsWith('taskmemo-build-manifest.json')).sort();
const digest = createHash('sha256');
for (const path of files(directory)) digest.update(relative(directory, path).replaceAll('\\', '/')).update('\0').update(readFileSync(path));
assert.equal(manifest.canonicalArtifactSha256, digest.digest('hex'));
assert.equal(manifest.commit, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
const allowed = new Set([
  'docs/ISSUE116_ATOMIC_SAVE.md', 'docs/ISSUE116_RELEASE_VALIDATION.md',
  'scripts/build-production-v2-web.mjs', 'scripts/verify-issue116-release.mjs',
  'src/hooks/useTaskMemoSync.startup.test.tsx', 'src/hooks/useTaskMemoSync.ts',
  'src/sync/indexedDbApplicationStorage.test.ts', 'src/sync/indexedDbApplicationStorage.ts',
  'src/sync/issue116AtomicPersistence.test.ts', 'src/sync/issueRegressionApplication.test.ts',
  'src/sync/ownershipApplication.test.ts', 'src/sync/recoveryPreflight.ts',
  'src/sync/redundantJournalRecovery.ts', 'src/sync/routineRootApplication.test.ts',
  'src/sync/taskMemoApplicationStore.ts', 'src/sync/taskMemoV2SyncController.ts', 'src/sync/textEditApplication.test.ts',
]);
const changed = execFileSync('git', ['diff', '--name-only', 'de5bd087f7603831216b4d10a38a7fb41aa76b43', 'HEAD'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.ok(changed.every(path => allowed.has(path)), 'Release includes files outside the reviewed #116 allowlist');
console.log(JSON.stringify({ commit: manifest.commit, artifactSha256: manifest.canonicalArtifactSha256, changedFiles: changed.length, deployedServiceWorkerBytesPreserved: true, deployed: false }));
