import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFirebaseSyncAdapter, type RecoveryTransactionEvent } from "./firebaseSyncAdapter";
import { applyRevisionOperation } from "./revisionModel";
import { recoveryFailureDetails } from "./recoveryFailure";
import type { SyncOperation } from "./types";
import { beginSelfRepairDiagnostics, finishSelfRepairDiagnostics, getSelfRepairDiagnostics } from "./selfRepairDiagnostics";

const state = vi.hoisted(() => ({ documents: new Map<string, unknown>(), sdkFailure: null as unknown,
  writes: 0 }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join("/"),
  serverTimestamp: () => "server-time",
  runTransaction: async (_db: unknown, action: (transaction: unknown) => Promise<unknown>) => {
    if (state.sdkFailure) throw state.sdkFailure;
    const pending: { path: string; value: unknown }[] = [];
    const transaction = {
      get: async (path: string) => ({ exists: () => state.documents.has(path), data: () => state.documents.get(path) }),
      set: (path: string, value: unknown) => { pending.push({ path, value }); },
    };
    const result = await action(transaction);
    for (const write of pending) { state.documents.set(write.path, write.value); state.writes++; }
    return result;
  },
}));

const operation: SyncOperation = { opId: "device:1", deviceId: "device", localSeq: 1,
  targetNodeId: "node-1", type: "create", baseRevision: 0,
  payload: { node: { id: "node-1", title: "private title" } },
  createdAt: "2026-09-26T00:00:00.000Z", status: "pending", attemptCount: 0,
  nextRetryAt: null, lastError: null };
const receiptPath = "users/uid/syncOperationsV2/device:1";
const nodePath = "users/uid/nodesV2/node-1";

