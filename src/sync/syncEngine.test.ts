import { describe, expect, it } from "vitest";

import type { SyncAdapter, SyncOperation, SyncPersistence } from "./types";
import { DurableOutbox } from "./outbox";
import { SyncEngine } from "./syncEngine";

const payload = (title: string) => ({
  node: { id: "memo", title },
});

class MemoryPersistence implements SyncPersistence {
  value: string | null = null;
  async load() { return this.value; }
  async save(value: string) { this.value = value; }
}

class FakeAdapter implements SyncAdapter {
  online = true;
  uploads: string[] = [];
  applied = new Set<string>();
  failures: ("temporary" | "permanent")[] = [];
  connectPending = false;

  async connect() {
    if (this.connectPending) await new Promise(() => undefined);
    if (!this.online) throw { kind: "offline" };
  }

  async upload(operation: SyncOperation) {
    if (!this.online) throw { kind: "offline" };
    const failure = this.failures.shift();
    if (failure) throw { kind: failure };
    this.uploads.push(operation.opId);
    this.applied.add(operation.opId);
    return { opId: operation.opId };
  }
}

const create = async (persistence = new MemoryPersistence(), adapter = new FakeAdapter()) => {
  const outbox = await DurableOutbox.open(persistence, { idFactory: () => "device-a" });
  return { persistence, adapter, outbox, engine: new SyncEngine(outbox, adapter, { connectTimeoutMs: 10, retryBaseMs: 1, scheduleRetry: () => undefined }) };
};

describe("durable sync engine", () => {
  it("A: online edit uploads, acknowledges, empties outbox, and becomes synced", async () => {
    const { engine, outbox } = await create();
    await engine.start();
    await engine.enqueue({ type: "update", targetNodeId: "memo", payload: payload("B"), createdAt: "2026-09-18T00:00:00.000Z" });
    expect(outbox.operations).toHaveLength(0);
    expect(engine.state).toMatchObject({ phase: "synced", pendingCount: 0 });
  });

  it("B: offline edit keeps local operation pending and never reports synced", async () => {
    const adapter = new FakeAdapter(); adapter.online = false;
    const { engine, outbox } = await create(new MemoryPersistence(), adapter);
    await engine.start();
    await engine.enqueue({ type: "update", targetNodeId: "memo", payload: payload("B"), createdAt: "2026-09-18T00:00:00.000Z" });
    expect(outbox.operations).toHaveLength(1);
    expect(engine.state).toMatchObject({ phase: "offline", pendingCount: 1 });
  });

  it("C: restores an offline operation after restart and uploads it after reconnect", async () => {
    const persistence = new MemoryPersistence();
    const offline = new FakeAdapter(); offline.online = false;
    const first = await create(persistence, offline);
    await first.engine.start();
    const operation = await first.engine.enqueue({ type: "update", targetNodeId: "memo", payload: payload("B"), createdAt: "2026-09-18T00:00:00.000Z" });

    const online = new FakeAdapter();
    const restarted = await create(persistence, online);
    await restarted.engine.start();
    expect(online.uploads).toEqual([operation.opId]);
    expect(restarted.outbox.operations).toHaveLength(0);
    expect(restarted.engine.state.phase).toBe("synced");
  });

  it("D: retains a failed operation and retries it successfully", async () => {
    const adapter = new FakeAdapter(); adapter.failures.push("temporary");
    const persistence = new MemoryPersistence();
    const outbox = await DurableOutbox.open(persistence, { idFactory: () => "device-a" });
    let scheduled: (() => void) | undefined;
    const engine = new SyncEngine(outbox, adapter, { retryBaseMs: 1, scheduleRetry: (callback) => { scheduled = callback; } });
    await engine.start();
    const operation = await engine.enqueue({ type: "update", targetNodeId: "memo", payload: payload("B"), createdAt: "2026-09-18T00:00:00.000Z" });
    expect(outbox.operations[0]).toMatchObject({ opId: operation.opId, attemptCount: 1 });
    expect(engine.state.phase).toBe("retrying");
    scheduled?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outbox.operations).toHaveLength(0);
    expect(engine.state.phase).toBe("synced");
  });

  it("E: duplicate delivery uses the same opId and does not apply twice", async () => {
    const adapter = new FakeAdapter();
    const { engine } = await create(new MemoryPersistence(), adapter);
    await engine.start();
    const operation = await engine.enqueue({ type: "update", targetNodeId: "memo", payload: payload("B"), createdAt: "2026-09-18T00:00:00.000Z" });
    await adapter.upload(operation);
    expect(adapter.applied.size).toBe(1);
  });

  it("F: a connecting timeout leaves connecting and retains pending work", async () => {
    const persistence = new MemoryPersistence();
    const outbox = await DurableOutbox.open(persistence, { idFactory: () => "device-a" });
    await outbox.enqueue({ type: "update", targetNodeId: "memo", payload: payload("B"), createdAt: "2026-09-18T00:00:00.000Z" });
    const adapter = new FakeAdapter(); adapter.connectPending = true;
    const engine = new SyncEngine(outbox, adapter, { connectTimeoutMs: 1, retryBaseMs: 1, scheduleRetry: () => undefined });
    await engine.start();
    expect(engine.state.phase).not.toBe("connecting");
    expect(engine.state).toMatchObject({ phase: "retrying", pendingCount: 1 });
  });

  it("G: pending work can never transition to synced", async () => {
    const adapter = new FakeAdapter(); adapter.failures.push("temporary");
    const { engine } = await create(new MemoryPersistence(), adapter);
    await engine.start();
    await engine.enqueue({ type: "update", targetNodeId: "memo", payload: payload("B"), createdAt: "2026-09-18T00:00:00.000Z" });
    expect(engine.state.pendingCount).toBe(1);
    expect(engine.state.phase).not.toBe("synced");
  });

  it("automatically retries pending offline work after connectivity returns", async () => {
    const adapter = new FakeAdapter(); adapter.online = false;
    const outbox = await DurableOutbox.open(new MemoryPersistence(), { idFactory: () => "device-a" });
    let scheduled: (() => void) | undefined;
    const engine = new SyncEngine(outbox, adapter, { retryBaseMs: 1, scheduleRetry: (callback) => { scheduled = callback; } });
    await engine.start();
    await engine.enqueue({ type: "update", targetNodeId: "memo", payload: payload("B"), createdAt: "2026-09-18T00:00:00.000Z" });
    adapter.online = true;
    scheduled?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outbox.operations).toHaveLength(0);
    expect(engine.state.phase).toBe("synced");
  });

  it("retains a permanently failed operation in error state", async () => {
    const adapter = new FakeAdapter(); adapter.failures.push("permanent");
    const { engine, outbox } = await create(new MemoryPersistence(), adapter);
    await engine.start();
    await engine.enqueue({ type: "purge", targetNodeId: "memo", payload: payload("deleted"), createdAt: "2026-09-18T00:00:00.000Z" });
    expect(engine.state).toMatchObject({ phase: "error", pendingCount: 1 });
    expect(outbox.operations[0]).toMatchObject({ status: "failed", attemptCount: 1 });
  });
});
