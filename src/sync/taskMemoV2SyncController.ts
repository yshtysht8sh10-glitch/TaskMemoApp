import { initialSyncState, transitionSyncState } from "./stateMachine";
import type { SyncAdapter, SyncFailureKind, SyncOperationType, SyncState } from "./types";
import type { TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import type { Node } from "../models/node";

const classify = (reason: unknown): { kind: SyncFailureKind; message: string } => {
  if (reason && typeof reason === "object" && "kind" in reason) {
    const kind = String(reason.kind);
    if (kind === "offline" || kind === "temporary" || kind === "permanent") return { kind, message: reason instanceof Error ? reason.message : kind };
  }
  return { kind: "temporary", message: reason instanceof Error ? reason.message : String(reason) };
};

/** Dev-only bridge. It is deliberately not imported by the existing v1 React hook. */
export class TaskMemoV2SyncController {
  state: SyncState;
  private unsubscribe?: () => void;
  private running = false;

  constructor(private readonly store: TaskMemoV2ApplicationStore, private readonly adapter: SyncAdapter) {
    this.state = initialSyncState(store.outbox.length);
  }

  async start() {
    this.stop();
    this.state = transitionSyncState(this.state, { type: "connect", pendingCount: this.store.outbox.length });
    try {
      await this.adapter.connect();
      this.unsubscribe = this.adapter.subscribe?.(
        async (record) => { await this.store.receive(record); this.refresh(); },
        (reason) => { const problem = classify(reason); this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.store.outbox.length, ...problem }); },
      );
      this.state = transitionSyncState(this.state, { type: "connected", pendingCount: this.store.outbox.length });
      await this.flush();
    } catch (reason) {
      const problem = classify(reason);
      this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.store.outbox.length, ...problem });
    }
  }

  stop() { this.unsubscribe?.(); this.unsubscribe = undefined; }

  async command(label: string, type: SyncOperationType, transform: (nodes: Node[]) => Node[]) {
    const operations = await this.store.command(label, type, transform);
    if (operations.length) this.state = transitionSyncState(this.state, { type: "local-operation", pendingCount: this.store.outbox.length });
    await this.flush();
    return operations;
  }

  async undo(now?: Date) {
    const operations = await this.store.undo(now);
    if (operations.length) this.state = transitionSyncState(this.state, { type: "local-operation", pendingCount: this.store.outbox.length });
    await this.flush();
    return operations;
  }

  async redo(now?: Date) {
    const operations = await this.store.redo(now);
    if (operations.length) this.state = transitionSyncState(this.state, { type: "local-operation", pendingCount: this.store.outbox.length });
    await this.flush();
    return operations;
  }

  async flush() {
    if (this.running) return;
    this.running = true;
    try {
      for (const operation of this.store.outbox) {
        this.state = transitionSyncState(this.state, { type: "upload-started", pendingCount: this.store.outbox.length, retry: operation.attemptCount > 0 });
        try {
          const acknowledgement = await this.adapter.upload(operation);
          if (acknowledgement.opId !== operation.opId) throw { kind: "permanent", message: "acknowledgement opId mismatch" };
          await this.store.acknowledge(operation.opId, acknowledgement.record);
          this.refresh();
        } catch (reason) {
          const problem = classify(reason);
          this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.store.outbox.length, ...problem });
          return;
        }
      }
    } finally { this.running = false; }
  }

  private refresh() {
    this.state = transitionSyncState(this.state, { type: "acknowledged", pendingCount: this.store.outbox.length });
  }
}
