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
>;

export type SyncAcknowledgement = { opId: string };

export interface SyncAdapter {
  connect(): Promise<void>;
  upload(operation: SyncOperation): Promise<SyncAcknowledgement>;
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
