import type { IndexedDbTaskMemoApplicationJournal } from './indexedDbApplicationStorage';
import type { SyncAdapter, VersionedNode, VersionedPinnedNote, VersionedFeatures } from './types';
import { canonical } from '../textFormat/syntax';
import { checkStructure } from './recoveryPreflight';
import { parseNodeBackup } from '../services/nodeBackup';
import { findRoutineRoot } from '../domain/routineRoot';

type Envelope = {
  version: number; deviceId: string; nextLocalSeq: number; domain: Record<string, VersionedNode>;
  history: { past: HistoryEntry[]; future: HistoryEntry[] };
  sync: { outbox: unknown[]; seenOpIds: string[] };
  profile: {
    pinnedNote: { synced: VersionedPinnedNote | null; localBody: string; dirtySince: string | null; migrationPending: boolean };
    features: { synced: VersionedFeatures | null; localIdeasEnabled: boolean; migrationPending: boolean };
    legacyPinnedNoteCandidates: { body: string; updatedAt: string }[];
  };
  ownership?: unknown; ownershipTransaction?: unknown; ownershipRecoverySeed?: unknown;
};
type HistoryEntry = { commandId: string; label: string; targets: Record<string, unknown>[] };
const blocked = () => new Error('冗長Journalの安全条件を確認できません。データを変更せず保護停止しました。');
const validHistory = (entry: HistoryEntry) => typeof entry?.commandId === 'string' && Boolean(entry.commandId) &&
  typeof entry.label === 'string' && Array.isArray(entry.targets) && entry.targets.every(target => {
    if (!target || typeof target !== 'object' || typeof target.resourceId !== 'string' || !target.resourceId ||
        !Number.isSafeInteger(target.forwardRevision) || (target.forwardRevision as number) < 0 ||
        !target.after || typeof target.after !== 'object') return false;
    if (target.resourceType === 'node') return typeof target.forwardOpId === 'string' &&
      (target.after as Record<string, unknown>).id === target.resourceId &&
      (target.before === null || (typeof target.before === 'object' && target.before !== null &&
        (target.before as Record<string, unknown>).id === target.resourceId));
    if (target.resourceType !== 'pinnedNote' && target.resourceType !== 'features') return false;
    const key = target.resourceType === 'pinnedNote' ? 'body' : 'ideasEnabled';
    const type = target.resourceType === 'pinnedNote' ? 'string' : 'boolean';
    return target.resourceId === target.resourceType && (target.forwardOpId === null || typeof target.forwardOpId === 'string') &&
      target.before !== null && typeof target.before === 'object' &&
      typeof (target.before as Record<string, unknown>)[key] === type && typeof (target.after as Record<string, unknown>)[key] === type;
  });

/** Never connect, provision, subscribe or upload here. Cloud reads precede local-only CAS. */
export async function repairRedundantJournalAtStartup(persistence: IndexedDbTaskMemoApplicationJournal, adapter: SyncAdapter, scope: string,
  isCurrent: () => boolean = () => true) {
  return persistence.clearRedundantJournal(scope, async raw => {
    const envelope = JSON.parse(raw) as Envelope;
    const pinned = envelope.profile?.pinnedNote, features = envelope.profile?.features;
    if (!isCurrent() || envelope.version !== 2 || typeof envelope.deviceId !== 'string' || !envelope.deviceId ||
        !Number.isSafeInteger(envelope.nextLocalSeq) || envelope.nextLocalSeq < 1 ||
        !envelope.domain || Array.isArray(envelope.domain) ||
        !Array.isArray(envelope.sync?.outbox) || envelope.sync.outbox.length ||
        !Array.isArray(envelope.sync.seenOpIds) || envelope.sync.seenOpIds.some(id => typeof id !== 'string') ||
        !Array.isArray(envelope.history?.past) || !Array.isArray(envelope.history.future) ||
        [...envelope.history.past, ...envelope.history.future].some(entry => !validHistory(entry)) ||
        envelope.ownership || envelope.ownershipTransaction || envelope.ownershipRecoverySeed ||
        !pinned || pinned.dirtySince !== null || pinned.migrationPending !== false || typeof pinned.localBody !== 'string' ||
        pinned.localBody !== (pinned.synced?.value.body ?? '') ||
        !features || features.migrationPending !== false || typeof features.localIdeasEnabled !== 'boolean' ||
        features.localIdeasEnabled !== (features.synced?.value.ideasEnabled ?? false)) throw blocked();
    const validMetadata = (record: VersionedNode | VersionedPinnedNote | VersionedFeatures) =>
      Number.isSafeInteger(record.revision) && record.revision >= 0 &&
      typeof record.lastOpId === 'string' && Boolean(record.lastOpId) &&
      typeof record.lastDeviceId === 'string' && Boolean(record.lastDeviceId) &&
      Number.isSafeInteger(record.lastLocalSeq) && record.lastLocalSeq >= 0 &&
      (record.lastDeviceId !== envelope.deviceId || record.lastLocalSeq < envelope.nextLocalSeq);
    for (const [id, record] of Object.entries(envelope.domain)) {
      if (!record || record.value?.id !== id || !id || !validMetadata(record) ||
          !['create', 'update', 'complete', 'uncomplete', 'softDelete', 'restore', 'purge', 'undo', 'redo', 'import'].includes(record.operationType)) throw blocked();
    }
    if ((pinned.synced !== null && (!validMetadata(pinned.synced) || typeof pinned.synced.value.body !== 'string')) ||
        (features.synced !== null && (!validMetadata(features.synced) || typeof features.synced.value.ideasEnabled !== 'boolean')) ||
        !Array.isArray(envelope.profile.legacyPinnedNoteCandidates) || envelope.profile.legacyPinnedNoteCandidates.some(candidate =>
          typeof candidate?.body !== 'string' || typeof candidate.updatedAt !== 'string' || !Number.isFinite(Date.parse(candidate.updatedAt)))) throw blocked();
    // Validate a copy only; never import the normalized result back into the envelope.
    try {
      const values = Object.values(envelope.domain).map(record => record.value);
      parseNodeBackup(JSON.stringify({ schemaVersion: 1, exportedAt: '2026-11-03T00:00:00.000Z', nodes: values }));
      findRoutineRoot(values);
    } catch { throw blocked(); }
    if (!checkStructure(new Map(Object.entries(envelope.domain))).valid || !adapter.readRecoverySnapshot) throw blocked();
    const first = await adapter.readRecoverySnapshot();
    const second = await adapter.readRecoverySnapshot();
    const comparable = (snapshot: typeof first) => ({
      domain: Object.fromEntries(snapshot.nodes.map(record => [record.value.id, record])),
      pinnedNote: snapshot.pinnedNote ?? null, features: snapshot.features ?? null,
    });
    const expected = { domain: envelope.domain, pinnedNote: pinned.synced, features: features.synced };
    if (!isCurrent() || first.nodes.length !== Object.keys(envelope.domain).length || second.nodes.length !== first.nodes.length ||
        !Number.isSafeInteger(first.receiptDocumentCount) || first.receiptDocumentCount < 0 || first.receiptDocumentCount !== second.receiptDocumentCount ||
        canonical(comparable(first)) !== canonical(expected) || canonical(comparable(second)) !== canonical(expected)) throw blocked();
  }, isCurrent);
}
