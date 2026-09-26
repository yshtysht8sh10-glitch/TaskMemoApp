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
      expect(lookups.filter((event) => event.batch === 2 && event.phase === "start")).toHaveLength(8);
      expect(lookups).not.toContainEqual(expect.objectContaining({ operationIndex: 8, phase: "not-found" }));
      expect(lookups.every((event) => event.durationMs >= 0)).toBe(true);
      expect(lookups).toContainEqual(expect.objectContaining({ operationIndex: 8, phase: "timeout",
        startedAt: expect.any(String), timeoutTimerSetAt: expect.any(String), timeoutScheduledAt: expect.any(String),
        timeoutFiredAt: expect.any(String), timeoutDelayMs: expect.any(Number), performanceElapsedMs: expect.any(Number) }));
      expect(state.writes).toBe(0);
      state.release?.();
      await vi.waitFor(() => expect(lookups).toContainEqual(expect.objectContaining({ operationIndex: 8, phase: "late-resolve" })));
    } finally { state.release?.(); state.blockedPath = null; state.release = null; }
  });

  it("serial observation stops at the first timed-out slot without starting later reads", async () => {
    state.documents.clear(); state.writes = 0;
    state.blockedPath = path(1);
    const lookups: { slot: number; phase: string }[] = [];
    try {
      const audit = createFirebaseSyncAdapter({ app: { options: { projectId: "taskmemoapp-eabc3" } } } as never, "uid", "production", {
        receiptReadMode: "serial", receiptLookupTimeoutMs: 10,
        onReceiptLookup: (event) => lookups.push(event),
      }).auditOutbox!(Array.from({ length: 8 }, (_, index) => operation(index + 1)));
      await expect(audit).rejects.toMatchObject({ kind: "temporary", code: "receipt-timeout" });
      expect(lookups).toMatchObject([{ slot: 0, phase: "start" }, { slot: 0, phase: "timeout" }]);
      expect(state.writes).toBe(0);
    } finally { state.release?.(); state.blockedPath = null; state.release = null; }
  });

  it("records wall-clock timer delay separately from monotonic elapsed time", async () => {
    state.documents.clear(); state.writes = 0; state.blockedPath = path(1);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T11:19:29.612Z"));
    const lookups: { phase: string; durationMs: number; performanceElapsedMs: number; timeoutDelayMs: number | null }[] = [];
    try {
      const audit = createFirebaseSyncAdapter({ app: { options: { projectId: "taskmemoapp-eabc3" } } } as never, "uid", "production", {
        receiptReadMode: "serial", receiptLookupTimeoutMs: 10_000,
        onReceiptLookup: (event) => lookups.push(event),
      }).auditOutbox!([operation(1)]);
      vi.setSystemTime(new Date("2026-09-26T11:19:50.847Z"));
      const rejection = expect(audit).rejects.toMatchObject({ code: "receipt-timeout" });
      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
      expect(lookups).toContainEqual(expect.objectContaining({ phase: "timeout", durationMs: 31_235, timeoutDelayMs: 21_235 }));
      expect(lookups.at(-1)!.performanceElapsedMs).toBeGreaterThanOrEqual(10_000);
      expect(state.writes).toBe(0);
    } finally { state.release?.(); state.blockedPath = null; state.release = null; vi.useRealTimers(); }
  });

  it("serial and parallel reads classify the same server receipts", async () => {
    state.documents.clear(); state.writes = 0;
    state.documents.set(path(1), receipt(operation(1)));
    const operations = [operation(1), operation(2)];
    const create = (receiptReadMode: "serial" | "parallel") => createFirebaseSyncAdapter(
      { app: { options: { projectId: "taskmemoapp-eabc3" } } } as never, "uid", "production", { receiptReadMode },
    ).auditOutbox!(operations);
    expect(await create("serial")).toEqual({ received: 1, missing: 1 });
    expect(await create("parallel")).toEqual({ received: 1, missing: 1 });
    expect(state.writes).toBe(0);
  });

  it("in diagnostic serial mode waits 100ms between every completed lookup including batch boundaries", async () => {
    state.documents.clear(); state.writes = 0; state.blockedPath = null;
    vi.useFakeTimers();
    try {
      const events: { operationIndex: number; phase: string }[] = [];
      const audit = createFirebaseSyncAdapter({ app: { options: { projectId: "taskmemoapp-eabc3" } } } as never, "uid", "production", {
        receiptReadMode: "serial", receiptLookupIntervalMs: 100,
        onReceiptLookup: ({ operationIndex, phase }) => events.push({ operationIndex, phase }),
      }).auditOutbox!(Array.from({ length: 9 }, (_, index) => operation(index + 1)));
      await vi.advanceTimersByTimeAsync(0);
      for (let index = 0; index < 8; index++) {
        expect(events.filter((event) => event.phase === "start").map((event) => event.operationIndex)).toEqual(
          Array.from({ length: index + 1 }, (_, number) => number),
        );
        expect(events).toContainEqual({ operationIndex: index, phase: "not-found" });
        await vi.advanceTimersByTimeAsync(99);
        expect(events.filter((event) => event.phase === "start")).toHaveLength(index + 1);
        await vi.advanceTimersByTimeAsync(1);
      }
      expect(await audit).toEqual({ received: 0, missing: 9 });
      expect(events.filter((event) => event.phase === "start")).toHaveLength(9);
      for (let index = 1; index < events.length; index++) {
        if (events[index].phase === "start") expect(events[index - 1].phase).toBe("not-found");
      }
      expect(state.writes).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