describe("recovery transaction diagnostics", () => {
  beforeEach(() => { state.documents.clear(); state.sdkFailure = null; state.writes = 0; });

  const adapter = (events: RecoveryTransactionEvent[]) => createFirebaseSyncAdapter(
    { app: { options: { projectId: "taskmemoapp-eabc3" } } } as never, "uid", "production",
    { onRecoveryTransaction: (event) => events.push(event) });

  it("classifies an internally rejected predicted winner before writing", async () => {
    const events: RecoveryTransactionEvent[] = [];
    const expected = { ...applyRevisionOperation(undefined, operation), revision: 999 };
    await expect(adapter(events).upload(operation, expected)).rejects.toMatchObject({
      kind: "permanent", code: "invalid-argument", recoveryReason: "predicted-winner-mismatch",
      message: "recovery winner differs from preflight",
    });
    expect(events.map((event) => event.phase)).toEqual(["start", "failure"]);
    expect(state.writes).toBe(0);
  });

  it("rejects a changed target baseline even if the predicted acknowledgement would still match", async () => {
    const expected = applyRevisionOperation(undefined, operation);
    const intervening = { ...expected.record!, revision: 0, lastOpId: "intervening" };
    state.documents.set(nodePath, { record: intervening });
    await expect(adapter([]).upload(operation, expected, null)).rejects.toMatchObject({
      kind: "permanent", code: "invalid-argument", recoveryReason: "predicted-base-mismatch",
    });
    expect(state.writes).toBe(0);
    expect(state.documents.has(receiptPath)).toBe(false);
  });

  it("distinguishes existing receipt payload and acknowledgement mismatches", async () => {
    const events: RecoveryTransactionEvent[] = [];
    const expected = applyRevisionOperation(undefined, operation);
    state.documents.set(receiptPath, { operation: { ...operation, payload: { node: { id: "node-1", title: "other" } } },
      acknowledgement: expected });
    await expect(adapter(events).upload(operation, expected)).rejects.toMatchObject({
      code: "invalid-argument", recoveryReason: "receipt-payload-mismatch" });
    state.documents.set(receiptPath, { operation, acknowledgement: { ...expected, revision: 2 } });
    await expect(adapter(events).upload(operation, expected)).rejects.toMatchObject({
      code: "invalid-argument", recoveryReason: "receipt-acknowledgement-mismatch" });
    expect(state.writes).toBe(0);
  });

  it("preserves Firestore SDK code/message and counts only committed receipt and Node writes", async () => {
    const events: RecoveryTransactionEvent[] = [];
    state.sdkFailure = Object.assign(new Error("SDK transaction denied"), { code: "permission-denied" });
    await expect(adapter(events).upload(operation, applyRevisionOperation(undefined, operation)))
      .rejects.toMatchObject({ kind: "permanent", code: "permission-denied", message: "SDK transaction denied" });
    expect(events).toMatchObject([{ phase: "failure" }]);
    state.sdkFailure = null;
    const actual = await adapter(events).upload(operation, applyRevisionOperation(undefined, operation));
    expect(actual.result).toBe("applied");
    expect(state.documents.has(nodePath)).toBe(true);
    expect(state.documents.has(receiptPath)).toBe(true);
    expect(events.at(-1)).toMatchObject({ phase: "success", receipt: "created", nodeWrite: true });
    await adapter(events).upload(operation, actual);
    expect(events.at(-1)).toMatchObject({ phase: "success", receipt: "existing", nodeWrite: false });
    expect(state.writes).toBe(2);
  });

  it("records a server-winner receipt without attributing a Node write", async () => {
    const events: RecoveryTransactionEvent[] = [];
    const winner = { ...applyRevisionOperation(undefined, operation).record!, revision: 10,
      lastOpId: "newer:10" };
    state.documents.set(nodePath, { record: winner });
    const expected = applyRevisionOperation(winner, operation);
    expect(expected.result).toBe("superseded");
    await adapter(events).upload(operation, expected);
    expect(events.at(-1)).toMatchObject({ phase: "success", receipt: "created",
      nodeWrite: false, serverWinnerNoWrite: true });
    expect(state.writes).toBe(1);
    expect(state.documents.get(nodePath)).toEqual({ record: winner });
  });

  it("retains the SDK origin after an invalid-argument error is normalized", async () => {
    state.sdkFailure = Object.assign(new Error("private SDK document path"), { code: "invalid-argument" });
    const failure = await adapter([]).upload(operation, applyRevisionOperation(undefined, operation))
      .catch((reason: unknown) => reason);
    expect(failure).toMatchObject({ kind: "permanent", code: "invalid-argument",
      firestoreSdkError: true });
    expect(recoveryFailureDetails(failure)).toMatchObject({ errorCode: "invalid-argument",
      failureReason: "firestore-sdk-error", errorMessage: "Firestore returned an error during recovery." });
  });

  it("rebases self repair on live revision and confirms an existing receipt without a second write", async () => {
    const observed = { ...applyRevisionOperation(undefined, operation).record!, revision: 4,
      lastOpId: "older:4", value: { id: "node-1", title: "old" } };
    state.documents.set(nodePath, { ownerUid: "uid", schemaVersion: 2, record: { ...observed, revision: 8 } });
    const request = { targetType: "node" as const, targetNodeId: "node-1",
      desired: { id: "node-1", title: "local" }, observed,
      identity: { deviceId: "sync-self-repair-device", localSeq: 1, createdAt: "2026-09-27T00:00:00.000Z" } };
    const first = await adapter([]).convergeRecoveryTarget!(request);
    expect(first.operation?.baseRevision).toBe(8);
    expect(first.acknowledgement?.record?.revision).toBe(9);
    expect(state.writes).toBe(2);
    const again = await adapter([]).convergeRecoveryTarget!(request);
    expect(again.operation).toEqual(first.operation);
    expect(state.writes).toBe(2);
  });

  it("does not write if Firebase already has the desired value", async () => {
    const current = { ...applyRevisionOperation(undefined, operation).record!,
      value: { id: "node-1", title: "local" } };
    state.documents.set(nodePath, { ownerUid: "uid", schemaVersion: 2, record: current });
    const result = await adapter([]).convergeRecoveryTarget!({ targetType: "node", targetNodeId: "node-1",
      desired: current.value, observed: null,
      identity: { deviceId: "sync-self-repair-device", localSeq: 1, createdAt: "2026-09-27T00:00:00.000Z" } });
    expect(result.operation).toBeUndefined();
    expect(state.writes).toBe(0);
  });

  it("stops before writing when another device changes user data inside the transaction", async () => {
    const observed = { ...applyRevisionOperation(undefined, operation).record!,
      value: { id: "node-1", title: "old" } };
    state.documents.set(nodePath, { ownerUid: "uid", schemaVersion: 2,
      record: { ...observed, revision: 3, value: { id: "node-1", title: "other device" } } });
    await expect(adapter([]).convergeRecoveryTarget!({ targetType: "node", targetNodeId: "node-1",
      desired: { id: "node-1", title: "local" }, observed,
      identity: { deviceId: "sync-self-repair-device", localSeq: 1, createdAt: "2026-09-27T00:00:00.000Z" } }))
      .rejects.toMatchObject({ recoveryReason: "concurrent-user-change" });
    expect(state.writes).toBe(0);
  });
  it("diagnostic-only compares a changed desired target without writing Node or Receipt", async () => {
    const current = applyRevisionOperation(undefined, operation).record!;
    state.documents.set(nodePath, { ownerUid: "uid", schemaVersion: 2, record: current });
    beginSelfRepairDiagnostics("local", true);
    await adapter([]).convergeRecoveryTarget!({ targetType: "node", targetNodeId: "node-1",
      desired: { ...current.value, title: "local" }, observed: current, diagnosticOnly: true,
      identity: { deviceId: "sync-self-repair-diagnostic", localSeq: 1, createdAt: operation.createdAt } });
    expect(state.writes).toBe(0);
    expect(getSelfRepairDiagnostics()?.lastComparison?.outcome).toBe("baseline-match");
    finishSelfRepairDiagnostics("diagnosed");
  });
  it("identifies updatedAt-only mismatch even with unchanged actor and revision, without claiming another device", async () => {
    const before = { ...applyRevisionOperation(undefined, operation).record!,
      value: { id: "node-1", title: "private", updatedAt: "2026-09-26" } };
    state.documents.set(nodePath, { ownerUid: "uid", schemaVersion: 2,
      record: { ...before, value: { ...before.value, updatedAt: "2026-09-27" } } });
    beginSelfRepairDiagnostics("local", true);
    const error = await adapter([]).convergeRecoveryTarget!({ targetType: "node", targetNodeId: "node-1",
      desired: { ...before.value, title: "local" }, observed: before, diagnosticOnly: true,
      identity: { deviceId: "sync-self-repair-diagnostic", localSeq: 1, createdAt: operation.createdAt } }).catch(e => e);
    expect(error.recoveryReason).toBe("concurrent-user-change");
    expect(error.message).not.toContain("他端末");
    expect(getSelfRepairDiagnostics()?.conflict).toMatchObject({ differentFields: ["updatedAt"],
      beforeMetadata: { revision: 1, lastDeviceId: "device" }, afterMetadata: { revision: 1, lastDeviceId: "device" } });
    expect(state.writes).toBe(0);
    finishSelfRepairDiagnostics("failed");
  });
});
