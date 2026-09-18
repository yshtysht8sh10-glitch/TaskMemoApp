import type { SyncNodeValue, SyncOperation, SyncOperationType, VersionedNode } from "./types";
import { candidateForOperation, receiveVersionedNode } from "./revisionModel";

export interface ApplicationJournalPersistence {
  loadCommitted(): Promise<string | null>;
  loadJournal(): Promise<string | null>;
  writeJournal(value: string): Promise<void>;
  writeCommitted(value: string): Promise<void>;
  clearJournal(): Promise<void>;
}

type HistoryEntry = { targetNodeId: string; before: SyncNodeValue; after: SyncNodeValue };
type ApplicationEnvelope = {
  version: 1;
  deviceId: string;
  nextLocalSeq: number;
  domain: Record<string, VersionedNode>;
  history: { past: HistoryEntry[]; future: HistoryEntry[] };
  sync: { outbox: SyncOperation[]; seenOpIds: string[] };
};
type StoreOptions = { idFactory?: () => string };

const defaultId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const parse = (raw: string) => JSON.parse(raw) as ApplicationEnvelope;

export class V2ApplicationStore {
  private constructor(private readonly persistence: ApplicationJournalPersistence, private envelope: ApplicationEnvelope) {}

  static async open(persistence: ApplicationJournalPersistence, initialNodes: SyncNodeValue[], options: StoreOptions = {}) {
    const journal = await persistence.loadJournal();
    if (journal) {
      await persistence.writeCommitted(journal);
      await persistence.clearJournal();
    }
    const committed = journal ?? await persistence.loadCommitted();
    const deviceId = (options.idFactory ?? defaultId)();
    const envelope = committed ? parse(committed) : {
      version: 1 as const,
      deviceId,
      nextLocalSeq: 1,
      domain: Object.fromEntries(initialNodes.map((value) => [value.id, {
        value, revision: 0, lastOpId: "initial", lastDeviceId: "initial", lastLocalSeq: 0, operationType: "import" as const,
      }])),
      history: { past: [], future: [] },
      sync: { outbox: [], seenOpIds: [] },
    };
    const store = new V2ApplicationStore(persistence, envelope);
    if (!committed) await store.commit(envelope);
    return store;
  }

  get outbox() { return [...this.envelope.sync.outbox]; }
  get historyDepths() { return { past: this.envelope.history.past.length, future: this.envelope.history.future.length }; }
  node(id: string) { return this.envelope.domain[id]; }

  async receive(incoming: VersionedNode) {
    const current = this.envelope.domain[incoming.value.id];
    if (!current) throw new Error("未作成Nodeのremote受信は次Phaseで扱います。");
    const received = receiveVersionedNode({
      deviceId: this.envelope.deviceId,
      current,
      seenOpIds: new Set(this.envelope.sync.seenOpIds),
      historyRevision: this.envelope.history.past.length + this.envelope.history.future.length,
    }, incoming);
    if (received.kind === "duplicate") return received.kind;
    const next: ApplicationEnvelope = {
      ...this.envelope,
      domain: received.kind === "remote"
        ? { ...this.envelope.domain, [incoming.value.id]: received.current }
        : this.envelope.domain,
      history: this.envelope.history,
      sync: {
        outbox: received.kind === "self-echo"
          ? this.envelope.sync.outbox.filter((operation) => operation.opId !== incoming.lastOpId)
          : this.envelope.sync.outbox,
        seenOpIds: [...received.seenOpIds].slice(-200),
      },
    };
    await this.commit(next);
    return received.kind;
  }

  async execute(type: SyncOperationType, targetNodeId: string, value: SyncNodeValue) {
    const current = this.envelope.domain[targetNodeId];
    if (!current) throw new Error("同期command対象のNodeがありません。");
    const history = {
      past: [...this.envelope.history.past, { targetNodeId, before: current.value, after: value }],
      future: [],
    };
    return this.applyCommand(type, targetNodeId, value, history);
  }

  async undo() {
    const entry = this.envelope.history.past.at(-1);
    if (!entry) return null;
    return this.applyCommand("undo", entry.targetNodeId, entry.before, {
      past: this.envelope.history.past.slice(0, -1),
      future: [entry, ...this.envelope.history.future],
    });
  }

  async redo() {
    const [entry, ...future] = this.envelope.history.future;
    if (!entry) return null;
    return this.applyCommand("redo", entry.targetNodeId, entry.after, {
      past: [...this.envelope.history.past, entry],
      future,
    });
  }

  private async applyCommand(type: SyncOperationType, targetNodeId: string, value: SyncNodeValue, history: ApplicationEnvelope["history"]) {
    const current = this.envelope.domain[targetNodeId];
    const localSeq = this.envelope.nextLocalSeq;
    const operation: SyncOperation = {
      opId: `${this.envelope.deviceId}:${localSeq}`,
      deviceId: this.envelope.deviceId,
      localSeq,
      targetNodeId,
      type,
      baseRevision: current.revision,
      payload: { node: value },
      createdAt: new Date().toISOString(),
      status: "pending",
      attemptCount: 0,
      nextRetryAt: null,
      lastError: null,
    };
    const next: ApplicationEnvelope = {
      ...this.envelope,
      nextLocalSeq: localSeq + 1,
      domain: { ...this.envelope.domain, [targetNodeId]: candidateForOperation(operation) },
      history,
      sync: { ...this.envelope.sync, outbox: [...this.envelope.sync.outbox, operation] },
    };
    await this.commit(next);
    return operation;
  }

  private async commit(next: ApplicationEnvelope) {
    const serialized = JSON.stringify(next);
    await this.persistence.writeJournal(serialized);
    await this.persistence.writeCommitted(serialized);
    this.envelope = next;
    await this.persistence.clearJournal();
  }
}
