import { describe, expect, it, vi } from "vitest";
import { createFirebaseSyncAdapter } from "./firebaseSyncAdapter";
import type { SyncOperation } from "./types";

const state = vi.hoisted(() => ({ documents: new Map<string, unknown>(), writes: 0, blockedPath: null as string | null, release: null as null | (() => void) }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join("/"),
  getDocFromServer: async (path: string) => {
    if (path === state.blockedPath) await new Promise<void>((resolve) => { state.release = resolve; });
    return { exists: () => state.documents.has(path), data: () => state.documents.get(path) };
  },
  runTransaction: async () => { state.writes++; throw new Error("unexpected write"); },
  collection: vi.fn(), onSnapshot: vi.fn(), serverTimestamp: vi.fn(),
}));

const operation = (id: number): SyncOperation => ({
  opId: `device:${id}`, deviceId: "device", localSeq: id, targetNodeId: `node-${id}`,
  type: "create", baseRevision: 0, payload: { node: { id: `node-${id}` } },
  createdAt: "2026-09-26T00:00:00.000Z", status: "pending", attemptCount: 0,
  nextRetryAt: null, lastError: null,
});
const path = (id: number) => `users/uid/syncOperationsV2/device:${id}`;
const receipt = (op: SyncOperation) => ({ operation: op, acknowledgement: { opId: op.opId, result: "applied" } });
const adapter = () => createFirebaseSyncAdapter({ app: { options: { projectId: "taskmemoapp-eabc3" } } } as never, "uid", "production");

describe("read-only Firebase receipt audit", () => {
  it("counts received and missing operations without any writes", async () => {
    state.documents.clear(); state.writes = 0;
    state.documents.set(path(1), receipt(operation(1)));
    expect(await adapter().auditOutbox?.([operation(1), operation(2)])).toEqual({ received: 1, missing: 1 });
    expect(state.writes).toBe(0);
  });

  it("stops on duplicate or conflicting receipts", async () => {
    state.documents.clear(); state.writes = 0;
    state.documents.set(path(1), receipt(operation(1)));
    await expect(adapter().auditOutbox?.([operation(1), operation(1)])).rejects.toMatchObject({ kind: "permanent" });
    await expect(adapter().auditOutbox?.([{ ...operation(1), payload: { node: { id: "different" } } }])).rejects.toMatchObject({ kind: "permanent" });
    expect(state.writes).toBe(0);
  });

  it("reports the last completed index and current batch while one server read is unresolved", async () => {
    state.documents.clear(); state.writes = 0;
    state.blockedPath = path(9);
    const events: { phase: string; batch: number; completed: number; lastCompletedOperationIndex: number }[] = [];
    const audit = createFirebaseSyncAdapter({ app: { options: { projectId: "taskmemoapp-eabc3" } } } as never, "uid", "production", {
      onReceiptBatch: (event) => events.push(event),
    }).auditOutbox!(Array.from({ length: 9 }, (_, index) => operation(index + 1)));
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ phase: "start", batch: 2, completed: 8, lastCompletedOperationIndex: 7 }));
    expect(state.writes).toBe(0);
    state.release?.();
    expect(await audit).toEqual({ received: 0, missing: 9 });
    expect(events.at(-1)).toMatchObject({ phase: "complete", batch: 2, completed: 9, lastCompletedOperationIndex: 8 });
    state.blockedPath = null; state.release = null;
  });

  it("times out one unresolved lookup and stops without classifying it missing or writing", async () => {
    state.documents.clear(); state.writes = 0;
    state.blockedPath = path(9);
    const batches: string[] = [];
    const lookups: { batch: number; slot: number; operationIndex: number; phase: string; durationMs: number }[] = [];
    try {
      const audit = createFirebaseSyncAdapter({ app: { options: { projectId: "taskmemoapp-eabc3" } } } as never, "uid", "production", {
        receiptLookupTimeoutMs: 20,
        onReceiptBatch: (event) => batches.push(`${event.batch}:${event.phase}`),
        onReceiptLookup: (event) => lookups.push(event),
      }).auditOutbox!(Array.from({ length: 17 }, (_, index) => operation(index + 1)));
      await expect(audit).rejects.toMatchObject({ kind: "temporary", code: "receipt-timeout" });
      expect(batches).toContain("2:start");
      expect(batches).not.toContain("2:complete");
      expect(batches).not.toContain("3:start");
      expect(lookups).toContainEqual(expect.objectContaining({ batch: 2, slot: 0, operationIndex: 8, phase: "timeout" }));
      expect(lookups).not.toContainEqual(expect.objectContaining({ operationIndex: 8, phase: "not-found" }));
      expect(lookups.every((event) => event.durationMs >= 0)).toBe(true);
      expect(state.writes).toBe(0);
    } finally { state.release?.(); state.blockedPath = null; state.release = null; }
  });
});
