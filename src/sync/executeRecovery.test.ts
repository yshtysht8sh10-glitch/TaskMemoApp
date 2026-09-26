import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskMemoV2ApplicationJournal } from "./applicationStorage";
import { executeJournalRecovery } from "./executeRecovery";
import { IndexedDbTaskMemoApplicationJournal } from "./indexedDbApplicationStorage";
import { prepareRecoveryPreflight } from "./recoveryPreflight";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import { applyRevisionOperation } from "./revisionModel";
import type { SyncAdapter, SyncOperation, VersionedNode } from "./types";
import type { RecoveryExecutionObservation } from "./recoveryObservation";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
} }));

const node = (id: string, sortKey: string): VersionedNode => ({
  value: { id, type: "category", parentId: null, sortKey, title: `private-${id}`,
    createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z", deletedAt: null },
  revision: 0, lastOpId: "initial", lastDeviceId: "initial", lastLocalSeq: 0, operationType: "import",
});
const operation = (index: number, record: VersionedNode): SyncOperation => ({
  opId: `device:${index}`, deviceId: "device", localSeq: index, targetNodeId: record.value.id,
  type: "create", baseRevision: 0, payload: { node: record.value },
  createdAt: "2026-09-26T00:00:00.000Z", status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
});
const envelope = (records: VersionedNode[], operations: SyncOperation[]) => JSON.stringify({
  version: 2, deviceId: "device", nextLocalSeq: operations.length + 1,
  domain: Object.fromEntries(records.map((record) => [record.value.id, record])),
  history: { past: [{ commandId: "preserve-history", targets: [] }], future: [] },
  sync: { outbox: operations, seenOpIds: [] },
  profile: { pinnedNote: { localBody: "", synced: null, dirtySince: null,
    migrationPending: false, legacyUpdatedAt: null }, legacyPinnedNoteCandidates: [],
  features: { localIdeasEnabled: false, synced: null, migrationPending: false } },
});

async function setup(count = 1) {
  const legacy = new TaskMemoV2ApplicationJournal("account");
  const initial = envelope([], []);
  const base = Array.from({ length: count }, (_, index) => node(`n${index}`, `a${index}`));
  const operations = base.map((record, index) => operation(index + 1, record));
  const journal = envelope(operations.map((op) => applyRevisionOperation(undefined, op).record!), operations);
  await legacy.writeCommitted(initial); await legacy.writeJournal(journal);
  const factory = new IDBFactory();
  const persistence = await IndexedDbTaskMemoApplicationJournal.open("account", factory);
  const remote = new Map<string, VersionedNode>();
  const receipts = new Set<string>();
  const adapter: SyncAdapter = {
    connect: vi.fn(async () => undefined),
    readRecoverySnapshot: vi.fn(async () => ({ nodes: [...remote.values()], receiptDocumentCount: receipts.size })),
    auditOutbox: vi.fn(async (ops: SyncOperation[]) => ({ received: ops.filter((op) => receipts.has(op.opId)).length,
      missing: ops.filter((op) => !receipts.has(op.opId)).length })),
    upload: vi.fn(async (op) => {
      const acknowledgement = applyRevisionOperation(remote.get(op.targetNodeId), op);
      if (acknowledgement.record) remote.set(op.targetNodeId, acknowledgement.record);
      receipts.add(op.opId);
      return acknowledgement;
    }),
  };
  return { legacy, initial, journal, factory, persistence, adapter, remote, receipts, operations };
}

describe("guarded recovery execution", () => {
  beforeEach(() => storage.clear());

  const progress = () => {
    const state: Partial<RecoveryExecutionObservation> = {};
    return { state, update: (patch: Partial<RecoveryExecutionObservation>) => Object.assign(state, patch) };
  };

  it("commits the exact 151st-node equivalent only after all receipts and remote records match", async () => {
    const fixture = await setup();
    const observed = progress();
    const legacyBefore = new Map(storage);
    const result = await executeJournalRecovery(fixture.persistence, fixture.adapter, "account",
      { received: 0, missing: 1 }, undefined, undefined, observed.update);
    expect(result).toEqual({ uploaded: 1, applied: 1, superseded: 0 });
    expect(fixture.adapter.upload).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fixture.adapter.upload).mock.calls[0][1]).toMatchObject({
      opId: fixture.operations[0].opId, result: "applied", revision: 1,
    });
    expect(await fixture.persistence.loadJournal()).toBeNull();
    const recovered = JSON.parse((await fixture.persistence.loadCommitted())!);
    expect(Object.keys(recovered.domain)).toEqual(["n0"]);
    expect(recovered.sync.outbox).toEqual([]);
    expect(recovered.history.past).toHaveLength(1);
    expect(await fixture.persistence.isRecoveryCompleted()).toBe(true);
    expect(await IndexedDbTaskMemoApplicationJournal.open("account", fixture.factory, { allowLegacyCopy: false })
      .then((store) => store.isRecoveryCompleted())).toBe(true);
    const reopened = await TaskMemoV2ApplicationStore.open(
      await IndexedDbTaskMemoApplicationJournal.open("account", fixture.factory, { allowLegacyCopy: false }),
      [], { deviceId: "ignored" });
    expect(reopened.nodes).toHaveLength(1);
    expect(reopened.outbox).toHaveLength(0);
    expect(reopened.historyDepths.past).toBe(1);
    expect(storage).toEqual(legacyBefore);
    expect(fixture.receipts.size).toBe(1);
    expect(observed.state).toMatchObject({ status: "succeeded", totalOperations: 1,
      uploadAttemptedCount: 1, uploadSucceededCount: 1,
      lastSuccessfulOperationIndex: 0, lastCompletedOperationIndex: 0,
      preExecutionReceiptReceivedCount: 0, preExecutionReceiptMissingCount: 1,
      postExecutionReceiptReceivedCount: 1, postExecutionReceiptMissingCount: 0,
      postExecutionReceiptAuditCompleted: true, currentPhase: "completed" });
    expect(observed.state.startedAt).toBeTruthy();
    expect(observed.state.endedAt).toBeTruthy();
  });

  it("records the first failed upload and a successful post-failure receipt audit", async () => {
    const fixture = await setup();
    const observed = progress();
    vi.mocked(fixture.adapter.upload).mockRejectedValueOnce({ kind: "permanent", code: "invalid-argument",
      recoveryReason: "predicted-winner-mismatch", message: "private node title" });
    await expect(executeJournalRecovery(fixture.persistence, fixture.adapter, "account",
      { received: 0, missing: 1 }, undefined, undefined, observed.update)).rejects.toMatchObject({ kind: "permanent" });
    expect(observed.state).toMatchObject({ status: "failed", totalOperations: 1,
      uploadAttemptedCount: 1, uploadSucceededCount: 0, uploadFailedCount: 1,
      failedOperationIndex: 0, currentOperationIndex: 0, failedOperationType: "create",
      lastSuccessfulOperationIndex: -1, failurePhase: "upload", errorCode: "invalid-argument",
      failureReason: "predicted-winner-mismatch", postExecutionReceiptReceivedCount: 0,
      postExecutionReceiptMissingCount: 1, postExecutionReceiptAuditCompleted: true });
    expect(JSON.stringify(observed.state)).not.toContain("private node title");
    expect(await fixture.persistence.loadJournal()).toBe(fixture.journal);
  });

  it("preserves partial upload progress and audits the receipts after a later failure", async () => {
    const fixture = await setup(3);
    const observed = progress();
    const upload = vi.mocked(fixture.adapter.upload);
    const original = upload.getMockImplementation()!;
    upload.mockImplementationOnce(original).mockImplementationOnce(original)
      .mockRejectedValueOnce({ kind: "permanent", code: "permission-denied", message: "private path" });
    await expect(executeJournalRecovery(fixture.persistence, fixture.adapter, "account",
      { received: 0, missing: 3 }, undefined, undefined, observed.update)).rejects.toMatchObject({ kind: "permanent" });
    expect(observed.state).toMatchObject({ status: "failed", totalOperations: 3,
      uploadAttemptedCount: 3, uploadSucceededCount: 2, uploadFailedCount: 1,
      failedOperationIndex: 2, lastCompletedOperationIndex: 1, lastSuccessfulOperationIndex: 1,
      failurePhase: "upload", failureReason: "permission-denied",
      postExecutionReceiptReceivedCount: 2, postExecutionReceiptMissingCount: 1,
      postExecutionReceiptAuditCompleted: true });
    expect(fixture.receipts.size).toBe(2);
    expect(await fixture.persistence.loadCommitted()).toBe(fixture.initial);
    expect(await fixture.persistence.loadJournal()).toBe(fixture.journal);
  });

  it("retains the original upload failure when the post-failure receipt audit also fails", async () => {
    const fixture = await setup();
    const observed = progress();
    const originalAudit = vi.mocked(fixture.adapter.auditOutbox!).getMockImplementation()!;
    vi.mocked(fixture.adapter.auditOutbox!).mockImplementationOnce(originalAudit)
      .mockImplementationOnce(originalAudit).mockRejectedValueOnce({ code: "unavailable" });
    vi.mocked(fixture.adapter.upload).mockRejectedValueOnce(Object.assign(new Error("private SDK error"),
      { code: "invalid-argument" }));
    await expect(executeJournalRecovery(fixture.persistence, fixture.adapter, "account",
      { received: 0, missing: 1 }, undefined, undefined, observed.update)).rejects.toThrow("private SDK error");
    expect(observed.state).toMatchObject({ status: "failed", uploadAttemptedCount: 1,
      uploadSucceededCount: 0, uploadFailedCount: 1, postExecutionReceiptAuditCompleted: false,
      postExecutionReceiptAuditError: "unavailable", failurePhase: "upload",
      failureReason: "firestore-sdk-error", errorCode: "invalid-argument" });
    expect(await fixture.persistence.loadJournal()).toBe(fixture.journal);
  });

  it("keeps both local snapshots untouched when the receipt status changes before the first upload", async () => {
    const fixture = await setup();
    vi.mocked(fixture.adapter.auditOutbox!).mockImplementationOnce(async () => ({ received: 0, missing: 1 }))
      .mockImplementationOnce(async () => ({ received: 1, missing: 0 }));
    await expect(executeJournalRecovery(fixture.persistence, fixture.adapter, "account",
      { received: 0, missing: 1 })).rejects.toMatchObject({ code: "recovery-receipt-changed" });
    expect(fixture.adapter.upload).not.toHaveBeenCalled();
    expect(await fixture.persistence.loadCommitted()).toBe(fixture.initial);
    expect(await fixture.persistence.loadJournal()).toBe(fixture.journal);
  });

  it("does not upload when the fresh preflight is blocked", async () => {
    const fixture = await setup();
    const pending = JSON.parse(fixture.journal);
    pending.domain.n0.value.sortKey = "invalid-sort-key";
    const unsafe = JSON.stringify(pending);
    await fixture.persistence.writeJournal(unsafe);
    await fixture.legacy.writeJournal(unsafe);
    await expect(executeJournalRecovery(fixture.persistence, fixture.adapter, "account",
      { received: 0, missing: 1 })).rejects.toMatchObject({ code: "recovery-preflight-blocked" });
    expect(fixture.adapter.upload).not.toHaveBeenCalled();
    expect(await fixture.persistence.loadJournal()).toBe(unsafe);
  });

  it("keeps the journal after a partial Firebase upload, without clearing the remaining outbox", async () => {
    const fixture = await setup(2);
    const upload = vi.mocked(fixture.adapter.upload);
    const original = upload.getMockImplementation()!;
    upload.mockImplementationOnce(original).mockRejectedValueOnce(new Error("offline"));
    await expect(executeJournalRecovery(fixture.persistence, fixture.adapter, "account",
      { received: 0, missing: 2 })).rejects.toThrow("offline");
    expect(fixture.receipts.size).toBe(1);
    expect(await fixture.persistence.loadCommitted()).toBe(fixture.initial);
    expect(await fixture.persistence.loadJournal()).toBe(fixture.journal);
    expect(await fixture.persistence.isRecoveryCompleted()).toBe(false);
  });

  it("stops when the authenticated session changes during upload", async () => {
    const fixture = await setup(2);
    let current = true;
    const upload = vi.mocked(fixture.adapter.upload);
    const original = upload.getMockImplementation()!;
    upload.mockImplementation(async (op) => {
      const ack = await original(op);
      current = false;
      return ack;
    });
    await expect(executeJournalRecovery(fixture.persistence, fixture.adapter, "account",
      { received: 0, missing: 2 }, () => current)).rejects.toMatchObject({ code: "recovery-cancelled" });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(await fixture.persistence.loadJournal()).toBe(fixture.journal);
  });

  it("stops on an acknowledgement that differs from the preflight winner", async () => {
    const fixture = await setup();
    vi.mocked(fixture.adapter.upload).mockResolvedValueOnce({ opId: fixture.operations[0].opId,
      result: "superseded", revision: 99 });
    await expect(executeJournalRecovery(fixture.persistence, fixture.adapter, "account",
      { received: 0, missing: 1 })).rejects.toMatchObject({ code: "recovery-ack-mismatch" });
    expect(await fixture.persistence.loadJournal()).toBe(fixture.journal);
  });

  it("stops when the remote snapshot changes between preflight and execution", async () => {
    const fixture = await setup();
    const read = vi.mocked(fixture.adapter.readRecoverySnapshot!);
    read.mockResolvedValueOnce({ nodes: [], receiptDocumentCount: 0 })
      .mockResolvedValueOnce({ nodes: [], receiptDocumentCount: 0 })
      .mockResolvedValueOnce({ nodes: [node("other", "a1")], receiptDocumentCount: 0 });
    await expect(executeJournalRecovery(fixture.persistence, fixture.adapter, "account",
      { received: 0, missing: 1 })).rejects.toMatchObject({ code: "recovery-remote-changed" });
    expect(fixture.adapter.upload).not.toHaveBeenCalled();
    expect(await fixture.persistence.loadJournal()).toBe(fixture.journal);
  });

  it("uses the same server-winner rule for 464 applied and 560 superseded receipts", async () => {
    const legacy = new TaskMemoV2ApplicationJournal("account");
    const remoteRecord = { ...node("n0", "a0"), revision: 560, lastOpId: "z-remote" };
    const operations = Array.from({ length: 1024 }, (_, index): SyncOperation => ({
      ...operation(index + 1, remoteRecord), type: "update", baseRevision: index,
    }));
    let candidate = remoteRecord;
    let applied = 0, superseded = 0;
    for (const op of operations) {
      const ack = applyRevisionOperation(candidate, op);
      candidate = ack.record!;
      if (ack.result === "applied") applied++; else superseded++;
    }
    expect({ applied, superseded }).toEqual({ applied: 464, superseded: 560 });
    const committed = envelope([remoteRecord], []);
    const journal = envelope([candidate], operations);
    await legacy.writeCommitted(committed); await legacy.writeJournal(journal);
    const persistence = await IndexedDbTaskMemoApplicationJournal.open("account", new IDBFactory());
    let serverRecord = remoteRecord as VersionedNode;
    const receipts = new Set<string>();
    const adapter: SyncAdapter = {
      connect: vi.fn(async () => undefined),
      readRecoverySnapshot: vi.fn(async () => ({ nodes: [serverRecord], receiptDocumentCount: receipts.size })),
      auditOutbox: vi.fn(async (ops: SyncOperation[]) => ({
        received: ops.filter((op) => receipts.has(op.opId)).length,
        missing: ops.filter((op) => !receipts.has(op.opId)).length,
      })),
      upload: vi.fn(async (op: SyncOperation) => {
        const ack = applyRevisionOperation(serverRecord, op);
        serverRecord = ack.record!;
        receipts.add(op.opId);
        return ack;
      }),
    };
    const { report } = await prepareRecoveryPreflight(persistence, adapter, "account",
      { received: 0, missing: 1024 }, legacy);
    expect(report.recoverySafetyDecision).toBe("blocked");
    expect(report.finalPreflight.finalRecoverySafetyDecision).toBe("safe");
    expect(report.finalPreflight.authorizesRecovery).toBe(true);
    const result = await executeJournalRecovery(persistence, adapter, "account",
      { received: 0, missing: 1024 });
    expect(result).toEqual({ uploaded: 1024, applied: 464, superseded: 560 });
    expect(serverRecord).toEqual(candidate);
    expect(receipts.size).toBe(1024);
    expect(await persistence.loadJournal()).toBeNull();
    expect(JSON.parse((await persistence.loadCommitted())!).sync.outbox).toEqual([]);
    expect(await legacy.loadJournal()).toBe(journal);
  });
});
