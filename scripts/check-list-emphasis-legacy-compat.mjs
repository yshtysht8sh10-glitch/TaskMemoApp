// Issue #120 safety gate. A red result blocks adding a persisted emphasis field.
// Hypothetical payloads only: no feature implementation, Firebase, or user storage.
// Run: npx tsx scripts/check-list-emphasis-legacy-compat.mjs [report.json]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const currentSha = '0c4ac60ef97ea8a80fca62fcaaf445d2c91143b1';
const legacySha = 'de5bd087f7603831216b4d10a38a7fb41aa76b43';
// The relevant ordinary-Node reducer is byte-identical in these commits. Use the
// published equivalent so a fresh reviewer clone does not need unpublished HEADs.
const currentModelSha = legacySha;
const expectedModelBlob = 'dd57f764960e9518b80e77d3d2e9c2ad11e1af53';
assert.equal(execFileSync('git', ['rev-parse', currentModelSha + ':src/sync/revisionModel.ts'], { cwd: repository, encoding: 'utf8' }).trim(), expectedModelBlob);
const fixture = mkdtempSync(join(tmpdir(), 'taskmemo-emphasis-compat-'));
async function model(sha, name) {
  const folder = join(fixture, name);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(folder);
  const archive = join(folder, 'sources.tar');
  execFileSync('git', ['archive', '--format=tar', '--output', archive, sha, 'src'], { cwd: repository });
  execFileSync('tar', ['-xf', archive, '-C', folder]);
  symlinkSync(join(repository, 'node_modules'), join(folder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const module = await import(pathToFileURL(join(folder, 'src/sync/revisionModel.ts')).href);
  return (module.default ?? module).applyRevisionOperation;
}
const currentApply = await model(currentModelSha, 'production-equivalent-model');
const legacyApply = await model(legacySha, 'legacy');
const date = '2026-11-08T00:00:00.000Z';
const base = { id: 'synthetic-normal-task', type: 'memo', memoType: 'task', parentId: null,
  sortKey: 'a0', title: 'Synthetic compatibility task', body: 'keep body', status: 'active',
  completedAt: null, deletedAt: null, dueAt: null, duePreset: 'none', createdAt: date, updatedAt: date };
const record = value => ({ value, revision: 1, lastOpId: 'seed', lastDeviceId: 'seed', lastLocalSeq: 1, operationType: 'create' });
const operation = (opId, value, baseRevision = 1, type = 'update') => ({ opId, deviceId: opId, localSeq: 1,
  targetNodeId: base.id, type, baseRevision, payload: { node: value }, createdAt: date,
  status: 'pending', attemptCount: 0, nextRetryAt: null, lastError: null });
const complete = () => operation('a-legacy-complete', { ...base, status: 'completed', completedAt: date }, 1, 'complete');
const emphasize = () => operation('z-emphasis', { ...base, listEmphasized: true });
const checks = [];
function check(name, action) {
  try { action(); checks.push({ name, pass: true }); console.log('PASS', name); }
  catch (error) { checks.push({ name, pass: false, error: error.message }); console.error('FAIL', name, error.message); }
}
check('sequential legacy edit retains an already-observed unknown emphasis field', () => {
  const starred = currentApply(record(base), emphasize()).record;
  const result = legacyApply(starred, operation('legacy-observed', { ...starred.value, status: 'completed', completedAt: date }, starred.revision, 'complete'));
  assert.equal(result.record.value.listEmphasized, true);
  assert.equal(result.record.value.status, 'completed');
  assert.equal(result.record.value.body, base.body);
});
check('a stale legacy payload cannot erase a persisted emphasis', () => {
  const starred = currentApply(record(base), operation('a-emphasis', { ...base, listEmphasized: true })).record;
  const result = legacyApply(starred, operation('z-legacy-edit', { ...base, body: 'legacy body edit' }));
  assert.equal(result.record.value.listEmphasized, true);
});
for (const oldFirst of [true, false]) check(`emphasis never cancels concurrent completion, oldFirst=${oldFirst}`, () => {
  const first = oldFirst ? legacyApply(record(base), complete()) : currentApply(record(base), emphasize());
  const last = oldFirst ? currentApply(first.record, emphasize()) : legacyApply(first.record, complete());
  assert.equal(last.record.value.status, 'completed');
  assert.equal(last.record.value.completedAt, date);
  assert.equal(last.record.value.listEmphasized, true);
});
check('stale legacy content cannot resurrect emphasis after explicit OFF', () => {
  const initial = record({ ...base, listEmphasized: true });
  const off = currentApply(initial, operation('a-emphasis-off', { ...initial.value, listEmphasized: false })).record;
  const result = legacyApply(off, operation('z-legacy-stale', { ...initial.value, body: 'another legacy edit' }));
  assert.equal(result.record.value.listEmphasized, false);
});
// Control: disjoint full-node writes already have this problem without a new field.
const oldCompleted = legacyApply(record(base), complete());
const control = currentApply(oldCompleted.record, operation('z-existing-body-edit', { ...base, body: 'existing ordinary edit' }));
const output = { status: checks.every(c => c.pass) ? 'safe-at-this-model-boundary' : 'BLOCKED',
  candidateFieldIsHypothetical: true, featureImplemented: false, currentSha, currentModelSha, expectedModelBlob, legacySha,
  branchHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: repository }).trim(),
  synthetic: true, firebaseAccess: false, userStorageAccess: false,
  checks, controlWithoutNewField: { resultStatus: control.record.value.status,
    explanation: 'Existing full-node LWW can supersede disjoint completion; a new metadata write adds another trigger.' } };
if (process.argv[2]) writeFileSync(resolve(process.argv[2]), JSON.stringify(output, null, 2));
console.log(`${checks.filter(c => c.pass).length}/${checks.length} PASS; ${output.status}; source fixture: ${fixture}`);
process.exitCode = checks.every(c => c.pass) ? 0 : 1;
