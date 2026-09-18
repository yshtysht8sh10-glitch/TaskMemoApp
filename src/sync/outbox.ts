import type { NewSyncOperation, SyncOperation, SyncPersistence } from "./types";

type OutboxEnvelope = {
  version: 1;
  deviceId: string;
  nextLocalSeq: number;
  operations: SyncOperation[];
};

type OutboxOptions = { idFactory?: () => string };

const defaultId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function parseEnvelope(raw: string | null): OutboxEnvelope | null {
  if (!raw) return null;
  const value = JSON.parse(raw) as Partial<OutboxEnvelope>;
  if (value.version !== 1 || typeof value.deviceId !== "string" ||
      !Number.isInteger(value.nextLocalSeq) || !Array.isArray(value.operations)) {
    throw new Error("同期outboxの保存形式が不正です。");
  }
  return value as OutboxEnvelope;
}

export class DurableOutbox {
  private constructor(
    private readonly persistence: SyncPersistence,
    private envelope: OutboxEnvelope,
  ) {}

  static async open(persistence: SyncPersistence, options: OutboxOptions = {}) {
    const saved = parseEnvelope(await persistence.load());
    const envelope: OutboxEnvelope = saved ?? {
      version: 1,
      deviceId: (options.idFactory ?? defaultId)(),
      nextLocalSeq: 1,
      operations: [],
    };
    const outbox = new DurableOutbox(persistence, envelope);
    if (!saved) await outbox.persist();
    return outbox;
  }

  get deviceId() { return this.envelope.deviceId; }
  get operations() { return [...this.envelope.operations]; }

  async enqueue(input: NewSyncOperation) {
    const localSeq = this.envelope.nextLocalSeq;
    const operation: SyncOperation = {
      ...input,
      baseRevision: input.baseRevision ?? 0,
      opId: `${this.envelope.deviceId}:${localSeq}`,
      deviceId: this.envelope.deviceId,
      localSeq,
      status: "pending",
      attemptCount: 0,
      nextRetryAt: null,
      lastError: null,
    };
    this.envelope = {
      ...this.envelope,
      nextLocalSeq: localSeq + 1,
      operations: [...this.envelope.operations, operation],
    };
    await this.persist();
    return operation;
  }

  async acknowledge(opId: string) {
    this.envelope = { ...this.envelope, operations: this.envelope.operations.filter((operation) => operation.opId !== opId) };
    await this.persist();
  }

  async recordFailure(opId: string, message: string, nextRetryAt: string | null, permanent: boolean) {
    this.envelope = {
      ...this.envelope,
      operations: this.envelope.operations.map((operation) => operation.opId === opId ? {
        ...operation,
        status: permanent ? "failed" : "retrying",
        attemptCount: operation.attemptCount + 1,
        nextRetryAt,
        lastError: message,
      } : operation),
    };
    await this.persist();
  }

  private persist() { return this.persistence.save(JSON.stringify(this.envelope)); }
}
