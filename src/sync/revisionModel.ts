import type { PinnedNoteValue, SyncAcknowledgement, SyncNodeValue, SyncOperation, VersionedNode, VersionedPinnedNote } from "./types";

const deletionRank = (node: SyncNodeValue) => node.purgedAt ? 2 : node.deletedAt ? 1 : 0;

export function candidateForOperation(operation: SyncOperation): VersionedNode {
  const value = operation.payload.node as SyncNodeValue | undefined;
  if (!value || value.id !== operation.targetNodeId) throw new Error("同期operationのNode payloadが不正です。");
  return {
    value,
    revision: operation.baseRevision + 1,
    lastOpId: operation.opId,
    lastDeviceId: operation.deviceId,
    lastLocalSeq: operation.localSeq,
    operationType: operation.type,
  };
}

/** Order-independent Node-level winner selection. */
export function chooseVersionedNode(current: VersionedNode | undefined, candidate: VersionedNode) {
  if (!current) return candidate;
  const currentPurged = deletionRank(current.value) === 2;
  const candidatePurged = deletionRank(candidate.value) === 2;
  if (currentPurged !== candidatePurged) return candidatePurged ? candidate : current;
  if (candidate.revision !== current.revision) return candidate.revision > current.revision ? candidate : current;
  const rankDifference = deletionRank(candidate.value) - deletionRank(current.value);
  if (rankDifference) return rankDifference > 0 ? candidate : current;
  return candidate.lastOpId > current.lastOpId ? candidate : current;
}

export function applyRevisionOperation(current: VersionedNode | undefined, operation: SyncOperation): SyncAcknowledgement {
  const candidate = candidateForOperation(operation);
  const winner = chooseVersionedNode(current, candidate);
  return {
    opId: operation.opId,
    revision: winner.revision,
    result: winner.lastOpId === operation.opId ? "applied" : "superseded",
    record: winner,
  };
}

export function candidateForPinnedNoteOperation(operation: SyncOperation): VersionedPinnedNote {
  const value = operation.payload.pinnedNote as PinnedNoteValue | undefined;
  if (operation.targetType !== "pinnedNote" || operation.targetNodeId !== "pinnedNote" || !value || typeof value.body !== "string")
    throw new Error("同期operationの常設メモpayloadが不正です。");
  return { value, revision: operation.baseRevision + 1, lastOpId: operation.opId, lastDeviceId: operation.deviceId, lastLocalSeq: operation.localSeq };
}

export function chooseVersionedPinnedNote(current: VersionedPinnedNote | undefined, candidate: VersionedPinnedNote) {
  if (!current) return candidate;
  if (candidate.revision !== current.revision) return candidate.revision > current.revision ? candidate : current;
  return candidate.lastOpId > current.lastOpId ? candidate : current;
}

export function applyPinnedNoteOperation(current: VersionedPinnedNote | undefined, operation: SyncOperation): SyncAcknowledgement {
  const candidate = candidateForPinnedNoteOperation(operation);
  const winner = chooseVersionedPinnedNote(current, candidate);
  return { opId: operation.opId, revision: winner.revision, result: winner.lastOpId === operation.opId ? "applied" : "superseded", pinnedNoteRecord: winner };
}

export class InMemoryRevisionServer {
  private readonly nodes = new Map<string, VersionedNode>();
  private pinnedNote?: VersionedPinnedNote;
  private readonly operations = new Map<string, SyncAcknowledgement>();

  constructor(nodes: VersionedNode[] = []) {
    for (const node of nodes) this.nodes.set(node.value.id, node);
  }

  get processedOperationCount() { return this.operations.size; }
  get(nodeId: string) { return this.nodes.get(nodeId); }
  getPinnedNote() { return this.pinnedNote; }
  acknowledgement(opId: string) { return this.operations.get(opId); }

  apply(operation: SyncOperation) {
    const previous = this.operations.get(operation.opId);
    if (previous) return previous;
    const acknowledgement = operation.targetType === "pinnedNote"
      ? applyPinnedNoteOperation(this.pinnedNote, operation)
      : applyRevisionOperation(this.nodes.get(operation.targetNodeId), operation);
    this.operations.set(operation.opId, acknowledgement);
    if (acknowledgement.record) this.nodes.set(operation.targetNodeId, acknowledgement.record);
    if (acknowledgement.pinnedNoteRecord) this.pinnedNote = acknowledgement.pinnedNoteRecord;
    return acknowledgement;
  }
}

type ReceiveInput = {
  deviceId: string;
  current: VersionedNode;
  seenOpIds: Set<string>;
  historyRevision: number;
};

export function receiveVersionedNode(input: ReceiveInput, incoming: VersionedNode) {
  if (input.seenOpIds.has(incoming.lastOpId)) return { kind: "duplicate" as const, current: input.current, seenOpIds: input.seenOpIds, historyRevision: input.historyRevision, createOutboxOperation: false };
  const seenOpIds = new Set(input.seenOpIds).add(incoming.lastOpId);
  if (incoming.lastDeviceId === input.deviceId) return { kind: "self-echo" as const, current: input.current, seenOpIds, historyRevision: input.historyRevision, createOutboxOperation: false };
  return {
    kind: "remote" as const,
    current: chooseVersionedNode(input.current, incoming),
    seenOpIds,
    historyRevision: input.historyRevision,
    createOutboxOperation: false,
  };
}
