import { test } from 'vitest';
import assert from 'node:assert/strict';
import { analyzeOwnershipRanks } from './analyze-ownership-ranks.mjs';

const node = (id, extra = {}) => ({ id, type: 'memo', title: 'PRIVATE TITLE', body: 'PRIVATE BODY', parentId: null, sortKey: 'a0', deletedAt: null, ...extra });
const envelope = nodes => JSON.stringify({ version: 2, domain: Object.fromEntries(nodes.map(n => [n.id, { value: n }])), sync: { outbox: [{ payload: 'PRIVATE OUTBOX' }] } });
const archive = records => ({ format: 'taskmemo-v2-recovery-v2', origin: 'https://taskmemoapp-dev.web.app', indexedDb: { records }, entries: [] });

test('distinguishes internal duplicates from cross-scope collision without mutating or exposing content', () => {
  const input = archive([{ scope: 'anonymous', committed: envelope([node('local')]) }, { scope: 'account', committed: envelope([node('cloud')]) }]);
  const before = JSON.stringify(input);
  const result = analyzeOwnershipRanks(input);
  assert.equal(result.containers.every(c => c.duplicateActiveSiblings.length === 0), true);
  assert.equal(result.crossScopeCollisions.length, 1);
  assert.equal(result.crossScopeCollisions[0].left.id, 'local');
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('matches validator active siblings semantics including completed, excluding deleted/purged', () => {
  const result = analyzeOwnershipRanks(archive([{ scope: 'anonymous', committed: envelope([
    node('active'), node('completed', { status: 'completed' }), node('deleted', { deletedAt: '2026-10-01' }), node('purged', { purgedAt: '2026-10-01' }), node('other-parent', { parentId: 'category' }),
  ]) }]));
  assert.deepEqual(result.containers[0].duplicateActiveSiblings[0].map(n => n.id), ['active', 'completed']);
});
test('reads old localStorage committed/journal and does not merge same-scope copies', () => {
  const input = archive([]);
  input.entries = [
    { key: '@taskmemo/sync-v2/taskmemo-application/v2/anonymous', value: envelope([node('a')]) },
    { key: '@taskmemo/sync-v2/taskmemo-application-journal/v2/anonymous', value: envelope([node('b')]) },
  ];
  assert.equal(analyzeOwnershipRanks(input).containers.length, 2);
  assert.equal(analyzeOwnershipRanks(input).crossScopeCollisions.length, 0);
  assert.throws(() => analyzeOwnershipRanks({ format: 'unknown' }));
});
