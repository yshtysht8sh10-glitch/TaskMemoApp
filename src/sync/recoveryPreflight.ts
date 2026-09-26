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
  dryRunConflictByType: Record<SyncOperation["type"], number>;
  dryRunConflictByReason: {
    staleBaseRevision: number;
    futureBaseRevision: number;
    createTargetExists: number;
    candidateSuperseded: number;
  };
  dryRunConflictNodeCount: number;
  dryRunConflictMaxPerNode: number;
  /** Sorted counts only; no positional link to Node IDs. */
  dryRunConflictCountsPerNodeDescending: number[];
  dryRunConflictNodeFrequency: { once: number; twoToFour: number; fiveToNine: number; tenOrMore: number };
  dryRunInconsistencyCount: number;
  dryRunNodeCount: number;
  dryRunJournalNodeDifference: {
    exactRecord: number;
    dryRunOnly: number;
    journalOnly: number;
    revisionOnly: number;
    sortKeyOnly: number;
    metadataOnly: number;
    userContent: number;
    other: number;
    noUserContentDifference: number;
  };
  dryRunMatchesJournal: boolean;
  remoteSnapshotAtomic: false;
  decision: "blocked" | "review-required";
};

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

const operationTypes = ["create", "update", "complete", "uncomplete", "softDelete", "restore", "purge", "undo", "redo", "import"] as const;
const userContentFields = new Set(["type", "parentId", "title", "body", "memoType", "deadlineSortKey", "dueAt", "duePreset", "status", "completedAt", "routineHistory", "repeatRule", "categoryKind", "routineWeekday", "routineDayOfMonth", "routineMonth", "deletedAt", "deletionBatchId", "purgedAt"]);
const timestampFields = new Set(["createdAt", "updatedAt"]);

