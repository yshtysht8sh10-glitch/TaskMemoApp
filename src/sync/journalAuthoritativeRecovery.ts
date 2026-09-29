import { planRecoverySortKeyRepair } from "./recoverySortKeyRepair";
import { applyRevisionOperation } from "./revisionModel";
import { isValidSortKey } from "../domain/sortKeys";
import type { SyncOperation, VersionedNode } from "./types";

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const knownValueFields = new Set(["id", "sortKey", "type", "parentId", "title", "body", "memoType",
  "deadlineSortKey", "dueAt", "duePreset", "status", "completedAt", "routineHistory", "routineDueOverrides", "repeatRule",
  "categoryKind", "routineWeekday", "routineDayOfMonth", "routineMonth", "deletedAt",
  "deletionBatchId", "purgedAt", "createdAt", "updatedAt"]);

export type JournalAuthoritativeOptions = {
  deviceId: string;
  nextLocalSeq: number;
  existingOperationIds: Set<string>;
  createdAt: string;
};

/** Pure projection. The legacy journal and Outbox are never mutated or replayed. */
export function planJournalAuthoritativeRecovery(remoteRecords: VersionedNode[],
  journalRecords: VersionedNode[], options: JournalAuthoritativeOptions) {
  if (!options.deviceId || !Number.isSafeInteger(options.nextLocalSeq) || options.nextLocalSeq < 0 ||
      !Number.isFinite(Date.parse(options.createdAt))) throw new Error("Invalid recovery operation identity.");
  const remote = new Map(remoteRecords.map((record) => [record.value.id, record]));
  const journal = new Map(journalRecords.map((record) => [record.value.id, record]));
  if (remote.size !== remoteRecords.length || journal.size !== journalRecords.length)
    throw new Error("Duplicate Node ID in recovery inputs.");
  const desired = new Map<string, VersionedNode>();
  let remoteOnlyNodeCount = 0, markedNodeCount = 0;
  let commonNodeCount = 0, journalMetadataDifferenceNodeCount = 0;
  for (const [id, record] of remote) {
    const local = journal.get(id);
    if (local) {
      commonNodeCount++;
      if (local.value.purgedAt && !record.value.purgedAt)
        throw new Error("Recovery would newly purge a remote Node.");
      if (record.value.purgedAt && canonical(record.value) !== canonical(local.value))
        throw new Error("Recovery cannot rewrite a purged remote Node.");
      if ((record.value.purgedAt || record.value.deletedAt) &&
          !local.value.purgedAt && !local.value.deletedAt)
        throw new Error("Recovery would resurrect a deleted or purged remote Node.");
      const remoteUnknown = Object.keys(record.value).filter((field) => !knownValueFields.has(field));
      if (remoteUnknown.some((field) => canonical(record.value[field]) !== canonical(local.value[field])))
        throw new Error("Recovery would overwrite an unknown remote Node field.");
      if (canonical({ ...record, value: null }) !== canonical({ ...local, value: null }))
        journalMetadataDifferenceNodeCount++;
      desired.set(id, { ...record, value: local.value });
    } else {
      remoteOnlyNodeCount++;
      // A purged tombstone is retained byte-for-byte, never rewritten or revived.
      const title = record.value.title;
      if (record.value.purgedAt) { desired.set(id, record); continue; }
      if (typeof title !== "string") throw new Error("Remote-only Node title is not verifiable.");
      if (!title.startsWith("⭐⭐⭐")) markedNodeCount++;
      desired.set(id, { ...record, value: { ...record.value,
        title: title.startsWith("⭐⭐⭐") ? title : `⭐⭐⭐${title}` } });
    }
  }
  for (const [id, record] of journal) if (!desired.has(id)) desired.set(id, record);
  const repaired = planRecoverySortKeyRepair(desired).repaired;
  const final = new Map(remote);
  const operations: SyncOperation[] = [];
  for (const [id, target] of [...repaired].sort(([a], [b]) => a.localeCompare(b))) {
    const current = final.get(id);
    if (current && canonical(current.value) === canonical(target.value)) continue;
    const localSeq = options.nextLocalSeq + operations.length;
    if (!Number.isSafeInteger(localSeq)) throw new Error("Recovery sequence overflow.");
    const opId = `${options.deviceId}:${localSeq}`;
    if (options.existingOperationIds.has(opId)) throw new Error("Recovery operation ID overlaps Outbox.");
    const operation: SyncOperation = { opId, deviceId: options.deviceId, localSeq,
      targetNodeId: id, type: current ? "update" : "create", baseRevision: current?.revision ?? 0,
      payload: { node: target.value }, createdAt: options.createdAt, status: "pending",
      attemptCount: 0, nextRetryAt: null, lastError: null };
    const acknowledgement = applyRevisionOperation(current, operation);
    if (acknowledgement.result !== "applied" || !acknowledgement.record)
      throw new Error("Journal-authoritative operation did not win its projected revision.");
    operations.push(operation);
    final.set(id, acknowledgement.record);
  }
  const postRepair = planRecoverySortKeyRepair(final);
  if (postRepair.changedNodeCount !== 0) throw new Error("Recovery candidate retains duplicate sibling sortKeys.");
  let nonSortKeyJournalDifferenceNodeCount = 0;
  for (const [id, record] of journal) {
    const recovered = final.get(id);
    if (!recovered) throw new Error("Recovery candidate lost a journal Node.");
    if (canonical({ ...recovered.value, sortKey: null }) !==
        canonical({ ...record.value, sortKey: null })) nonSortKeyJournalDifferenceNodeCount++;
  }
  if (nonSortKeyJournalDifferenceNodeCount !== 0)
    throw new Error("Recovery candidate differs from journal user data beyond sortKey.");
  const siblingKeys = new Map<string | null, Set<string>>();
  for (const record of final.values()) {
    if (record.value.deletedAt || record.value.purgedAt) continue;
    if (!isValidSortKey(record.value.sortKey as string))
      throw new Error("Recovery candidate has an invalid sortKey.");
    const parentId = typeof record.value.parentId === "string" ? record.value.parentId : null;
    if (record.value.parentId !== null && (typeof record.value.parentId !== "string" ||
        !final.has(record.value.parentId) || final.get(record.value.parentId)?.value.type !== "category" ||
        final.get(record.value.parentId)?.value.deletedAt || final.get(record.value.parentId)?.value.purgedAt))
      throw new Error("Recovery candidate has an invalid parent.");
    const keys = siblingKeys.get(parentId) ?? new Set<string>();
    if (keys.has(record.value.sortKey as string))
      throw new Error("Recovery candidate retains duplicate sibling sortKeys.");
    keys.add(record.value.sortKey as string);
    siblingKeys.set(parentId, keys);
    const ancestors = new Set([record.value.id]);
    let cursor: unknown = record.value.parentId;
    while (typeof cursor === "string") {
      if (ancestors.has(cursor)) throw new Error("Recovery candidate contains a parent cycle.");
      ancestors.add(cursor);
      cursor = final.get(cursor)?.value.parentId;
    }
  }
  return { operations, final, summary: {
    journalNodeCount: journal.size, remoteNodeCount: remote.size, candidateNodeCount: final.size,
    commonNodeCount, journalOnlyNodeCount: journal.size - commonNodeCount,
    remoteOnlyNodeCount, markedNodeCount, missingJournalNodeCount: 0,
    journalMetadataDifferenceNodeCount,
    nonSortKeyJournalDifferenceNodeCount, repairedSortKeyNodeCount:
      [...repaired].filter(([id, record]) => record.value.sortKey !== desired.get(id)?.value.sortKey).length,
    duplicateActiveSortKeyGroupCount: 0, plannedOperationCount: operations.length,
    metadataRebuildNodeCount: operations.length,
  } };
}
