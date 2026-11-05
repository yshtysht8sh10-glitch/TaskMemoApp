// Read-only seal verification. No Firebase credentials, network, deploy, or app launch.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';

const [artifactArg, baselineArg, configArg] = process.argv.slice(2);
assert.ok(artifactArg && baselineArg && configArg, 'artifact, baseline proof and Hosting-only config are required');
const artifact = resolve(artifactArg), baseline = JSON.parse(readFileSync(baselineArg));
const config = JSON.parse(readFileSync(configArg));
const baseCommit = '5890894948e77a9e6c4f3ad35abc2cf1c7aea3bf';
assert.equal(baseline.manifest.commit, baseCommit);
assert.deepEqual(Object.keys(config), ['hosting']);
assert.equal(config.hosting.site, 'taskmemoapp-eabc3');
assert.deepEqual(config.hosting.ignore, []);
assert.equal(resolve(dirname(resolve(configArg)), config.hosting.public), artifact);
const canonical = value => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const apiConfig = {
  headers: config.hosting.headers.map(row => ({ glob: row.source, headers: Object.fromEntries(row.headers.map(h => [h.key, h.value])) })),
  rewrites: config.hosting.rewrites.map(row => ({ glob: row.source, path: row.destination })),
  cleanUrls: config.hosting.cleanUrls,
};
assert.equal(canonical(apiConfig), canonical(baseline.config), 'Keep current live Hosting headers and rewrites');
const allowed = new Set([
  'docs/STARTUP_PERFORMANCE.md', 'docs/STARTUP_RELEASE_PREPARATION.md', 'scripts/verify-startup-release.mjs',
  'src/domain/deadlineView.ts', 'src/hooks/useTaskMemoSync.ts', 'src/hooks/useTaskMemoSync.startup.test.tsx',
  'src/hooks/useTaskMemoSync.webStartup.test.tsx', 'src/sync/firebaseEmulatorV2.e2e.test.ts',
  'src/sync/firebaseSyncAdapter.ts', 'src/sync/startupBatch.test.ts', 'src/sync/startupDiagnostics.test.ts',
  'src/sync/startupDiagnostics.ts', 'src/sync/startupListener.test.ts', 'src/sync/startupPresentation.test.ts',
  'src/sync/startupPresentation.ts', 'src/sync/taskMemoApplicationStore.ts', 'src/sync/taskMemoV2SyncController.ts', 'src/sync/types.ts',
]);
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert.equal(git(['status', '--porcelain']), '', 'Seal only a clean checkout');
const changedSource = git(['diff', '--name-only', baseCommit, 'HEAD']).split(/\r?\n/).filter(Boolean);
assert.ok(changedSource.every(path => allowed.has(path)), 'Unrelated DEV source change');
const files = directory => readdirSync(directory).flatMap(name => {
  const path = join(directory, name); return statSync(path).isDirectory() ? files(path) : [path];
}).sort();
const hash = data => createHash('sha256').update(data).digest('hex');
const paths = files(artifact), current = Object.fromEntries(paths.map(path => ['/' + relative(artifact, path).replaceAll('\\', '/'), hash(readFileSync(path))]));
const manifest = JSON.parse(readFileSync(join(artifact, 'taskmemo-build-manifest.json')));
assert.equal(manifest.commit, git(['rev-parse', 'HEAD']));
assert.equal(manifest.environment, 'production'); assert.equal(manifest.firebaseProjectId, 'taskmemoapp-eabc3');
assert.equal(manifest.recoveryObservationOnly, false);
assert.equal(manifest.redundantJournalPolicy, 'raw-equal-empty-outbox-cloud-verified-cas');
const digest = createHash('sha256');
for (const path of paths.filter(p => !p.endsWith('taskmemo-build-manifest.json')))
  digest.update(relative(artifact, path).replaceAll('\\', '/')).update('\0').update(readFileSync(path));
assert.equal(manifest.canonicalArtifactSha256, digest.digest('hex'));
const generated = new Set(['/index.html', '/+not-found.html', '/_sitemap.html', '/dev-ownership-bulk.html',
  '/storage-diagnostics.html', '/v2-recovery-backup.html', '/v2-cloud-recovery.html', '/taskmemo-build-manifest.json']);
for (const file of baseline.files) {
  assert.ok(existsSync(join(artifact, file.path.slice(1))), 'Do not remove previous file: ' + file.path);
  if (!generated.has(file.path)) assert.equal(current[file.path], file.sha256, 'Unrelated asset changed: ' + file.path);
}
const previous = new Set(baseline.files.map(f => f.path));
for (const path of Object.keys(current).filter(p => !previous.has(p)))
  assert.ok(/^\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js$/.test(path) || path.startsWith('/assets/'), 'Unexpected public file: ' + path);
assert.equal(current['/service-worker.js'], 'f822154bcce363cf7918ecece703715ea665ad88fecaad898db83332d9c339c0');
console.log(JSON.stringify({ commit: manifest.commit, baseCommit, canonicalArtifactSha256: manifest.canonicalArtifactSha256,
  fileCount: paths.length, changedSource, hostingOnly: true, liveHeadersPreserved: true, serviceWorkerUnchanged: true, deployed: false }));
