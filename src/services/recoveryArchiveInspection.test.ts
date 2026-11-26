import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { inspectRecoveryArchive } from './recoveryArchiveInspection';
import { createNode } from '../domain/nodeOperations';
import { nodeToV2Value } from '../sync/nodeV2Codec';
import { accountScope } from '../sync/ownership';
const now = new Date('2026-11-26T00:00:00.000Z');
const binding = { origin: 'https://taskmemoapp-dev.web.app', scope: accountScope('development', 'taskmemoapp-dev', 'synthetic'), generation: 1 };
function envelope() {
  const value = nodeToV2Value(createNode([], 'memo', { title: 'synthetic', parentId: null }, now, 'n')[0]);
  const operation = { opId: 'd:1', deviceId: 'd', localSeq: 1, targetNodeId: 'n', type: 'create', baseRevision: 0,
    payload: { node: value }, createdAt: now.toISOString(), status: 'pending', attemptCount: 0, nextRetryAt: null, lastError: null };
  return { version: 2, deviceId: 'd', nextLocalSeq: 2, domain: { n: { value, revision: 1, lastOpId: 'd:1', lastDeviceId: 'd', lastLocalSeq: 1, operationType: 'create' } },
    history: { past: [{ commandId: 'command:1', targets: [{ resourceType: 'node', resourceId: 'n', before: null, after: value, forwardOpId: 'd:1', forwardRevision: 1 }] }], future: [] },
    sync: { outbox: [operation], seenOpIds: [] as string[] } };
}
function archive(committed = JSON.stringify(envelope()), journal: string | null = null) {
  return { format: 'taskmemo-v2-recovery-v2', origin: binding.origin, appCommit: 'synthetic', capturedAt: now.toISOString(), entries: [],
    capture: { kind: 'local-raw', consistentCut: false, automaticRestoreAllowed: false, serverReceipts: 'not-collected', drafts: 'not-collected' },
    indexedDb: { available: true, records: [{ scope: binding.scope, legacyFingerprint: 'fp', committed, journal, preservedRecoveryJournal: 'KEEP_EXACT' }] } };
}
const encode = (input: unknown) => new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const inspect = (input: unknown) => { const bytes = encode(input); return inspectRecoveryArchive(bytes, { expectedSha256: hash(bytes), binding, currentBinding: () => ({ ...binding }) }); };
it('retains bytes, both heads, History and Outbox as candidate-only; receipt/draft/cut gaps forbid restore', async () => {
  const a = archive(), journal = envelope(); journal.sync.outbox[0].attemptCount = 2;
  a.indexedDb.records[0].journal = JSON.stringify(journal);
  const bytes = encode(a), result = await inspect(a);
  expect(result.originalBytes).toEqual(bytes); expect(result.restoreAllowed).toBe(false);
  expect(result.candidates.map(c => c.source)).toEqual(['committed', 'journal']);
  expect(result.candidates[0].raw).toBe(a.indexedDb.records[0].committed);
  expect(result.issues).toEqual(expect.arrayContaining(['SERVER_RECEIPTS_UNCOLLECTED', 'DRAFTS_UNCOLLECTED', 'NO_CONSISTENT_CUT', 'NO_RESTORE_AUTHORITY', 'JOURNAL_DECISION_REQUIRED']));
});
it.each(['hash', 'origin', 'scope', 'binding-change'])('%s mismatch protects the original and creates no usable candidate', async mismatch => {
  const a = archive(); if (mismatch === 'origin') a.origin = 'https://other.invalid';
  if (mismatch === 'scope') a.indexedDb.records[0].scope = 'other-account';
  const bytes = encode(a); let reads = 0;
  const result = await inspectRecoveryArchive(bytes, { expectedSha256: mismatch === 'hash' ? '0'.repeat(64) : hash(bytes), binding,
    currentBinding: () => ({ ...binding, generation: mismatch === 'binding-change' && ++reads > 1 ? 2 : 1 }) });
  expect(result.originalBytes).toEqual(bytes); expect(result.restoreAllowed).toBe(false); expect(result.candidates).toEqual([]);
});
it.each(['{ broken', JSON.stringify({ version: 99 }), JSON.stringify({ ...envelope(), nextLocalSeq: 1 })])('opaque/unknown/unsafe local raw stays untouched: %s', async raw => {
  const result = await inspect(archive(raw)); expect(result.candidates).toEqual([]); expect(result.restoreAllowed).toBe(false);
  expect(result.issues).toContain('LOCAL_ENVELOPE_UNVERIFIED');
});
it('same opId with different immutable payload in the second head is rejected, never silently merged', async () => {
  const a = archive(), j = envelope(); j.sync.outbox[0].payload.node.title = 'different';
  a.indexedDb.records[0].journal = JSON.stringify(j);
  const result = await inspect(a); expect(result.issues).toContain('OPERATION_ID_COLLISION'); expect(result.candidates).toEqual([]);
});
it('missing History evidence and seen IDs are not fabricated receipts or reflection', async () => {
  const e = envelope(); e.history.past[0].targets[0].forwardOpId = 'accepted:missing'; e.sync.seenOpIds = ['accepted:missing'];
  const result = await inspect(archive(JSON.stringify(e)));
  expect(result.issues).toContain('HISTORY_EVIDENCE_UNCOLLECTED'); expect(result.restoreAllowed).toBe(false);
});
it('unknown Routine evidence and foreign scope copies are preserved but not normalized into candidates', async () => {
  const e = envelope(); e.domain.n.value.routineOutcomes = { '2026-11-25': { state: 'future', changedAt: now.toISOString(), version: 1 } };
  const a = archive(JSON.stringify(e)); const result = await inspect(a);
  expect(result.candidates).toEqual([]); expect(result.originalBytes).toEqual(encode(a)); expect(result.restoreAllowed).toBe(false);
});
it('archive self-claims of completeness cannot authorize restoration', async () => {
  const a = archive(); Object.assign(a.capture, { consistentCut: true, automaticRestoreAllowed: true, serverReceipts: 'complete', drafts: 'complete' });
  const result = await inspect(a); expect(result.restoreAllowed).toBe(false); expect(result.issues).toContain('UNTRUSTED_COMPLETENESS_CLAIM');
});
it('invalid UTF-8 is preserved as bytes instead of replacement-decoding it', async () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x80]);
  const result = await inspectRecoveryArchive(bytes, { expectedSha256: hash(bytes), binding, currentBinding: () => binding });
  expect(result.originalBytes).toEqual(bytes); expect(result.candidates).toEqual([]); expect(result.issues).toContain('ARCHIVE_UNINTERPRETABLE');
});
it.each(['resource', 'reference', 'before', 'revision', 'operation-date', 'operation-status'])('unsafe History/Outbox %s cannot produce a candidate', async kind => {
  const e = envelope(), target = e.history.past[0].targets[0];
  if (kind === 'resource') target.resourceId = 'other';
  if (kind === 'reference') { e.sync.outbox[0].targetNodeId = 'other'; e.sync.outbox[0].payload.node = { ...target.after, id: 'other' }; }
  if (kind === 'before') Object.assign(target, { before: { ...target.after, id: 'other' } });
  if (kind === 'revision') target.forwardRevision = -1;
  if (kind === 'operation-date') e.sync.outbox[0].createdAt = 'invalid';
  if (kind === 'operation-status') e.sync.outbox[0].status = 'accepted';
  const a = archive(JSON.stringify(e)), result = await inspect(a);
  expect(result.candidates).toEqual([]); expect(result.originalBytes).toEqual(encode(a));
  expect(result.issues).toContain('LOCAL_ENVELOPE_UNVERIFIED');
});
it('caller input mutation cannot replace the original bytes while hashing', async () => {
  const bytes = encode(archive()), saved = new Uint8Array(bytes);
  const pending = inspectRecoveryArchive(bytes, { expectedSha256: hash(saved), binding, currentBinding: () => binding });
  bytes.fill(0);
  const result = await pending;
  expect(result.originalBytes).toEqual(saved); expect(result.candidates).toHaveLength(1); expect(result.restoreAllowed).toBe(false);
});
it('a matching opId with a different History resource is not considered valid evidence', async () => {
  const e = envelope(), target = e.history.past[0].targets[0];
  target.resourceId = 'other'; target.after = { ...target.after, id: 'other' };
  const result = await inspect(archive(JSON.stringify(e)));
  expect(result.candidates).toEqual([]); expect(result.restoreAllowed).toBe(false);
});
