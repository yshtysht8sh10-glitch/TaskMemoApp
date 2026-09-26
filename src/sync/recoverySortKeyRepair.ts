import { normalizeNodeSortKeys } from "../domain/sortKeys";
import { nodeFromV2Value } from "./nodeV2Codec";
import { applyRevisionOperation } from "./revisionModel";
import type { SyncOperation, VersionedNode } from "./types";

/**
 * Pure recovery-only repair projection. It does not alter operation payloads, revisions,
 * receipts, the journal, or Firestore. A later execution plan must explicitly persist
 * every changed record before this projection can be authorized as recovered state.
 */
export function planRecoverySortKeyRepair(candidate: Map<string, VersionedNode>) {
  const nodes = [...candidate.values()].map((record) => nodeFromV2Value(record.value));
  const normalized = normalizeNodeSortKeys(nodes);
  const keys = new Map(normalized.map((node) => [node.id, node.sortKey]));
  const repaired = new Map<string, VersionedNode>();
  let changedNodeCount = 0;
  for (const [id, record] of candidate) {
    const sortKey = keys.get(id);
    if (!keys.has(id)) throw new Error("Recovery sortKey repair lost a Node.");
    if (!sortKey || sortKey === record.value.sortKey) { repaired.set(id, record); continue; }
    changedNodeCount++;
    repaired.set(id, { ...record, value: { ...record.value, sortKey } });
  }
  return { repaired, changedNodeCount };
}

/** Deterministic, distinct operations: never mutate/reuse an existing Outbox opId or payload. */
export function planRecoverySortKeyOperations(candidate: Map<string, VersionedNode>,
  deviceId: string, nextLocalSeq: number, createdAt: string, existingOpIds: Set<string>) {
  const projection = planRecoverySortKeyRepair(candidate);
  if (projection.changedNodeCount === 0) return { ...projection, operations: [] as SyncOperation[], final: new Map(candidate) };
  if (!deviceId || !Number.isSafeInteger(nextLocalSeq) || nextLocalSeq < 0 ||
      !Number.isSafeInteger(nextLocalSeq + projection.changedNodeCount) ||
      !Number.isFinite(Date.parse(createdAt))) throw new Error("Invalid Recovery sortKey operation identity.");
  const final = new Map(candidate);
  const operations: SyncOperation[] = [];
  const changedIds = [...projection.repaired.keys()].filter((id) =>
    projection.repaired.get(id)?.value.sortKey !== candidate.get(id)?.value.sortKey).sort();
  for (const [index, id] of changedIds.entries()) {
    const current = final.get(id)!;
    const localSeq = nextLocalSeq + index;
    if (!Number.isSafeInteger(localSeq)) throw new Error("Recovery sortKey operation sequence overflow.");
    const opId = `${deviceId}:${localSeq}`;
    if (existingOpIds.has(opId)) throw new Error("Recovery sortKey operation ID overlaps Outbox.");
    const operation: SyncOperation = {
      opId, deviceId, localSeq, targetNodeId: id, type: "update", baseRevision: current.revision,
      payload: { node: projection.repaired.get(id)!.value }, createdAt,
      status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
    };
    const acknowledgement = applyRevisionOperation(current, operation);
    if (acknowledgement.result !== "applied" || !acknowledgement.record)
      throw new Error("Recovery sortKey repair did not win its projected revision.");
    final.set(id, acknowledgement.record);
    operations.push(operation);
  }
  return { ...projection, operations, final };
}
