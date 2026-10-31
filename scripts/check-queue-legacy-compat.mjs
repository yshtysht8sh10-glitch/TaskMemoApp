// Release gate: failures are intentional blockers, never an expected-pass test.
// Run: npx tsx scripts/check-queue-legacy-compat.mjs
// Uses exact legacy sources from Git, synthetic values, and no Firebase access.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyRevisionOperation, chooseVersionedNode } from '../src/sync/revisionModel.ts';
import { stampQueueValue } from '../src/domain/queueRegisters.ts';

const legacySha = 'de5bd087f7603831216b4d10a38a7fb41aa76b43';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const fixture = mkdtempSync(join(tmpdir(), 'taskmemo-legacy-'));
const archive = join(fixture, 'sources.tar');
execFileSync('git', ['archive', '--format=tar', '--output', archive, legacySha, 'src'], { cwd: root });
execFileSync('tar', ['-xf', archive, '-C', fixture]);
symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
const legacy = await import(pathToFileURL(join(fixture, 'src/sync/revisionModel.ts')).href);
const legacyApply = (legacy.default ?? legacy).applyRevisionOperation;
const date = '2026-10-31T00:01:00.000Z';
const plain = { id: 'synthetic-task', type: 'memo', parentId: 'q', sortKey: 'a0', status: 'active', completedAt: null, body: 'retained', routineHistory: { '2026-10-01': date } };
const base = stampQueueValue(undefined, plain, true);
const record = value => ({ value, revision: 1, lastOpId: 'seed', lastDeviceId: 'seed', lastLocalSeq: 1, operationType: 'create' });
const operation = (opId, value, baseRevision = 1) => ({ opId, deviceId: opId, localSeq: 1, targetNodeId: plain.id, type: 'update', baseRevision, payload: { node: value }, createdAt: date, status: 'pending', attemptCount: 0, nextRetryAt: null, lastError: null });
const oldComplete = () => operation('a-old', { ...base, status: 'completed', completedAt: date });
const reorder = () => operation('z-new', stampQueueValue(base, { ...base, sortKey: 'a2' }));
const checks = [];
function check(name, action) {
  try { action(); checks.push({ name, pass: true }); console.log('PASS', name); }
  catch (error) { checks.push({ name, pass: false, error: error.message }); console.error('FAIL', name, error.message); }
}
check('legacy completion survives new receive', () => {
  const ack = legacyApply(record(base), oldComplete());
  const result = chooseVersionedNode(record(base), ack.record);
  assert.equal(result.value.status, 'completed');
  assert.equal(result.value.completedAt, date);
});
check('new completion survives legacy round trip without a concurrent edit', () => {
  const completed = stampQueueValue(base, { ...base, status: 'completed', completedAt: date });
  const ack = legacyApply(record(base), operation('new', completed));
  assert.equal(chooseVersionedNode(record(base), ack.record).value.status, 'completed');
});
check('legacy completion cancellation survives new receive', () => {
  const completed = stampQueueValue(base, { ...base, status: 'completed', completedAt: date });
  const ack = legacyApply(record(completed), operation('old-undo', { ...completed, status: 'active', completedAt: null }));
  assert.equal(chooseVersionedNode(record(completed), ack.record).value.status, 'active');
});
for (const oldFirst of [false, true]) check(`offline completion and reorder retained, oldFirst=${oldFirst}`, () => {
  const first = oldFirst ? legacyApply(record(base), oldComplete()) : applyRevisionOperation(record(base), reorder());
  const last = oldFirst ? applyRevisionOperation(first.record, reorder()) : legacyApply(first.record, oldComplete());
  const result = chooseVersionedNode(record(base), last.record);
  assert.equal(result.value.sortKey, 'a2');
  assert.equal(result.value.status, 'completed');
  assert.equal(result.value.completedAt, date);
});
check('unknown-field omission cannot erase completion', () => {
  const ack = legacyApply(record(base), operation('old-without-register', { ...plain, status: 'completed', completedAt: date }));
  const result = chooseVersionedNode(record(base), ack.record);
  assert.equal(result.value.body, plain.body);
  assert.deepEqual(result.value.routineHistory, plain.routineHistory);
  assert.equal(result.value.status, 'completed');
});
check('late legacy completion retains placement after dissolution and re-creation', () => {
  const dissolved = stampQueueValue(base, { ...base, parentId: null });
  const recreated = stampQueueValue(dissolved, { ...dissolved, parentId: 'new-q', sortKey: 'a3' });
  const current = { ...record(recreated), revision: 3 };
  const ack = legacyApply(current, oldComplete());
  const result = chooseVersionedNode(current, ack.record);
  assert.equal(result.value.parentId, 'new-q');
  assert.equal(result.value.status, 'completed');
});
const report = { legacySha, candidate: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), synthetic: true, firebaseAccess: false, fixture, checks };
if (process.argv[2]) writeFileSync(resolve(process.argv[2]), JSON.stringify(report, null, 2));
console.log(`${checks.filter(c => c.pass).length}/${checks.length} PASS; legacy fixture retained at ${fixture}`);
process.exitCode = checks.every(c => c.pass) ? 0 : 1;
