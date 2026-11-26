import { canonical } from '../textFormat/syntax';
import { decodeLegacyNodes, isSupportedRawRank } from '../sync/legacyLocalCodec';
import { decodeLegacyDate } from '../sync/legacyDateCodec';
import type { SyncNodeValue } from '../sync/types';
import { assertRoutineOutcomesReadable } from '../domain/routineOutcomeMerge';

export type RecoveryInspectionBinding = { origin: string; scope: string; generation: number };
export type RecoveryCandidate = {
  source: 'committed' | 'journal' | 'legacy-committed' | 'legacy-journal';
  scope: string; raw: string; deviceId: string; operationIds: string[];
  validation: 'local-shape-only';
};
export type RecoveryInspection = {
  originalBytes: Uint8Array; sha256: string | null; candidates: RecoveryCandidate[];
  issues: string[]; status: 'protected' | 'candidate-only'; restoreAllowed: false;
};
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const revision = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const date = (v: unknown) => typeof v === 'string' && v.length > 0 && Number.isFinite(Date.parse(v));
const sameBinding = (a: RecoveryInspectionBinding, b: RecoveryInspectionBinding) =>
  a.origin === b.origin && a.scope === b.scope && a.generation === b.generation;
const operationTypes = new Set(['create', 'update', 'complete', 'uncomplete', 'softDelete', 'restore', 'purge', 'undo', 'redo', 'import']);
const mutableOperationFields = new Set(['status', 'attemptCount', 'nextRetryAt', 'lastError']);
const prefixes = [
  ['@taskmemo/sync-v2/taskmemo-application/v2/', 'legacy-committed'],
  ['@taskmemo/sync-v2/taskmemo-application-journal/v2/', 'legacy-journal'],
] as const;

// Historical images are not a simultaneous Node graph. Do not synthesize
// parents or validate them against today's Domain; that graph is unavailable.
function assertHistoryImage(image: unknown, id: string) {
  if (!isObject(image) || image.id !== id || !['memo', 'category'].includes(String(image.type)) ||
    typeof image.title !== 'string' || !isSupportedRawRank(image as SyncNodeValue) ||
    !(image.parentId === null || (typeof image.parentId === 'string' && image.parentId !== id))) throw Error();
  for (const key of ['createdAt', 'updatedAt', 'deletedAt', 'purgedAt', 'dueAt', 'completedAt']) {
    if (image[key] != null) decodeLegacyDate(image[key], key);
  }
  if (image.createdAt == null || image.updatedAt == null) throw Error();
  if (image.type === 'memo' && (typeof image.body !== 'string' || !['active', 'completed'].includes(String(image.status)) ||
    !['task', 'idea'].includes(String(image.memoType ?? 'task')) || typeof image.duePreset !== 'string')) throw Error();
  assertRoutineOutcomesReadable(image.routineOutcomes);
}

/** Isolated, read-only preflight. A local checksum/binding match NEVER grants
 * restore authority, server receipt authenticity, or a consistent cut. */
