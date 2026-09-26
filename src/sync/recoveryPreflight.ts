import type { ApplicationJournalPersistence } from "./applicationStore";
import { TaskMemoV2ApplicationJournal } from "./applicationStorage";
import { applyFeaturesOperation, applyPinnedNoteOperation, applyRevisionOperation } from "./revisionModel";
import { isValidSortKey } from "../domain/sortKeys";
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
type NodeMap = Map<string, VersionedNode>;
type PairComparison = {
  leftOnly: number; rightOnly: number; common: number;
  semanticEqual: number; semanticDifferent: number;
  syncMetadataEqual: number; syncMetadataDifferent: number;
  exactEqual: number; exactDifferent: number; unknownFieldDifference: number;
  semanticMatches: boolean; syncMetadataMatches: boolean; exactMatches: boolean;
};
type StructureCheck = {
  nodeCount: number; activeNodeCount: number; missingParentCount: number;
  inactiveParentCount: number; nonCategoryParentCount: number; invalidParentCount: number;
  cycleNodeCount: number; invalidActiveSortKeyCount: number;
  duplicateActiveSortKeyNodeCount: number; duplicateActiveSortKeyGroupCount: number;
  valid: boolean;
};
type ReplayResult = {
  applied: number; superseded: number; skippedStale: number; skippedFuture: number;
  skippedCreateExisting: number;
  skippedMissing: number; duplicate: number; invalid: number; finalNodeCount: number;
  semanticMatchesJournal: boolean; syncMetadataMatchesJournal: boolean;
  exactMatchesJournal: boolean; profileMatchesJournal: boolean;
};
type OperationResultCounts = { success: number; duplicate: number; missing: number; conflict: number; inconsistency: number };
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
  dryRunConflictReasonByType: Record<SyncOperation["type"], RecoveryPreflight["dryRunConflictByReason"]>;
  dryRunInconsistencyByReason: { invalidOperation: number; duplicateOperationId: number;
    invalidTarget: number; currentOperationMismatch: number; invalidPayload: number };
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
  /** Fixed, allowlisted field names only. Each count is the number of differing Nodes. */
  dryRunOtherFieldCounts: Record<string, number>;
  dryRunMetadataOnlyFieldCounts: Record<string, number>;
  semanticNodeStateMatchesJournal: boolean;
  syncMetadataMatchesJournal: boolean;
  exactNodeStateMatchesJournal: boolean;
  nodeComparisons: Record<"applicationJournal" | "applicationRemote" | "applicationDryRun" |
    "journalRemote" | "journalDryRun" | "remoteDryRun", PairComparison>;
  structureChecks: Record<"application" | "journal" | "remote" | "dryRun", StructureCheck>;
  operationTypeCounts: Record<SyncOperation["type"], number>;
  operationUnrecognizedTypeCount: number;
  dryRunResultsByType: Record<SyncOperation["type"], OperationResultCounts>;
  createAnalysis: { total: number; uniqueTargets: number; repeatedTargetOperations: number;
    targetAlreadyRemote: number; targetInJournal: number; targetMissingJournal: number;
    payloadMatchesJournalValue: number; invalidPayload: number;
    distinctTimestampCount: number; maxSameTimestampCount: number };
  updateAnalysis: { total: number; uniqueTargets: number; maxPerNode: number;
    noPreviousValue: number; noChange: number; sortKeyOnly: number;
    sortKeyAndTimestampOnly: number; timestampOnly: number;
    userContent: number; unknownOrMixed: number; invalidPayload: number };
  replayStrategies: Record<"strict" | "createCompatible" | "serverWinner" | "skipStale", ReplayResult>;
  remoteSnapshotStable: boolean;
  remoteSnapshotComparison: PairComparison;
  remoteReceiptCountStable: boolean;
  recoverySafetyDecision: "blocked" | "manual-review";
  recoverySafetyBlockReasons: { localCopyMismatch: number; receiptAuditMismatch: number;
    invalidRemoteReceiptCount: number; applicationJournalDivergence: number;
    remoteSnapshotUnstable: number; structureInvalid: number; nodeSemanticMismatch: number;
    nodeSyncMetadataMismatch: number; nodeExactMismatch: number; profileMismatch: number;
    remoteRevisionAhead: number; strictReplayConflict: number; noReplayExactlyMatches: number;
    unknownFieldDifference: number; unrecognizedOperationType: number };
  semanticNodeStateReasons: {
    nodeExistenceDifferenceCount: number;
    meaningfulFieldDifferenceNodeCount: number;
    unknownFieldDifferenceNodeCount: number;
    internalOnlyDifferenceNodeCount: number;
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
// createdAt and updatedAt can affect routine anchors and completion-history presentation.
const knownValueFields = new Set(["id", "sortKey", ...userContentFields, ...timestampFields]);
const internalRecordFields = new Set(["revision", "lastOpId", "lastDeviceId", "lastLocalSeq", "operationType"]);
const metadataOf = (record: VersionedNode) => Object.fromEntries(
  Object.entries(record as unknown as Record<string, unknown>).filter(([key]) => key !== "value"));
const nodeMap = (domain: Record<string, VersionedNode>): NodeMap => new Map(Object.entries(domain));

function compareNodeMaps(left: NodeMap, right: NodeMap): PairComparison {
  let leftOnly = 0, rightOnly = 0, common = 0;
  let semanticEqual = 0, syncMetadataEqual = 0, exactEqual = 0, unknownFieldDifference = 0;
  for (const [id, record] of left) {
    const peer = right.get(id);
    if (!peer) { leftOnly++; continue; }
    common++;
    const fields = differingFieldNames(record, peer);
    const unknown = fields.includes("value.unknownField") || fields.includes("record.unknownField");
    if (unknown) unknownFieldDifference++;
    if (canonical(record.value) === canonical(peer.value) && !fields.includes("record.unknownField")) semanticEqual++;
    if (canonical(metadataOf(record)) === canonical(metadataOf(peer))) syncMetadataEqual++;
    if (canonical(record) === canonical(peer)) exactEqual++;
  }
  for (const id of right.keys()) if (!left.has(id)) rightOnly++;
  const semanticDifferent = common - semanticEqual;
  const syncMetadataDifferent = common - syncMetadataEqual;
  const exactDifferent = common - exactEqual;
  return { leftOnly, rightOnly, common, semanticEqual, semanticDifferent,
    syncMetadataEqual, syncMetadataDifferent, exactEqual, exactDifferent, unknownFieldDifference,
    semanticMatches: leftOnly === 0 && rightOnly === 0 && semanticDifferent === 0,
    syncMetadataMatches: leftOnly === 0 && rightOnly === 0 && syncMetadataDifferent === 0,
    exactMatches: leftOnly === 0 && rightOnly === 0 && exactDifferent === 0 };
}

function checkStructure(records: NodeMap): StructureCheck {
  const active = [...records.values()].filter((record) => !record.value.deletedAt && !record.value.purgedAt);
  let missingParentCount = 0, inactiveParentCount = 0, nonCategoryParentCount = 0, invalidParentCount = 0;
  let invalidActiveSortKeyCount = 0, duplicateActiveSortKeyNodeCount = 0, duplicateActiveSortKeyGroupCount = 0;
  const siblingKeys = new Map<string | null, Map<string, number>>();
  for (const record of active) {
    const parentId = record.value.parentId;
    if (parentId === undefined) invalidParentCount++;
    else if (parentId !== null) {
      if (typeof parentId !== "string" || !parentId) invalidParentCount++;
      else {
        const parent = records.get(parentId);
        if (!parent) missingParentCount++;
        else if (parent.value.deletedAt || parent.value.purgedAt) inactiveParentCount++;
        else if (parent.value.type !== "category") nonCategoryParentCount++;
      }
    }
    if (!isValidSortKey(record.value.sortKey as string)) invalidActiveSortKeyCount++;
    const group = typeof parentId === "string" ? parentId : null;
    const key = String(record.value.sortKey);
    const siblings = siblingKeys.get(group) ?? new Map<string, number>();
    siblings.set(key, (siblings.get(key) ?? 0) + 1);
    siblingKeys.set(group, siblings);
  }
  for (const siblings of siblingKeys.values()) for (const count of siblings.values()) if (count > 1) {
    duplicateActiveSortKeyNodeCount += count;
    duplicateActiveSortKeyGroupCount++;
  }
  const cycleIds = new Set<string>();
  for (const record of active) {
    const path: string[] = [];
    const visited = new Map<string, number>();
    let id: string | null = record.value.id;
    while (id && records.has(id)) {
      const first = visited.get(id);
      if (first !== undefined) { for (const member of path.slice(first)) cycleIds.add(member); break; }
      visited.set(id, path.length); path.push(id);
      const parentId: unknown = records.get(id)?.value.parentId;
      id = typeof parentId === "string" && parentId ? parentId : null;
    }
  }
  const cycleNodeCount = cycleIds.size;
  const valid = missingParentCount + inactiveParentCount + nonCategoryParentCount + invalidParentCount +
    cycleNodeCount + invalidActiveSortKeyCount + duplicateActiveSortKeyNodeCount === 0;
  return { nodeCount: records.size, activeNodeCount: active.length, missingParentCount,
    inactiveParentCount, nonCategoryParentCount, invalidParentCount, cycleNodeCount,
    invalidActiveSortKeyCount, duplicateActiveSortKeyNodeCount,
    duplicateActiveSortKeyGroupCount, valid };
}
export const RECOVERY_NODE_DIFFERENCE_FIELDS = [
  ...[...knownValueFields].map((field) => `value.${field}`),
  ...internalRecordFields, "value.unknownField", "record.unknownField",
] as const;

/** Unknown keys are counted without exposing their possibly private names. */
function differingFieldNames(actual: VersionedNode, expected: VersionedNode): string[] {
  const names = new Set<string>();
  for (const field of new Set([...Object.keys(actual.value), ...Object.keys(expected.value)])) {
    if (canonical(actual.value[field]) === canonical(expected.value[field])) continue;
    names.add(knownValueFields.has(field) ? `value.${field}` : "value.unknownField");
  }
  const actualRecord = actual as unknown as Record<string, unknown>;
  const expectedRecord = expected as unknown as Record<string, unknown>;
  for (const field of new Set([...Object.keys(actualRecord), ...Object.keys(expectedRecord)])) {
    if (field === "value" || canonical(actualRecord[field]) === canonical(expectedRecord[field])) continue;
    names.add(internalRecordFields.has(field) ? field : "record.unknownField");
  }
  return [...names];
}

function emptyFieldCounts(): Record<string, number> {
  return Object.fromEntries(RECOVERY_NODE_DIFFERENCE_FIELDS.map((field) => [field, 0]));
}

function analyzeCreateAndUpdate(operations: SyncOperation[], remote: NodeMap, journal: NodeMap) {
  const createTargets = new Set<string>();
  const createTimes = new Map<string, number>();
  const updateTargets = new Map<string, number>();
  // Compare each full-snapshot payload with the preceding remote/outbox payload for that Node.
  // This describes intended changes even when the conservative replay rejects an operation.
  const prior = new Map([...remote].map(([id, record]) => [id, record.value]));
  const createAnalysis: RecoveryPreflight["createAnalysis"] = { total: 0, uniqueTargets: 0,
    repeatedTargetOperations: 0, targetAlreadyRemote: 0, targetInJournal: 0,
    targetMissingJournal: 0, payloadMatchesJournalValue: 0, invalidPayload: 0,
    distinctTimestampCount: 0, maxSameTimestampCount: 0 };
  const updateAnalysis: RecoveryPreflight["updateAnalysis"] = { total: 0, uniqueTargets: 0,
    maxPerNode: 0, noPreviousValue: 0, noChange: 0, sortKeyOnly: 0,
    sortKeyAndTimestampOnly: 0, timestampOnly: 0, userContent: 0,
    unknownOrMixed: 0, invalidPayload: 0 };
  for (const operation of operations) {
    if (!operation || (operation.targetType ?? "node") !== "node") continue;
    const value = operation.payload?.node;
    const validValue = value && typeof value === "object" && !Array.isArray(value) &&
      (value as { id?: unknown }).id === operation.targetNodeId;
    if (operation.type === "create") {
      createAnalysis.total++;
      if (createTargets.has(operation.targetNodeId)) createAnalysis.repeatedTargetOperations++;
      createTargets.add(operation.targetNodeId);
      if (remote.has(operation.targetNodeId)) createAnalysis.targetAlreadyRemote++;
      if (journal.has(operation.targetNodeId)) createAnalysis.targetInJournal++;
      else createAnalysis.targetMissingJournal++;
      if (!validValue) createAnalysis.invalidPayload++;
      else if (canonical(value) === canonical(journal.get(operation.targetNodeId)?.value))
        createAnalysis.payloadMatchesJournalValue++;
      if (typeof operation.createdAt === "string")
        createTimes.set(operation.createdAt, (createTimes.get(operation.createdAt) ?? 0) + 1);
    }
    if (operation.type === "update") {
      updateAnalysis.total++;
      updateTargets.set(operation.targetNodeId, (updateTargets.get(operation.targetNodeId) ?? 0) + 1);
      if (!validValue) { updateAnalysis.invalidPayload++; continue; }
      const previous = prior.get(operation.targetNodeId);
      if (!previous) updateAnalysis.noPreviousValue++;
      else {
        const fields = new Set([...Object.keys(previous), ...Object.keys(value as object)]
          .filter((field) => canonical(previous[field]) !== canonical((value as Record<string, unknown>)[field])));
        if (fields.size === 0) updateAnalysis.noChange++;
        else if ([...fields].some((field) => userContentFields.has(field))) updateAnalysis.userContent++;
        else if ([...fields].some((field) => !knownValueFields.has(field))) updateAnalysis.unknownOrMixed++;
        else if (fields.size === 1 && fields.has("sortKey")) updateAnalysis.sortKeyOnly++;
        else if (fields.has("sortKey") && [...fields].every((field) => field === "sortKey" || timestampFields.has(field)))
          updateAnalysis.sortKeyAndTimestampOnly++;
        else if ([...fields].every((field) => timestampFields.has(field))) updateAnalysis.timestampOnly++;
        else updateAnalysis.unknownOrMixed++;
      }
    }
    if (validValue) prior.set(operation.targetNodeId, value as VersionedNode["value"]);
  }
  createAnalysis.uniqueTargets = createTargets.size;
  createAnalysis.distinctTimestampCount = createTimes.size;
  createAnalysis.maxSameTimestampCount = Math.max(0, ...createTimes.values());
  updateAnalysis.uniqueTargets = updateTargets.size;
  updateAnalysis.maxPerNode = Math.max(0, ...updateTargets.values());
  return { createAnalysis, updateAnalysis };
}

/** Observation-only counterfactuals, not selectable recovery paths or authorization to upload. */
function replayForDiagnosis(strategy: "strict" | "createCompatible" | "serverWinner" | "skipStale",
  operations: SyncOperation[], remote: NodeMap, journal: NodeMap,
  remotePinned: VersionedPinnedNote | undefined, remoteFeatures: VersionedFeatures | undefined,
  journalPinned: VersionedPinnedNote | null | undefined, journalFeatures: VersionedFeatures | null | undefined): ReplayResult {
  const nodes = new Map(remote);
  let pinned = remotePinned, features = remoteFeatures;
  const result: ReplayResult = { applied: 0, superseded: 0, skippedStale: 0, skippedFuture: 0,
    skippedCreateExisting: 0, skippedMissing: 0, duplicate: 0, invalid: 0, finalNodeCount: 0,
    semanticMatchesJournal: false, syncMetadataMatchesJournal: false,
    exactMatchesJournal: false, profileMatchesJournal: false };
  const seen = new Map<string, SyncOperation>();
  for (const operation of operations) {
    if (!operation || typeof operation.opId !== "string" || !operation.opId ||
        !operationTypes.includes(operation.type) || !Number.isSafeInteger(operation.baseRevision) ||
        operation.baseRevision < 0 || typeof operation.targetNodeId !== "string") {
      result.invalid++; continue;
    }
    const previous = seen.get(operation.opId);
    if (previous) {
      if (canonical(previous) === canonical(operation)) result.duplicate++;
      else result.invalid++;
      continue;
    }
    seen.set(operation.opId, operation);
    const target = operation.targetType ?? "node";
    if (target !== "node" && target !== "pinnedNote" && target !== "features") {
      result.invalid++; continue;
    }
    const current = target === "node" ? nodes.get(operation.targetNodeId) :
      target === "pinnedNote" ? pinned : features;
    if (current?.lastOpId === operation.opId) {
      const value = target === "node" ? operation.payload?.node : target === "pinnedNote" ? operation.payload?.pinnedNote : operation.payload?.features;
      if (canonical(current.value) === canonical(value) && current.revision === operation.baseRevision + 1)
        result.duplicate++;
      else result.invalid++;
      continue;
    }
    if (strategy !== "serverWinner") {
      if (!current && operation.type !== "create" && operation.type !== "import") {
        result.skippedMissing++; continue;
      }
      if (strategy === "strict" && current && (operation.type === "create" || operation.type === "import")) {
        result.skippedCreateExisting++; continue;
      }
      if (current && current.revision > operation.baseRevision) {
        result.skippedStale++; continue;
      }
      if (strategy !== "skipStale" && current && current.revision < operation.baseRevision) {
        result.skippedFuture++; continue;
      }
    }
    try {
      const ack = target === "node" ? applyRevisionOperation(current as VersionedNode | undefined, operation) :
        target === "pinnedNote" ? applyPinnedNoteOperation(current as VersionedPinnedNote | undefined, operation) :
          applyFeaturesOperation(current as VersionedFeatures | undefined, operation);
      if (ack.result === "applied") result.applied++;
      else result.superseded++;
      if (ack.record) nodes.set(operation.targetNodeId, ack.record);
      if (ack.pinnedNoteRecord) pinned = ack.pinnedNoteRecord;
      if (ack.featuresRecord) features = ack.featuresRecord;
    } catch { result.invalid++; }
  }
  const comparison = compareNodeMaps(nodes, journal);
  result.finalNodeCount = nodes.size;
  result.semanticMatchesJournal = comparison.semanticMatches;
  result.syncMetadataMatchesJournal = comparison.syncMetadataMatches;
  result.exactMatchesJournal = comparison.exactMatches;
  result.profileMatchesJournal = canonical(pinned ?? null) === canonical(journalPinned ?? null) &&
    canonical(features ?? null) === canonical(journalFeatures ?? null);
  return result;
}

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
  auditedReceivedCount = 0, auditedMissingCount = journal.sync.outbox.length,
  remoteSnapshotStable = true, secondRemote = remote): RecoveryPreflight {
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
  const operationTypeCounts = Object.fromEntries(operationTypes.map((type) => [type, 0])) as RecoveryPreflight["operationTypeCounts"];
  let operationUnrecognizedTypeCount = 0;
  const dryRunResultsByType = Object.fromEntries(operationTypes.map((type) => [type,
    { success: 0, duplicate: 0, missing: 0, conflict: 0, inconsistency: 0 }])) as RecoveryPreflight["dryRunResultsByType"];
  const outcome = (operation: SyncOperation | null | undefined, kind: keyof OperationResultCounts) => {
    if (operation && operationTypes.includes(operation.type)) dryRunResultsByType[operation.type][kind]++;
  };
  const dryRunConflictByType = Object.fromEntries(operationTypes.map((type) => [type, 0])) as RecoveryPreflight["dryRunConflictByType"];
  const dryRunConflictByReason: RecoveryPreflight["dryRunConflictByReason"] = {
    staleBaseRevision: 0, futureBaseRevision: 0, createTargetExists: 0, candidateSuperseded: 0,
  };
  const dryRunConflictReasonByType = Object.fromEntries(operationTypes.map((type) => [type,
    { staleBaseRevision: 0, futureBaseRevision: 0, createTargetExists: 0, candidateSuperseded: 0 }])) as RecoveryPreflight["dryRunConflictReasonByType"];
  const dryRunInconsistencyByReason: RecoveryPreflight["dryRunInconsistencyByReason"] = {
    invalidOperation: 0, duplicateOperationId: 0, invalidTarget: 0,
    currentOperationMismatch: 0, invalidPayload: 0,
  };
  const conflictByNode = new Map<string, number>();
  const conflict = (operation: SyncOperation, reason: keyof RecoveryPreflight["dryRunConflictByReason"]) => {
    dryRunConflictCount++;
    outcome(operation, "conflict");
    if (operationTypes.includes(operation.type)) {
      dryRunConflictByType[operation.type]++;
      dryRunConflictReasonByType[operation.type][reason]++;
    }
    dryRunConflictByReason[reason]++;
    if ((operation.targetType ?? "node") === "node")
      conflictByNode.set(operation.targetNodeId, (conflictByNode.get(operation.targetNodeId) ?? 0) + 1);
  };
  const seen = new Set<string>();
  for (const operation of journal.sync.outbox) {
    if (operation && operationTypes.includes(operation.type)) operationTypeCounts[operation.type]++;
    else operationUnrecognizedTypeCount++;
    if (!operation || typeof operation.opId !== "string" || !operation.opId ||
        !Number.isSafeInteger(operation.baseRevision) || operation.baseRevision < 0 ||
        !Number.isSafeInteger(operation.localSeq) || !operation.targetNodeId ||
        !operationTypes.includes(operation.type)) {
      dryRunInconsistencyCount++; dryRunInconsistencyByReason.invalidOperation++;
      outcome(operation, "inconsistency"); continue;
    }
    if (seen.has(operation.opId)) {
      dryRunInconsistencyCount++; dryRunInconsistencyByReason.duplicateOperationId++;
      outcome(operation, "inconsistency"); continue;
    }
    seen.add(operation.opId);
    const target = operation.targetType ?? "node";
    if (target !== "node" && target !== "pinnedNote" && target !== "features") {
      dryRunInconsistencyCount++; dryRunInconsistencyByReason.invalidTarget++;
      outcome(operation, "inconsistency"); continue;
    }
    const current = target === "node" ? records.get(operation.targetNodeId) :
      target === "pinnedNote" ? simulatedPinned : simulatedFeatures;
    if (current?.lastOpId === operation.opId) {
      const payload = target === "node" ? operation.payload?.node : target === "pinnedNote" ? operation.payload?.pinnedNote : operation.payload?.features;
      if (canonical(current.value) === canonical(payload) && current.revision === operation.baseRevision + 1)
        { dryRunDuplicateCount++; outcome(operation, "duplicate"); }
      else { dryRunInconsistencyCount++; dryRunInconsistencyByReason.currentOperationMismatch++;
        outcome(operation, "inconsistency"); }
      continue;
    }
    if (!current && operation.type !== "create" && operation.type !== "import") {
      dryRunMissingCount++; outcome(operation, "missing"); continue;
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
      outcome(operation, "success");
    } catch { dryRunInconsistencyCount++; dryRunInconsistencyByReason.invalidPayload++;
      outcome(operation, "inconsistency"); }
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
  const dryRunOtherFieldCounts = emptyFieldCounts();
  const dryRunMetadataOnlyFieldCounts = emptyFieldCounts();
  const semanticNodeStateReasons: RecoveryPreflight["semanticNodeStateReasons"] = {
    nodeExistenceDifferenceCount: 0, meaningfulFieldDifferenceNodeCount: 0,
    unknownFieldDifferenceNodeCount: 0, internalOnlyDifferenceNodeCount: 0,
  };
  for (const [id, record] of records) {
    const expected = journal.domain[id];
    if (!expected) {
      dryRunJournalNodeDifference.dryRunOnly++;
      semanticNodeStateReasons.nodeExistenceDifferenceCount++;
      continue;
    }
    const category = classifyNodeDifference(record, expected);
    dryRunJournalNodeDifference[category]++;
    const changedFields = differingFieldNames(record, expected);
    const fieldCounts = category === "other" ? dryRunOtherFieldCounts :
      category === "metadataOnly" ? dryRunMetadataOnlyFieldCounts : null;
    if (fieldCounts) for (const field of changedFields) fieldCounts[field]++;
    const meaningful = changedFields.some((field) => field.startsWith("value.") &&
      field !== "value.unknownField");
    const unknown = changedFields.includes("value.unknownField") || changedFields.includes("record.unknownField");
    if (meaningful) semanticNodeStateReasons.meaningfulFieldDifferenceNodeCount++;
    if (unknown) semanticNodeStateReasons.unknownFieldDifferenceNodeCount++;
    if (changedFields.length > 0 && !meaningful && !unknown)
      semanticNodeStateReasons.internalOnlyDifferenceNodeCount++;
    const fields = new Set([...Object.keys(record.value), ...Object.keys(expected.value)]);
    if ([...fields].every((field) => canonical(record.value[field]) === canonical(expected.value[field]) ||
        field === "sortKey" || timestampFields.has(field)))
      dryRunJournalNodeDifference.noUserContentDifference++;
  }
  for (const id of Object.keys(journal.domain))
    if (!records.has(id)) {
      dryRunJournalNodeDifference.journalOnly++;
      semanticNodeStateReasons.nodeExistenceDifferenceCount++;
    }
  const journalMap = nodeMap(journal.domain);
  const applicationMap = nodeMap(application.domain);
  const remoteMap = new Map(remote.nodes.map((record) => [record.value.id, record]));
  const dryRunMap = records;
  const nodeComparisons: RecoveryPreflight["nodeComparisons"] = {
    applicationJournal: compareNodeMaps(applicationMap, journalMap),
    applicationRemote: compareNodeMaps(applicationMap, remoteMap),
    applicationDryRun: compareNodeMaps(applicationMap, dryRunMap),
    journalRemote: compareNodeMaps(journalMap, remoteMap),
    journalDryRun: compareNodeMaps(journalMap, dryRunMap),
    remoteDryRun: compareNodeMaps(remoteMap, dryRunMap),
  };
  const structureChecks: RecoveryPreflight["structureChecks"] = {
    application: checkStructure(applicationMap), journal: checkStructure(journalMap),
    remote: checkStructure(remoteMap), dryRun: checkStructure(dryRunMap),
  };
  const { createAnalysis, updateAnalysis } = analyzeCreateAndUpdate(journal.sync.outbox, remoteMap, journalMap);
  const replayStrategies = Object.fromEntries((["strict", "createCompatible", "serverWinner", "skipStale"] as const)
    .map((strategy) => [strategy, replayForDiagnosis(strategy, journal.sync.outbox, remoteMap, journalMap,
      remote.pinnedNote, remote.features, pinned?.synced, features?.synced)])) as RecoveryPreflight["replayStrategies"];
  const secondRemoteMap = new Map(secondRemote.nodes.map((record) => [record.value.id, record]));
  const remoteSnapshotComparison = compareNodeMaps(remoteMap, secondRemoteMap);
  const remoteReceiptCountStable = remote.receiptDocumentCount === secondRemote.receiptDocumentCount;
  const remoteSnapshotIsStable = remoteSnapshotStable && remoteSnapshotComparison.exactMatches &&
    canonical(remote.pinnedNote ?? null) === canonical(secondRemote.pinnedNote ?? null) &&
    canonical(remote.features ?? null) === canonical(secondRemote.features ?? null) && remoteReceiptCountStable;
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
  const recoverySafetyBlockReasons: RecoveryPreflight["recoverySafetyBlockReasons"] = {
    localCopyMismatch: Number(!localCopyMatches),
    receiptAuditMismatch: Number(auditedReceivedCount !== 0 || auditedMissingCount !== journal.sync.outbox.length),
    invalidRemoteReceiptCount: Number(remoteReceiptCountInvalid(remote.receiptDocumentCount)),
    applicationJournalDivergence: applicationNodeNotInJournalCount + applicationOutboxNotInJournalCount,
    remoteSnapshotUnstable: Number(!remoteSnapshotIsStable),
    structureInvalid: Object.values(structureChecks).filter((result) => !result.valid).length,
    nodeSemanticMismatch: nodeComparisons.journalDryRun.semanticDifferent + nodeComparisons.journalDryRun.leftOnly + nodeComparisons.journalDryRun.rightOnly,
    nodeSyncMetadataMismatch: nodeComparisons.journalDryRun.syncMetadataDifferent,
    nodeExactMismatch: nodeComparisons.journalDryRun.exactDifferent,
    profileMismatch: profileMismatchCount,
    remoteRevisionAhead: remoteRevisionConflictCount,
    strictReplayConflict: dryRunConflictCount + dryRunMissingCount + dryRunInconsistencyCount + dryRunDuplicateCount,
    noReplayExactlyMatches: Number(!Object.values(replayStrategies).some((result) => result.exactMatchesJournal && result.profileMatchesJournal)),
    unknownFieldDifference: nodeComparisons.journalDryRun.unknownFieldDifference,
    unrecognizedOperationType: operationUnrecognizedTypeCount,
  };
  const recoverySafetyDecision = Object.values(recoverySafetyBlockReasons).some((count) => count > 0) ? "blocked" : "manual-review";
  return {
    localCopyMatches, applicationNodeCount: Object.keys(application.domain).length,
    journalNodeCount: Object.keys(journal.domain).length, journalOutboxCount: journal.sync.outbox.length,
    applicationNodeNotInJournalCount, applicationOutboxNotInJournalCount,
    remoteNodeCount: remote.nodes.length, remoteReceiptDocumentCount: remote.receiptDocumentCount,
    auditedReceivedCount, auditedMissingCount,
    nodeMatchCount, remoteOnlyNodeCount, journalOnlyNodeCount, nodeContentMismatchCount,
    remoteRevisionConflictCount, profileMismatchCount, dryRunSuccessCount, dryRunDuplicateCount,
    dryRunMissingCount, dryRunConflictCount, dryRunConflictByType, dryRunConflictByReason,
    dryRunConflictReasonByType, dryRunInconsistencyByReason,
    dryRunConflictNodeCount: conflictByNode.size,
    dryRunConflictMaxPerNode: Math.max(0, ...conflictByNode.values()), dryRunConflictNodeFrequency,
    dryRunConflictCountsPerNodeDescending: [...conflictByNode.values()].sort((a, b) => b - a),
    dryRunInconsistencyCount, dryRunNodeCount: records.size, dryRunJournalNodeDifference,
    dryRunOtherFieldCounts, dryRunMetadataOnlyFieldCounts,
    semanticNodeStateMatchesJournal: nodeComparisons.journalDryRun.semanticMatches, semanticNodeStateReasons,
    syncMetadataMatchesJournal: nodeComparisons.journalDryRun.syncMetadataMatches,
    exactNodeStateMatchesJournal: nodeComparisons.journalDryRun.exactMatches,
    nodeComparisons, structureChecks, operationTypeCounts, operationUnrecognizedTypeCount, dryRunResultsByType,
    createAnalysis, updateAnalysis, replayStrategies,
    remoteSnapshotStable: remoteSnapshotIsStable,
    remoteSnapshotComparison, remoteReceiptCountStable,
    recoverySafetyDecision, recoverySafetyBlockReasons,
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
  const secondRemote = await adapter.readRecoverySnapshot();
  const [latestCommitted, latestJournal, latestLegacyCommitted, latestLegacyJournal] = await Promise.all([
    persistence.loadCommitted(), persistence.loadJournal(), legacy.loadCommitted(), legacy.loadJournal(),
  ]);
  if (latestCommitted !== committed || latestJournal !== journal ||
      latestLegacyCommitted !== legacyCommitted || latestLegacyJournal !== legacyJournal)
    throw { code: "preflight-local-changed" };
  return compareRecoveryState(application, pending, remote, localCopyMatches, auditedReceipts.received,
    auditedReceipts.missing, true, secondRemote);
}
