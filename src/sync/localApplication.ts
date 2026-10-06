import type { Node } from '../models/node';
import type { ApplicationJournalPersistence } from './applicationStore';
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';
import { decodeLegacyNodes, sourceFingerprint } from './legacyLocalCodec';
export { decodeLegacyNodes, sourceFingerprint } from './legacyLocalCodec';

export type LocalOwnership = {
  kind: 'local'; scope: string;
  migration: { source: string | null; sourceFingerprint: string; profile: { body: string; ideasEnabled: boolean }; state: 'verified' };
};

export async function migrateLocalApplication(persistence: ApplicationJournalPersistence,
  options: { scope: string; deviceId: string; source: string | null; profile: { body: string; ideasEnabled: boolean }; backup?: ApplicationJournalPersistence; rawProfile?: Record<string, string | null> }) {
  if (!persistence.writeAtomic) throw new Error('Local V2にはatomic storageが必要です。');
  // Anonymous commands use atomic snapshots, never a replayable WAL. A journal
  // in this namespace is not evidence of user-approved commit intent.
  if (await persistence.loadJournal()) throw new Error('Local scopeに未確定journalがあります。復旧を確認してください。');
  let committed = await persistence.loadCommitted();
  if (!committed) {
    if (options.backup) {
      if (!options.backup.writeAtomic || await options.backup.loadJournal()) throw new Error('backupのatomic保存条件を満たしません。');
      const candidate = JSON.stringify({ version: 2, deviceId: options.deviceId, domain: {}, history: { past: [], future: [] }, sync: { outbox: [], seenOpIds: [] },
        backup: { scope: options.scope, source: options.source, profile: options.profile, rawProfile: options.rawProfile ?? {}, sourceFingerprint: sourceFingerprint(options.source) } });
      const previous = await options.backup.loadCommitted();
      if (previous === null) await options.backup.writeAtomic(null, candidate);
      else if (previous !== candidate) throw new Error('既存backupとV1 sourceが異なります。原本を保持して停止しました。');
      if (await options.backup.loadCommitted() !== candidate) throw new Error('backup再読込検証に失敗しました。');
    }
    const nodes = decodeLegacyNodes(options.source);
    const ownership: LocalOwnership = { kind: 'local', scope: options.scope, migration: {
      source: options.source, sourceFingerprint: sourceFingerprint(options.source), profile: options.profile, state: 'verified' } };
    const envelope = { version: 2, deviceId: options.deviceId, nextLocalSeq: 1, ownership,
      domain: Object.fromEntries(nodes.map(value => [value.id, { value, revision: 0, lastOpId: 'local-migration', lastDeviceId: options.deviceId, lastLocalSeq: 0, operationType: 'import' }])),
      history: { past: [], future: [] }, sync: { outbox: [], seenOpIds: [] },
      profile: { pinnedNote: { localBody: options.profile.body, synced: null, dirtySince: null, migrationPending: false, legacyUpdatedAt: null },
        legacyPinnedNoteCandidates: [], features: { localIdeasEnabled: options.profile.ideasEnabled, synced: null, migrationPending: false } } };
    const candidate = JSON.stringify(envelope);
    await persistence.writeAtomic(null, candidate);
    committed = await persistence.loadCommitted();
    if (committed !== candidate) throw new Error('Local移行の再読込検証に失敗しました。V1原本は保持しています。');
  }
  const envelope = JSON.parse(committed);
  if (envelope.ownership?.kind !== 'local' || envelope.ownership.scope !== options.scope ||
      envelope.ownership.migration.state !== 'verified' ||
      envelope.ownership.migration.sourceFingerprint !== sourceFingerprint(envelope.ownership.migration.source))
    throw new Error('Local所有者/backup検証に失敗しました。');
  if (options.backup) {
    const backupRaw = await options.backup.loadCommitted();
    const backup = backupRaw ? JSON.parse(backupRaw).backup : null;
    if (!backup || backup.scope !== options.scope || backup.source !== envelope.ownership.migration.source ||
      backup.sourceFingerprint !== sourceFingerprint(backup.source) ||
      sourceFingerprint(backup.profile) !== sourceFingerprint(envelope.ownership.migration.profile))
      throw new Error('移行backupが欠落・不一致です。原本を保持して停止しました。');
  }
  return TaskMemoV2ApplicationStore.open(persistence, [] as Node[], { deviceId: options.deviceId });
}
