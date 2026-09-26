import { describe, expect, it, vi } from "vitest";
import { createFirebaseSyncAdapter } from "./firebaseSyncAdapter";
import type { SyncOperation } from "./types";

const state = vi.hoisted(() => ({ documents: new Map<string, unknown>(), writes: 0 }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join("/"),
  getDocFromServer: async (path: string) => ({ exists: () => state.documents.has(path), data: () => state.documents.get(path) }),
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
});
