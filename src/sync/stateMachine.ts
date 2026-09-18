import type { SyncFailureKind, SyncState } from "./types";

export type SyncEvent =
  | { type: "connect"; pendingCount: number }
  | { type: "connected"; pendingCount: number }
  | { type: "local-operation"; pendingCount: number }
  | { type: "upload-started"; pendingCount: number; retry: boolean }
  | { type: "acknowledged"; pendingCount: number }
  | { type: "failure"; pendingCount: number; kind: SyncFailureKind; message: string };

export const initialSyncState = (pendingCount = 0): SyncState => ({
  phase: "connecting",
  pendingCount,
  lastError: null,
});

/**
 * Invariant: synced means there is no durable pending operation.
 * Cloud events are intentionally absent: remote snapshots must not mutate
 * domain history through this state machine.
 */
export function transitionSyncState(_state: SyncState, event: SyncEvent): SyncState {
  if (event.type === "connect") return { phase: "connecting", pendingCount: event.pendingCount, lastError: null };
  if (event.type === "connected") return { phase: event.pendingCount ? "pending" : "synced", pendingCount: event.pendingCount, lastError: null };
  if (event.type === "local-operation") return { phase: "pending", pendingCount: event.pendingCount, lastError: null };
  if (event.type === "upload-started") return { phase: event.retry ? "retrying" : "pending", pendingCount: event.pendingCount, lastError: null };
  if (event.type === "acknowledged") return { phase: event.pendingCount ? "pending" : "synced", pendingCount: event.pendingCount, lastError: null };
  const phase = event.kind === "offline" ? "offline" : event.kind === "temporary" ? "retrying" : "error";
  return { phase, pendingCount: event.pendingCount, lastError: event.message };
}