export async function inspectRecoveryArchive(bytes: Uint8Array, options: {
  expectedSha256: string; binding: RecoveryInspectionBinding; currentBinding: () => RecoveryInspectionBinding;
}): Promise<RecoveryInspection> {
  const originalBytes = new Uint8Array(bytes), binding = { ...options.binding };
  const issues = new Set(['SERVER_RECEIPTS_UNCOLLECTED', 'DRAFTS_UNCOLLECTED', 'NO_CONSISTENT_CUT', 'NO_RESTORE_AUTHORITY', 'REFLECTION_UNVERIFIED']);
  let sha256: string | null = null, hardFailure = false;
  const candidates: RecoveryCandidate[] = [], operations = new Map<string, string>();
  const finish = (): RecoveryInspection => ({ originalBytes, sha256, candidates: hardFailure ? [] : candidates,
    issues: [...issues].sort(), status: hardFailure ? 'protected' : 'candidate-only', restoreAllowed: false });
  const fail = (reason: string) => { hardFailure = true; issues.add(reason); };
  const currentMatches = () => {
    try { return sameBinding(binding, options.currentBinding()); } catch { return false; }
  };
  if (!positive(binding.generation) || !binding.origin || !binding.scope || !currentMatches()) {
    fail('BINDING_UNAVAILABLE'); return finish();
  }
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', originalBytes.buffer);
    sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { fail('HASH_UNAVAILABLE'); return finish(); }
  if (!currentMatches()) { fail('BINDING_CHANGED'); return finish(); }
  if (!/^[a-f\d]{64}$/i.test(options.expectedSha256) || sha256 !== options.expectedSha256.toLowerCase()) {
    fail('HASH_MISMATCH'); return finish();
  }
  let archive: unknown;
  try { archive = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(originalBytes)); }
  catch { fail('ARCHIVE_UNINTERPRETABLE'); return finish(); }
  if (!isObject(archive) || archive.format !== 'taskmemo-v2-recovery-v2') { fail('UNKNOWN_ARCHIVE_FORMAT'); return finish(); }
  if (archive.origin !== binding.origin) { fail('ORIGIN_MISMATCH'); return finish(); }
  // A file can claim anything. Completeness is not supplied by the file itself.
  if (!isObject(archive.capture)) issues.add('CAPTURE_METADATA_UNVERIFIED');
  else if (archive.capture.automaticRestoreAllowed !== false || archive.capture.consistentCut !== false ||
    archive.capture.serverReceipts !== 'not-collected' || archive.capture.drafts !== 'not-collected')
    issues.add('UNTRUSTED_COMPLETENESS_CLAIM');

  function inspectRaw(scope: string, source: RecoveryCandidate['source'], raw: unknown) {
    if (scope !== binding.scope) { issues.add('OTHER_SCOPES_PRESENT'); return; }
    if (raw === null || raw === undefined) return;
    if (typeof raw !== 'string') { fail('LOCAL_ENVELOPE_UNVERIFIED'); return; }
    try {
      const e: unknown = JSON.parse(raw);
      if (!isObject(e) || e.version !== 2 || typeof e.deviceId !== 'string' || !e.deviceId || !positive(e.nextLocalSeq) ||
        !isObject(e.domain) || !isObject(e.history) || !Array.isArray(e.history.past) || !Array.isArray(e.history.future) ||
        !isObject(e.sync) || !Array.isArray(e.sync.outbox) || !Array.isArray(e.sync.seenOpIds) || e.sync.seenOpIds.some(id => typeof id !== 'string')) throw Error();
      const records = Object.entries(e.domain);
      for (const [id, record] of records) {
        if (!isObject(record) || !isObject(record.value) || record.value.id !== id ||
          !Number.isSafeInteger(record.revision) || Number(record.revision) < 0 || typeof record.lastOpId !== 'string') throw Error();
      }
      decodeLegacyNodes(JSON.stringify(records.map(([, record]) => (record as Record<string, unknown>).value)));
      const operationIds: string[] = [], localIds = new Set<string>(), localOperations = new Map<string, Record<string, unknown>>();
      for (const op of e.sync.outbox) {
        if (!isObject(op) || typeof op.opId !== 'string' || !op.opId || localIds.has(op.opId) || op.deviceId !== e.deviceId ||
          !positive(op.localSeq) || op.localSeq >= e.nextLocalSeq || !operationTypes.has(String(op.type)) ||
          typeof op.targetNodeId !== 'string' || !op.targetNodeId || !isObject(op.payload) || !revision(op.baseRevision) ||
          !date(op.createdAt) || !['pending', 'retrying', 'failed'].includes(String(op.status)) || !revision(op.attemptCount) ||
          !(op.nextRetryAt === null || date(op.nextRetryAt)) || !(op.lastError === null || typeof op.lastError === 'string')) throw Error();
        if (op.targetType === undefined || op.targetType === 'node') {
          if (!isObject(op.payload.node) || op.payload.node.id !== op.targetNodeId) throw Error();
          assertRoutineOutcomesReadable(op.payload.node.routineOutcomes);
        } else if (op.targetType !== 'pinnedNote' && op.targetType !== 'features') throw Error();
        localIds.add(op.opId); localOperations.set(op.opId, op); operationIds.push(op.opId);
        const immutable = canonical(Object.fromEntries(Object.entries(op).filter(([key]) => !mutableOperationFields.has(key))));
        if (operations.has(op.opId) && operations.get(op.opId) !== immutable) fail('OPERATION_ID_COLLISION');
        operations.set(op.opId, immutable);
      }
      for (const entry of [...e.history.past, ...e.history.future]) {
        if (!isObject(entry) || typeof entry.commandId !== 'string' || !entry.commandId || !Array.isArray(entry.targets)) throw Error();
        for (const target of entry.targets) {
          if (!isObject(target) || typeof target.resourceId !== 'string' || !target.resourceId || !revision(target.forwardRevision) ||
            !['node', 'pinnedNote', 'features'].includes(String(target.resourceType)) ||
            !(typeof target.forwardOpId === 'string' || (target.forwardOpId === null && target.resourceType !== 'node')) ||
            !(target.undoOpId === undefined || typeof target.undoOpId === 'string') ||
            !(target.undoRevision === undefined || revision(target.undoRevision)) ||
            (target.undoOpId === undefined) !== (target.undoRevision === undefined)) throw Error();
          if (!isObject(target.after)) throw Error();
          if (target.resourceType === 'node') {
            if (target.after.id !== target.resourceId || !(target.before === null || (isObject(target.before) && target.before.id === target.resourceId))) throw Error();
            for (const image of [target.before, target.after]) if (image !== null) {
              assertHistoryImage(image, target.resourceId);
              if ((image as Record<string, unknown>).parentId !== null) issues.add('HISTORY_GRAPH_UNVERIFIED');
            }
          } else {
            if (target.resourceId !== target.resourceType || !isObject(target.before)) throw Error();
            const field = target.resourceType === 'pinnedNote' ? 'body' : 'ideasEnabled';
            const type = target.resourceType === 'pinnedNote' ? 'string' : 'boolean';
            if (typeof target.before[field] !== type || typeof target.after[field] !== type) throw Error();
          }
          for (const id of [target.forwardOpId, target.undoOpId]) if (typeof id === 'string') {
            const operation = localOperations.get(id);
            if (!operation) issues.add('HISTORY_EVIDENCE_UNCOLLECTED');
            else if ((operation.targetType ?? 'node') !== target.resourceType || operation.targetNodeId !== target.resourceId) throw Error();
          }
          for (const value of [target.before, target.after]) if (isObject(value)) assertRoutineOutcomesReadable(value.routineOutcomes);
        }
      }
      candidates.push({ source, scope, raw, deviceId: e.deviceId, operationIds, validation: 'local-shape-only' });
    } catch { fail('LOCAL_ENVELOPE_UNVERIFIED'); }
  }
  if (!isObject(archive.indexedDb) || archive.indexedDb.available !== true || !Array.isArray(archive.indexedDb.records)) {
    fail('INDEXEDDB_COLLECTION_UNVERIFIED');
  } else {
    const scopes = new Set<string>();
    for (const record of archive.indexedDb.records) {
      if (!isObject(record) || typeof record.scope !== 'string' || scopes.has(record.scope)) { fail('SCOPE_RECORD_UNVERIFIED'); continue; }
      scopes.add(record.scope);
      inspectRaw(record.scope, 'committed', record.committed); inspectRaw(record.scope, 'journal', record.journal);
      if (record.scope === binding.scope && record.journal != null) issues.add('JOURNAL_DECISION_REQUIRED');
      if (Object.keys(record).some(key => key.startsWith('preserved') || key === 'authoritativeRecoveryPlan')) issues.add('PRESERVED_EVIDENCE_UNINTERPRETED');
    }
  }
  if (!Array.isArray(archive.entries)) fail('LOCAL_ENTRIES_UNVERIFIED');
  else for (const entry of archive.entries) {
    if (!isObject(entry) || typeof entry.key !== 'string' || typeof entry.value !== 'string') { fail('LOCAL_ENTRIES_UNVERIFIED'); continue; }
    const prefix = prefixes.find(([p]) => String(entry.key).startsWith(p));
    if (!prefix) { issues.add('NON_APPLICATION_DATA_UNINTERPRETED'); continue; }
    try { inspectRaw(decodeURIComponent(entry.key.slice(prefix[0].length)), prefix[1], entry.value); issues.add('LEGACY_COPY_RECONCILIATION_REQUIRED'); }
    catch { fail('LOCAL_SCOPE_UNVERIFIED'); }
  }
  if (!candidates.length) fail('MATCHING_SCOPE_UNCOLLECTED');
  return finish();
}
