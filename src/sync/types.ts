export type SyncPhase =
  | "connecting"
  | "synced"
  | "pending"
  | "offline"
  | "retrying"
  | "error";

export type SyncOperationType =
  | "create"
  | "update"
  | "complete"
  | "uncomplete"
  | "softDelete"
  | "restore"
  | "purge"
  | "undo"
  | "redo"
  | "import";

export type SyncOperationStatus = "pending" | "retrying" | "failed";

export type SyncOperation = {
  opId: string;
  deviceId: string;
  localSeq: number;
  targetNodeId: string;
  type: SyncOperationType;
  baseRevision: number;
  payload: Record<string, unknown>;
  createdAt: string;
  status: SyncOperationStatus;
  attemptCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
};

export type NewSyncOperation = Pick<
  SyncOperation,
  "targetNodeId" | "type" | "payload" | "createdAt"
> & { baseRevision?: number };

export type SyncNodeValue = Record<string, unknown> & {
  id: string;
  deletedAt?: string | null;
  purgedAt?: string | null;
};

export type VersionedNode = {
  value: SyncNodeValue;
  revision: number;
  lastOpId: string;
  lastDeviceId: string;
  lastLocalSeq: number;
  operationType: SyncOperationType;
};

export type SyncAcknowledgement = {
  opId: string;
  revision?: number;
  result?: "applied" | "superseded";
  record?: VersionedNode;
};

export interface SyncAdapter {
  connect(): Promise<void>;
  upload(operation: SyncOperation): Promise<SyncAcknowledgement>;
  subscribe?(
    onRecord: (record: VersionedNode) => void | Promise<void>,
    onError: (reason: unknown) => void,
  ): () => void;
}

export interface SyncPersistence {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
}

export type SyncState = {
  phase: SyncPhase;
  pendingCount: number;
  lastError: string | null;
};

export type SyncFailureKind = "offline" | "temporary" | "permanent";
