import type { ApplicationJournalPersistence } from "./applicationStore";
import { TaskMemoV2ApplicationJournal } from "./applicationStorage";
import { applyFeaturesOperation, applyPinnedNoteOperation, applyRevisionOperation } from "./revisionModel";
import type { SyncAdapter, SyncOperation, VersionedFeatures, VersionedNode, VersionedPinnedNote } from "./types";

type Envelope = {
  version: number;
  domain: Record<string, VersionedNode>;
  sync: { outbox: SyncOperation[] };
  profile?: {
    pinnedNote?: { synced: VersionedPinnedNote | null; localBody: string; dirtySince: string | null; migrationPending: boolean };
    features?: { synced: VersionedFeatures | null; localIdeasEnabled: boolean; migrationPending: boolean };
  };
};
export type RecoveryPreflight = {
  localCopyMatches: boolean;
  applicationNodeCount: number;
  journalNodeCount: number;
  journalOutboxCount: number;
  applicationNodeNotInJournalCount: number;
  applicationOutboxNotInJournalCount: number;
  remoteNodeCount: number;
  remoteReceiptDocumentCount: number;
  auditedReceivedCount: number;
  auditedMissingCount: number;
  nodeMatchCount: number;
  remoteOnlyNodeCount: number;
  journalOnlyNodeCount: number;
  nodeContentMismatchCount: number;
  remoteRevisionConflictCount: number;
  profileMismatchCount: number;
  dryRunSuccessCount: number;
  dryRunDuplicateCount: number;
  dryRunMissingCount: number;
  dryRunConflictCount: number;
  dryRunInconsistencyCount: number;
  dryRunNodeCount: number;
  dryRunMatchesJournal: boolean;
  remoteSnapshotAtomic: false;
  decision: "blocked" | "review-required";
};

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function parseEnvelope(raw: string | null): Envelope {
  if (!raw) throw { code: "preflight-missing-local" };
  const value = JSON.parse(raw) as Envelope;
  if (value.version !== 2 || !value.domain || Array.isArray(value.domain) ||
      !Array.isArray(value.sync?.outbox)) throw { code: "preflight-invalid-local" };
  for (const [id, record] of Object.entries(value.domain))
    if (!record || record.value?.id !== id || !Number.isSafeInteger(record.revision))
      throw { code: "preflight-invalid-local" };
  return value;
}

