import { describe, expect, it } from "vitest";
import { planSyncSelfRepair, runSyncSelfRepair, canonicalSyncValue } from "./syncSelfRepair";
import { nodeFromV2Value, nodeToV2Value } from "./nodeV2Codec";
import { applyRevisionOperation } from "./revisionModel";
import { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import { TaskMemoV2SyncController } from "./taskMemoV2SyncController";
import { beginSelfRepairDiagnostics, finishSelfRepairDiagnostics, getSelfRepairDiagnostics } from "./selfRepairDiagnostics";
import type { IndexedDbTaskMemoApplicationJournal } from "./indexedDbApplicationStorage";
import type { MemoNode } from "../models/node";
import type { RecoveryConvergenceRequest, SyncAdapter, SyncOperation, VersionedNode } from "./types";

const record = (id: string, title: string, revision = 1): VersionedNode => ({
  value: nodeToV2Value({ id, type: "memo", parentId: null, title, body: "", sortKey: id === "a" ? "a0" : id === "b" ? "b0" : "c0",
    dueAt: null, duePreset: "none", status: "active", completedAt: null, deletedAt: null,
    createdAt: new Date("2026-09-27T00:00:00.000Z"), updatedAt: new Date("2026-09-27T00:00:00.000Z") } satisfies MemoNode),
  revision, lastOpId: `prior:${revision}`, lastDeviceId: "prior", lastLocalSeq: revision,
  operationType: "update",
});

function fixture(local: VersionedNode[], remote: VersionedNode[]) {
  const source = JSON.stringify({ version: 2, deviceId: "local-generation", nextLocalSeq: 8,
    domain: Object.fromEntries(local.map((item) => [item.value.id, item])),
    history: { past: [], future: [] }, sync: { outbox: [{ opId: "new-local:1" }], seenOpIds: [] },
    profile: { pinnedNote: { localBody: "", synced: null, dirtySince: null, migrationPending: false },
      features: { localIdeasEnabled: false, synced: null, migrationPending: false } } });
  let active = source, mode = true, writes = 0, failAfter = Infinity, comparisons = 0;
  const server = new Map(remote.map((item) => [item.value.id, item]));
  const receipts = new Map<string, SyncOperation>();
  const persistence = {
    isLocalRecoveryMode: async () => mode,
    loadCommitted: async () => active,
    loadJournal: async () => null,
    loadLocalRecoveryEvidence: async () => ({ journal: "old-journal", committed: "old-app",
      recoveredAt: "2026-09-27T00:00:00.000Z", archivedOutboxCount: 1024 }),
    completeLocalSelfRepair: async (expected: string, next: string) => {
      if (active !== expected || !mode) throw new Error("local changed");
      active = next; mode = false;
    },
  } as unknown as IndexedDbTaskMemoApplicationJournal;
  const adapter: SyncAdapter = {
    connect: async () => undefined,
    withExclusiveRepair: async (_owner, task) => task(),
    assertExclusiveRepair: async () => undefined,
    upload: async () => { throw new Error("normal upload not needed in fixture"); },
    readRecoverySnapshot: async () => ({ nodes: [...server.values()], receiptDocumentCount: receipts.size }),
    auditOutbox: async (operations) => ({ received: operations.filter((op) =>
      canonicalSyncValue(receipts.get(op.opId)) === canonicalSyncValue(op)).length,
      missing: operations.filter((op) => !receipts.has(op.opId)).length }),
    convergeRecoveryTarget: async (request: RecoveryConvergenceRequest) => {
      comparisons++;
      if (request.diagnosticOnly && request.targetType !== "node") return {};
      if (request.targetType !== "node") throw new Error("unexpected profile change");
      const current = server.get(request.targetNodeId);
      if (canonicalSyncValue(current?.value) === canonicalSyncValue(request.desired)) return {};
      if (canonicalSyncValue(current?.value ?? null) !== canonicalSyncValue(request.observed?.value ?? null))
        throw new Error("concurrent-user-change");
      if (request.diagnosticOnly) return {};
      if (writes === failAfter) throw new Error("interrupted");
      const { deviceId, localSeq, createdAt } = request.identity;
      const operation: SyncOperation = { opId: `${deviceId}:${localSeq}`, deviceId, localSeq,
        targetNodeId: request.targetNodeId, targetType: "node", type: current ? "update" : "create",
        baseRevision: current?.revision ?? 0, payload: { node: request.desired }, createdAt,
        status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null };
      const acknowledgement = applyRevisionOperation(current, operation);
      if (acknowledgement.record) server.set(request.targetNodeId, acknowledgement.record);
      receipts.set(operation.opId, operation); writes++;
      return { operation, acknowledgement };
    },
  };
  return { persistence, adapter, server, receipts, source, get active() { return active; },
    get mode() { return mode; }, get writes() { return writes; }, get comparisons() { return comparisons; },
    set failAfter(value: number) { failAfter = value; } };
}

describe("sync self repair", () => {
  it("diagnostic-only leaves Firebase, receipts, committed local state and isolation unchanged", async () => {
    const state = fixture([record("a", "local")], [record("a", "remote")]);
    await runSyncSelfRepair(state.persistence, state.adapter, undefined, undefined, true);
    expect(state.writes).toBe(0);
    expect(state.receipts.size).toBe(0);
    expect(state.active).toBe(state.source);
    expect(state.mode).toBe(true);
    expect(state.server.get("a")?.value.title).toBe("remote");
  });
  it("keeps the 159-target read-only path at zero writes", async () => {
    const nodes = Array.from({ length: 157 }, (_, index) => record(`memo-${index}`, `memo ${index}`));
    const state = fixture(nodes, nodes.map(node => structuredClone(node)));
    await runSyncSelfRepair(state.persistence, state.adapter, undefined, undefined, true);
    expect(state.comparisons).toBe(159);
    expect(state.writes).toBe(0);
    expect(state.receipts.size).toBe(0);
    expect(state.active).toBe(state.source);
    expect(state.mode).toBe(true);
  });
  it("persists the failing pre-transaction phase and error without touching local evidence", async () => {
    const state = fixture([record("a", "local")], [record("a", "remote")]);
    state.adapter.connect = async () => { throw { code: "permission-denied", message: "gate read denied" }; };
    beginSelfRepairDiagnostics("local-generation", false);
    try {
      await expect(runSyncSelfRepair(state.persistence, state.adapter)).rejects.toMatchObject({ code: "permission-denied" });
      expect(getSelfRepairDiagnostics()).toMatchObject({ failurePhase: "connect",
        errorCode: "permission-denied", errorMessage: "gate read denied",
        failureReason: "permission-denied" });
      expect(getSelfRepairDiagnostics()?.phaseEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ phase: "local-preconditions", status: "complete" }),
        expect.objectContaining({ phase: "connect", status: "start" }),
        expect.objectContaining({ phase: "connect", status: "failed" }),
      ]));
      expect(state.writes).toBe(0);
      expect(state.active).toBe(state.source);
      expect(state.mode).toBe(true);
    } finally { finishSelfRepairDiagnostics("failed"); }
  });
  it("investigation: canonical comparison ignores object key order but retains semantic and representation differences", () => {
    expect(canonicalSyncValue({ title: "a", body: "b" })).toBe(canonicalSyncValue({ body: "b", title: "a" }));
    expect(canonicalSyncValue({ dueAt: undefined })).toBe(canonicalSyncValue({}));
    expect(canonicalSyncValue({ dueAt: null })).not.toBe(canonicalSyncValue({}));
    expect(canonicalSyncValue(["a", "b"])).not.toBe(canonicalSyncValue(["b", "a"]));
    expect(canonicalSyncValue({ updatedAt: new Date(0) })).toBe(canonicalSyncValue({ updatedAt: new Date(0).toISOString() }));
    expect(canonicalSyncValue({ memoType: "task" })).not.toBe(canonicalSyncValue({}));
  });
  it("investigation: planning does not mutate the remote baseline and targets each Node once", () => {
    const local = [record("a", "local"), record("b", "local b")];
    const remote = [record("a", "server"), record("c", "remote only")];
    local[1].value.sortKey = local[0].value.sortKey;
    const saved = structuredClone(remote);
    const plan = planSyncSelfRepair(local, remote);
    expect(remote).toEqual(saved);
    expect(new Set(plan.changedIds).size).toBe(plan.changedIds.length);
  });
  it("replans from the current remote and keeps the current local user value", () => {
    const local = [record("a", "local", 20), record("b", "local only")];
    const remote = [record("a", "old", 24), record("c", "remote only")];
    const plan = planSyncSelfRepair(local, remote);
    expect(plan.desired.get("a")?.value.title).toBe("local");
    expect(plan.desired.get("b")?.value.title).toBe("local only");
    expect(plan.desired.get("c")?.value.title).toBe("⭐⭐⭐remote only");
    expect(plan.changedIds).toEqual(["a", "b", "c"]);
  });

  it("does not resurrect a remote-only tombstone but lets local data restore a common deleted Node", () => {
    const deleted = record("c", "deleted remotely");
    deleted.value.deletedAt = "2026-09-26T00:00:00.000Z";
    const commonDeleted = record("a", "old");
    commonDeleted.value.deletedAt = "2026-09-26T00:00:00.000Z";
    const plan = planSyncSelfRepair([record("a", "local active")], [commonDeleted, deleted]);
    expect(plan.desired.get("a")?.value.deletedAt).toBeNull();
    expect(plan.desired.get("c")?.value.deletedAt).toBe(deleted.value.deletedAt);
    expect(plan.desired.get("c")?.value.title).toBe("deleted remotely");
  });

  it("does not write when remote already matches local, but normalizes only after verification", async () => {
    const same = record("a", "local");
    const state = fixture([same], [same]);
    const result = await runSyncSelfRepair(state.persistence, state.adapter);
    expect(result).toMatchObject({ nodeCount: 1, operationCount: 0, receiptCount: 0,
      archivedOldOutboxCount: 1024 });
    expect(state.writes).toBe(0);
    expect(state.mode).toBe(false);
    expect(JSON.parse(state.active).sync.outbox).toEqual([]);
  });
  it("records server verification success before clearing the active Outbox", async () => {
    const state = fixture([record("a", "local")], [record("a", "old")]);
    beginSelfRepairDiagnostics("local-generation", false);
    try {
      await runSyncSelfRepair(state.persistence, state.adapter);
      expect(getSelfRepairDiagnostics()?.selfRepairVerification).toMatchObject({ status: "success",
        localAuthoritativeNodeCount: 1, remoteNodeCount: 1, differenceCount: 0, serverRead: true });
      expect(JSON.parse(state.active).sync.outbox).toEqual([]);
    } finally { finishSelfRepairDiagnostics("completed"); }
  });

  it.each([1, 2])("restarts from current Firebase after %i committed writes", async (count) => {
    const local = [record("a", "local a"), record("b", "local b"), record("c", "local c")];
    const remote = local.map((item) => record(item.value.id, `old ${item.value.id}`));
    const state = fixture(local, remote);
    state.failAfter = count;
    await expect(runSyncSelfRepair(state.persistence, state.adapter)).rejects.toThrow("interrupted");
    expect(state.writes).toBe(count);
    expect(state.mode).toBe(true);
    expect(state.active).toBe(state.source);
    state.failAfter = Infinity;
    const result = await runSyncSelfRepair(state.persistence, state.adapter);
    expect(result.operationCount).toBe(3 - count);
    expect(state.writes).toBe(3);
    expect(state.mode).toBe(false);
    expect([...state.server.values()].map((item) => item.value.title)).toEqual(["local a", "local b", "local c"]);
  });

  it("keeps remote-only nodes with a marker, adds local-only nodes and repairs duplicate sort keys", async () => {
    const a = record("a", "local"), b = record("b", "local only");
    b.value.sortKey = a.value.sortKey;
    const state = fixture([a, b], [record("a", "old"), record("c", "remote only")]);
    const result = await runSyncSelfRepair(state.persistence, state.adapter);
    expect(result.remoteOnlyCount).toBe(1);
    expect(state.server.get("c")?.value.title).toBe("⭐⭐⭐remote only");
    expect(state.server.has("b")).toBe(true);
    expect(new Set([...state.server.values()].map((item) => item.value.sortKey)).size).toBe(3);
    expect(JSON.parse(state.active).domain.c.value.title).toBe("⭐⭐⭐remote only");
  });

  it("uses the ordinary Outbox upload path for a new memo after convergence", async () => {
    const state = fixture([record("a", "local")], [record("a", "old")]);
    await runSyncSelfRepair(state.persistence, state.adapter);
    const memory = { value: state.active, journal: null as string | null,
      loadCommitted: async () => memory.value, loadJournal: async () => memory.journal,
      writeJournal: async (raw: string) => { memory.journal = raw; },
      writeCommitted: async (raw: string) => { memory.value = raw; },
      clearJournal: async () => { memory.journal = null; } };
    const store = await TaskMemoV2ApplicationStore.open(memory, [], { deviceId: "ignored" });
    const normalUpload: SyncAdapter["upload"] = async (operation) => {
      const acknowledgement = applyRevisionOperation(state.server.get(operation.targetNodeId), operation);
      if (acknowledgement.record) state.server.set(operation.targetNodeId, acknowledgement.record);
      return acknowledgement;
    };
    state.adapter.upload = normalUpload;
    const controller = new TaskMemoV2SyncController(store, state.adapter);
    await controller.start();
    await controller.command("create", "create", (nodes) => [...nodes,
      nodeFromV2Value(record("b", "after repair").value)]);
    expect(state.server.get("b")?.value.title).toBe("after repair");
    expect(store.outbox).toHaveLength(0);
  });

  it("keeps local recovery mode and Outbox when a new receipt cannot be verified", async () => {
    const state = fixture([record("a", "local")], [record("a", "old")]);
    state.adapter.auditOutbox = async (operations) => ({ received: 0, missing: operations.length });
    await expect(runSyncSelfRepair(state.persistence, state.adapter)).rejects.toThrow("Receipt");
    expect(state.mode).toBe(true);
    expect(state.active).toBe(state.source);
    expect(state.server.get("a")?.value.title).toBe("local");
  });

  it("keeps local recovery mode if a new remote node arrives before final verification", async () => {
    const state = fixture([record("a", "local")], [record("a", "old")]);
    const read = state.adapter.readRecoverySnapshot!;
    let reads = 0;
    state.adapter.readRecoverySnapshot = async () => {
      if (++reads === 2) {
        const incoming = record("surprise", "other device");
        incoming.value.sortKey = "a1";
        state.server.set("surprise", incoming);
      }
      return read();
    };
    beginSelfRepairDiagnostics("local-generation", false);
    try {
      await expect(runSyncSelfRepair(state.persistence, state.adapter)).rejects.toThrow("再読込");
      expect(getSelfRepairDiagnostics()?.selfRepairVerification).toMatchObject({ status: "verification-failed",
        differenceCount: 1, differentNodeIds: ["surprise"], serverRead: true });
    } finally { finishSelfRepairDiagnostics("failed"); }
    expect(state.mode).toBe(true);
    expect(state.active).toBe(state.source);
  });
});