/** Mutually exclusive differences; unknown fields are never silently treated as metadata. */
function classifyNodeDifference(actual: VersionedNode, expected: VersionedNode) {
  if (canonical(actual) === canonical(expected)) return "exactRecord" as const;
  const actualValue = actual.value as Record<string, unknown>;
  const expectedValue = expected.value as Record<string, unknown>;
  const changed = new Set([...Object.keys(actualValue), ...Object.keys(expectedValue)]
    .filter((field) => canonical(actualValue[field]) !== canonical(expectedValue[field])));
  if ([...changed].some((field) => userContentFields.has(field))) return "userContent" as const;
  if ([...changed].some((field) => field !== "sortKey" && !timestampFields.has(field))) return "other" as const;
  const sortKey = changed.has("sortKey");
  const metadata = [...changed].some((field) => timestampFields.has(field)) ||
    canonical({ lastOpId: actual.lastOpId, lastDeviceId: actual.lastDeviceId, lastLocalSeq: actual.lastLocalSeq, operationType: actual.operationType }) !==
    canonical({ lastOpId: expected.lastOpId, lastDeviceId: expected.lastDeviceId, lastLocalSeq: expected.lastLocalSeq, operationType: expected.operationType });
  const revision = actual.revision !== expected.revision;
  const numberOfGroups = Number(sortKey) + Number(metadata) + Number(revision);
  if (numberOfGroups !== 1) return "other" as const;
  return sortKey ? "sortKeyOnly" as const : revision ? "revisionOnly" as const : "metadataOnly" as const;
}

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
  const dryRunConflictByType = Object.fromEntries(operationTypes.map((type) => [type, 0])) as RecoveryPreflight["dryRunConflictByType"];
  const dryRunConflictByReason: RecoveryPreflight["dryRunConflictByReason"] = {
    staleBaseRevision: 0, futureBaseRevision: 0, createTargetExists: 0, candidateSuperseded: 0,
  };
  const conflictByNode = new Map<string, number>();
  const conflict = (operation: SyncOperation, reason: keyof RecoveryPreflight["dryRunConflictByReason"]) => {
    dryRunConflictCount++;
    if (operationTypes.includes(operation.type)) dryRunConflictByType[operation.type]++;
    dryRunConflictByReason[reason]++;
    if ((operation.targetType ?? "node") === "node")
      conflictByNode.set(operation.targetNodeId, (conflictByNode.get(operation.targetNodeId) ?? 0) + 1);
  };
  const seen = new Set<string>();
  for (const operation of journal.sync.outbox) {
    if (!operation || typeof operation.opId !== "string" || !operation.opId || seen.has(operation.opId) ||
        !Number.isSafeInteger(operation.baseRevision) || operation.baseRevision < 0 ||
        !Number.isSafeInteger(operation.localSeq) || !operation.targetNodeId ||
        !operationTypes.includes(operation.type)) {
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
    if (current && (operation.type === "create" || operation.type === "import")) {
      conflict(operation, "createTargetExists"); continue;
    }
    if (current && current.revision > operation.baseRevision) {
      conflict(operation, "staleBaseRevision"); continue;
    }
    if (current && current.revision < operation.baseRevision) {
      conflict(operation, "futureBaseRevision"); continue;
    }
    try {
      const result = target === "node" ? applyRevisionOperation(current as VersionedNode | undefined, operation)
        : target === "pinnedNote" ? applyPinnedNoteOperation(current as VersionedPinnedNote | undefined, operation)
          : applyFeaturesOperation(current as VersionedFeatures | undefined, operation);
      if (result.result !== "applied") { conflict(operation, "candidateSuperseded"); continue; }
      if (result.record) records.set(operation.targetNodeId, result.record);
      if (result.pinnedNoteRecord) simulatedPinned = result.pinnedNoteRecord;
      if (result.featuresRecord) simulatedFeatures = result.featuresRecord;
      dryRunSuccessCount++;
    } catch { dryRunInconsistencyCount++; }
  }
  const dryRunConflictNodeFrequency = { once: 0, twoToFour: 0, fiveToNine: 0, tenOrMore: 0 };
  for (const count of conflictByNode.values()) {
    if (count === 1) dryRunConflictNodeFrequency.once++;
    else if (count < 5) dryRunConflictNodeFrequency.twoToFour++;
    else if (count < 10) dryRunConflictNodeFrequency.fiveToNine++;
    else dryRunConflictNodeFrequency.tenOrMore++;
  }
  const dryRunJournalNodeDifference: RecoveryPreflight["dryRunJournalNodeDifference"] = {
    exactRecord: 0, dryRunOnly: 0, journalOnly: 0, revisionOnly: 0, sortKeyOnly: 0,
    metadataOnly: 0, userContent: 0, other: 0, noUserContentDifference: 0,
  };
  for (const [id, record] of records) {
    const expected = journal.domain[id];
    if (!expected) { dryRunJournalNodeDifference.dryRunOnly++; continue; }
    const category = classifyNodeDifference(record, expected);
    dryRunJournalNodeDifference[category]++;
    const fields = new Set([...Object.keys(record.value), ...Object.keys(expected.value)]);
    if ([...fields].every((field) => canonical(record.value[field]) === canonical(expected.value[field]) ||
        field === "sortKey" || timestampFields.has(field)))
      dryRunJournalNodeDifference.noUserContentDifference++;
  }
  for (const id of Object.keys(journal.domain))
    if (!records.has(id)) dryRunJournalNodeDifference.journalOnly++;
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
    dryRunMissingCount, dryRunConflictCount, dryRunConflictByType, dryRunConflictByReason,
    dryRunConflictNodeCount: conflictByNode.size,
    dryRunConflictMaxPerNode: Math.max(0, ...conflictByNode.values()), dryRunConflictNodeFrequency,
    dryRunConflictCountsPerNodeDescending: [...conflictByNode.values()].sort((a, b) => b - a),
    dryRunInconsistencyCount, dryRunNodeCount: records.size, dryRunJournalNodeDifference,
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