/** Pure, conservative simulation. Counts are disjoint and every operation is classified. */
export function compareRecoveryState(application: Envelope, journal: Envelope,
  remote: Awaited<ReturnType<NonNullable<SyncAdapter["readRecoverySnapshot"]>>>, localCopyMatches: boolean,
  auditedReceivedCount = 0, auditedMissingCount = journal.sync.outbox.length): RecoveryPreflight {
  const records = new Map<string, VersionedNode>();
  for (const record of remote.nodes) {
    if (!record?.value?.id || records.has(record.value.id) || !Number.isSafeInteger(record.revision))
      throw { code: "preflight-invalid-remote" };
    records.set(record.value.id, record);
  }
  let nodeMatchCount = 0, remoteOnlyNodeCount = 0, journalOnlyNodeCount = 0;
  let nodeContentMismatchCount = 0, remoteRevisionConflictCount = 0;
  for (const [id, record] of records) {
    const local = journal.domain[id];
    if (!local) { remoteOnlyNodeCount++; continue; }
    if (canonical(record.value) === canonical(local.value)) nodeMatchCount++;
    else nodeContentMismatchCount++;
    if (record.revision > local.revision) remoteRevisionConflictCount++;
  }
  for (const id of Object.keys(journal.domain)) if (!records.has(id)) journalOnlyNodeCount++;
  const pinned = journal.profile?.pinnedNote;
  const features = journal.profile?.features;
  let profileMismatchCount = 0;
  if (!pinned || !features) profileMismatchCount++;
  if (canonical(pinned?.synced ?? null) !== canonical(remote.pinnedNote ?? null)) profileMismatchCount++;
  if (canonical(features?.synced ?? null) !== canonical(remote.features ?? null)) profileMismatchCount++;
  // Local-only profile edits cannot be inferred from the synced resource.
  if (pinned?.dirtySince || pinned?.migrationPending || features?.migrationPending) profileMismatchCount++;
  if (pinned && pinned.localBody !== (pinned.synced?.value.body ?? "")) profileMismatchCount++;
  if (features && features.localIdeasEnabled !== (features.synced?.value.ideasEnabled ?? false)) profileMismatchCount++;

  const applicationNodeNotInJournalCount = Object.keys(application.domain)
    .filter((id) => !journal.domain[id]).length;
  const journalOperations = new Map(journal.sync.outbox.map((operation) => [operation.opId, operation]));
  const applicationOutboxNotInJournalCount = application.sync.outbox
    .filter((operation) => canonical(journalOperations.get(operation.opId)) !== canonical(operation)).length;

  let simulatedPinned = remote.pinnedNote, simulatedFeatures = remote.features;
  let dryRunSuccessCount = 0, dryRunDuplicateCount = 0, dryRunMissingCount = 0;
  let dryRunConflictCount = 0, dryRunInconsistencyCount = 0;
  const seen = new Set<string>();
  for (const operation of journal.sync.outbox) {
    if (!operation || typeof operation.opId !== "string" || !operation.opId || seen.has(operation.opId) ||
        !Number.isSafeInteger(operation.baseRevision) || operation.baseRevision < 0 ||
        !Number.isSafeInteger(operation.localSeq) || !operation.targetNodeId) {
      dryRunInconsistencyCount++; continue;
    }
    seen.add(operation.opId);
    const target = operation.targetType ?? "node";
    if (target !== "node" && target !== "pinnedNote" && target !== "features") {
      dryRunInconsistencyCount++; continue;
    }
    const current = target === "node" ? records.get(operation.targetNodeId) :
      target === "pinnedNote" ? simulatedPinned : simulatedFeatures;
    if (current?.lastOpId === operation.opId) {
      const payload = target === "node" ? operation.payload?.node : target === "pinnedNote" ? operation.payload?.pinnedNote : operation.payload?.features;
      if (canonical(current.value) === canonical(payload) && current.revision === operation.baseRevision + 1)
        dryRunDuplicateCount++;
      else dryRunInconsistencyCount++;
      continue;
    }
    if (!current && operation.type !== "create" && operation.type !== "import") {
      dryRunMissingCount++; continue;
    }
    if ((current && current.revision !== operation.baseRevision) ||
        (current && (operation.type === "create" || operation.type === "import"))) {
      dryRunConflictCount++; continue;
    }
    try {
      const result = target === "node" ? applyRevisionOperation(current as VersionedNode | undefined, operation)
        : target === "pinnedNote" ? applyPinnedNoteOperation(current as VersionedPinnedNote | undefined, operation)
          : applyFeaturesOperation(current as VersionedFeatures | undefined, operation);
      if (result.result !== "applied") { dryRunConflictCount++; continue; }
      if (result.record) records.set(operation.targetNodeId, result.record);
      if (result.pinnedNoteRecord) simulatedPinned = result.pinnedNoteRecord;
      if (result.featuresRecord) simulatedFeatures = result.featuresRecord;
      dryRunSuccessCount++;
    } catch { dryRunInconsistencyCount++; }
  }
  const dryRunMatchesJournal = records.size === Object.keys(journal.domain).length &&
    [...records].every(([id, record]) => canonical(record) === canonical(journal.domain[id])) &&
    canonical(simulatedPinned ?? null) === canonical(pinned?.synced ?? null) &&
    canonical(simulatedFeatures ?? null) === canonical(features?.synced ?? null);
  const blocked = !localCopyMatches || remoteReceiptCountInvalid(remote.receiptDocumentCount) ||
    applicationNodeNotInJournalCount > 0 || applicationOutboxNotInJournalCount > 0 ||
    !Number.isSafeInteger(auditedReceivedCount) || auditedReceivedCount !== 0 ||
    auditedMissingCount !== journal.sync.outbox.length ||
    remoteOnlyNodeCount > 0 || remoteRevisionConflictCount > 0 ||
    profileMismatchCount > 0 || dryRunDuplicateCount > 0 || dryRunMissingCount > 0 ||
    dryRunConflictCount > 0 || dryRunInconsistencyCount > 0 || !dryRunMatchesJournal;
  return {
    localCopyMatches, applicationNodeCount: Object.keys(application.domain).length,
    journalNodeCount: Object.keys(journal.domain).length, journalOutboxCount: journal.sync.outbox.length,
    applicationNodeNotInJournalCount, applicationOutboxNotInJournalCount,
    remoteNodeCount: remote.nodes.length, remoteReceiptDocumentCount: remote.receiptDocumentCount,
    auditedReceivedCount, auditedMissingCount,
    nodeMatchCount, remoteOnlyNodeCount, journalOnlyNodeCount, nodeContentMismatchCount,
    remoteRevisionConflictCount, profileMismatchCount, dryRunSuccessCount, dryRunDuplicateCount,
    dryRunMissingCount, dryRunConflictCount, dryRunInconsistencyCount, dryRunNodeCount: records.size,
    dryRunMatchesJournal, remoteSnapshotAtomic: false, decision: blocked ? "blocked" : "review-required",
  };
}

const remoteReceiptCountInvalid = (count: number) => !Number.isSafeInteger(count) || count < 0;

export async function runRecoveryPreflight(persistence: ApplicationJournalPersistence, adapter: SyncAdapter, scope: string,
  auditedReceipts: { received: number; missing: number },
  legacy: ApplicationJournalPersistence = new TaskMemoV2ApplicationJournal(scope)) {
  if (!adapter.readRecoverySnapshot) throw { code: "preflight-adapter-unavailable" };
  const [committed, journal, legacyCommitted, legacyJournal] = await Promise.all([
    persistence.loadCommitted(), persistence.loadJournal(), legacy.loadCommitted(), legacy.loadJournal(),
  ]);
  const localCopyMatches = committed === legacyCommitted && journal === legacyJournal;
  if (!localCopyMatches) throw { code: "preflight-local-copy-mismatch" };
  const application = parseEnvelope(committed);
  const pending = parseEnvelope(journal);
  const remote = await adapter.readRecoverySnapshot();
  const [latestCommitted, latestJournal, latestLegacyCommitted, latestLegacyJournal] = await Promise.all([
    persistence.loadCommitted(), persistence.loadJournal(), legacy.loadCommitted(), legacy.loadJournal(),
  ]);
  if (latestCommitted !== committed || latestJournal !== journal ||
      latestLegacyCommitted !== legacyCommitted || latestLegacyJournal !== legacyJournal)
    throw { code: "preflight-local-changed" };
  return compareRecoveryState(application, pending, remote, localCopyMatches, auditedReceipts.received, auditedReceipts.missing);
}
