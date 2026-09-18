import type { SyncAcknowledgement, SyncNodeValue, SyncOperation, VersionedNode } from "./types";

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

export class InMemoryRevisionServer {
  private readonly nodes = new Map<string, VersionedNode>();
  private readonly operations = new Map<string, SyncAcknowledgement>();

  constructor(nodes: VersionedNode[] = []) {
    for (const node of nodes) this.nodes.set(node.value.id, node);
  }

  get processedOperationCount() { return this.operations.size; }
  get(nodeId: string) { return this.nodes.get(nodeId); }
  acknowledgement(opId: string) { return this.operations.get(opId); }

  apply(operation: SyncOperation) {
    const previous = this.operations.get(operation.opId);
    if (previous) return previous;
    const acknowledgement = applyRevisionOperation(this.nodes.get(operation.targetNodeId), operation);
    this.operations.set(operation.opId, acknowledgement);
    if (acknowledgement.record) this.nodes.set(operation.targetNodeId, acknowledgement.record);
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
