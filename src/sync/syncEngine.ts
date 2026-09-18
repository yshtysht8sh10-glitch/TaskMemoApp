import { DurableOutbox } from "./outbox";
import { initialSyncState, transitionSyncState } from "./stateMachine";
import type { NewSyncOperation, SyncAdapter, SyncFailureKind, SyncState } from "./types";

type EngineOptions = {
  connectTimeoutMs?: number;
  retryBaseMs?: number;
  maxAttempts?: number;
  scheduleRetry?: (callback: () => void, delayMs: number) => unknown;
};

const failure = (reason: unknown): { kind: SyncFailureKind; message: string } => {
  if (reason && typeof reason === "object" && "kind" in reason) {
    const kind = String(reason.kind);
    if (kind === "offline" || kind === "temporary" || kind === "permanent")
      return { kind, message: reason instanceof Error ? reason.message : kind };
  }
  return { kind: "temporary", message: reason instanceof Error ? reason.message : String(reason) };
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject({ kind: "temporary", message: "connection timeout" }), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (reason) => { clearTimeout(timer); reject(reason); });
  });
}

export class SyncEngine {
  state: SyncState;
  private connected = false;
  private syncing = false;
  private retryScheduled = false;
  private readonly options: Required<Omit<EngineOptions, "scheduleRetry">> & Pick<EngineOptions, "scheduleRetry">;

  constructor(
    readonly outbox: DurableOutbox,
    private readonly adapter: SyncAdapter,
    options: EngineOptions = {},
  ) {
    this.state = initialSyncState(outbox.operations.length);
    this.options = {
      connectTimeoutMs: options.connectTimeoutMs ?? 15_000,
      retryBaseMs: options.retryBaseMs ?? 1_000,
      maxAttempts: options.maxAttempts ?? 5,
      scheduleRetry: options.scheduleRetry ?? ((callback, delayMs) => setTimeout(callback, delayMs)),
    };
  }

  async start() {
    await this.connect(false);
  }

  private async connect(retry: boolean) {
    this.state = transitionSyncState(this.state, retry
      ? { type: "upload-started", pendingCount: this.outbox.operations.length, retry: true }
      : { type: "connect", pendingCount: this.outbox.operations.length });
    try {
      await withTimeout(this.adapter.connect(), this.options.connectTimeoutMs);
      this.connected = true;
      this.state = transitionSyncState(this.state, { type: "connected", pendingCount: this.outbox.operations.length });
      await this.flush();
    } catch (reason) {
      const problem = failure(reason);
      this.connected = false;
      this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.outbox.operations.length, ...problem });
      if (problem.kind !== "permanent") this.scheduleRetry();
    }
  }

  async enqueue(input: NewSyncOperation) {
    const operation = await this.outbox.enqueue(input);
    this.state = this.state.phase === "offline"
      ? { ...this.state, pendingCount: this.outbox.operations.length }
      : transitionSyncState(this.state, { type: "local-operation", pendingCount: this.outbox.operations.length });
    if (this.connected) await this.flush();
    return operation;
  }

  async retryNow() {
    this.retryScheduled = false;
    if (!this.connected) {
      await this.connect(true);
      return;
    }
    await this.flush(true);
  }

  private async flush(retry = false) {
    if (!this.connected || this.syncing) return;
    this.syncing = true;
    try {
      while (this.outbox.operations.length) {
        const operation = this.outbox.operations[0];
        if (operation.status === "failed") {
          this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.outbox.operations.length, kind: "permanent", message: operation.lastError ?? "permanent failure" });
          return;
        }
        this.state = transitionSyncState(this.state, { type: "upload-started", pendingCount: this.outbox.operations.length, retry });
        try {
          const acknowledgement = await this.adapter.upload(operation);
          if (acknowledgement.opId !== operation.opId) throw { kind: "permanent", message: "acknowledgement opId mismatch" };
          await this.outbox.acknowledge(operation.opId);
          this.state = transitionSyncState(this.state, { type: "acknowledged", pendingCount: this.outbox.operations.length });
        } catch (reason) {
          const problem = failure(reason);
          const permanent = problem.kind === "permanent" || operation.attemptCount + 1 >= this.options.maxAttempts;
          const delay = this.options.retryBaseMs * 2 ** operation.attemptCount;
          await this.outbox.recordFailure(operation.opId, problem.message, permanent ? null : new Date(Date.now() + delay).toISOString(), permanent);
          const kind = permanent ? "permanent" : problem.kind;
          if (kind === "offline") this.connected = false;
          this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.outbox.operations.length, kind, message: problem.message });
          if (kind !== "permanent") this.scheduleRetry(delay);
          return;
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  private scheduleRetry(delayMs = this.options.retryBaseMs) {
    if (this.retryScheduled || !this.options.scheduleRetry) return;
    this.retryScheduled = true;
    this.options.scheduleRetry(() => { void this.retryNow(); }, delayMs);
  }
}
