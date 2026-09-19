import { redoNodeHistory, undoNodeHistory, type NodeHistory, type NodeHistoryEntry } from "../domain/nodeHistory";
import type { Node } from "../models/node";
import { normalizeNodeSortKeys } from "../domain/sortKeys";
import type { ApplicationJournalPersistence } from "./applicationStore";
import { nodeFromV2Value, nodeToV2Value } from "./nodeV2Codec";
import { candidateForOperation, chooseVersionedNode } from "./revisionModel";
import type { SyncNodeValue, SyncOperation, SyncOperationType, VersionedNode } from "./types";

type StoredHistoryEntry = { label: string; before: SyncNodeValue[]; after: SyncNodeValue[] };
type Envelope = {
  version: 2;
  deviceId: string;
  nextLocalSeq: number;
  domain: Record<string, VersionedNode>;
  history: { past: StoredHistoryEntry[]; future: StoredHistoryEntry[] };
  sync: { outbox: SyncOperation[]; seenOpIds: string[] };
};
type Options = { deviceId: string; now?: () => Date; bootstrapInitialNodes?: boolean };

const encodeNodes = (nodes: Node[]) => nodes.map(nodeToV2Value);
const decodeNodes = (nodes: SyncNodeValue[]) => nodes.map(nodeFromV2Value);
const encodeEntry = (entry: NodeHistoryEntry): StoredHistoryEntry => ({ ...entry, before: encodeNodes(entry.before), after: encodeNodes(entry.after) });
const decodeEntry = (entry: StoredHistoryEntry): NodeHistoryEntry => ({ ...entry, before: decodeNodes(entry.before), after: decodeNodes(entry.after) });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class TaskMemoV2ApplicationStore {
  // All envelope mutations share one WAL. Serialize the entire read/modify/write,
  // not just persistence, so listener acknowledgements cannot overwrite UI edits.
  private mutations: Promise<unknown> = Promise.resolve();
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(action);
    this.mutations = next.catch(() => undefined);
    return next;
  }
  private constructor(private readonly persistence: ApplicationJournalPersistence, private envelope: Envelope, private readonly now: () => Date) {}

  static async open(persistence: ApplicationJournalPersistence, initialNodes: Node[], options: Options) {
    const journal = await persistence.loadJournal();
    if (journal) { await persistence.writeCommitted(journal); await persistence.clearJournal(); }
    const committed = journal ?? await persistence.loadCommitted();
    const normalizedInitialNodes = normalizeNodeSortKeys(initialNodes);
    const loadedEnvelope = committed ? JSON.parse(committed) as Envelope : null;
    let envelope: Envelope = loadedEnvelope ?? {
      version: 2, deviceId: options.deviceId, nextLocalSeq: 1,
      domain: Object.fromEntries(normalizedInitialNodes.map((node) => [node.id, { value: nodeToV2Value(node), revision: 0, lastOpId: "initial", lastDeviceId: "initial", lastLocalSeq: 0, operationType: "import" }])),
      history: { past: [], future: [] }, sync: { outbox: [], seenOpIds: [] },
    };
    if (!committed && options.bootstrapInitialNodes) {
      for (const node of normalizedInitialNodes) {
        const localSeq = envelope.nextLocalSeq++;
        const operation: SyncOperation = { opId: `${envelope.deviceId}:${localSeq}`, deviceId: envelope.deviceId, localSeq, targetNodeId: node.id, type: "import", baseRevision: 0, payload: { node: nodeToV2Value(node) }, createdAt: (options.now ?? (() => new Date()))().toISOString(), status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null };
        envelope.domain[node.id] = candidateForOperation(operation);
        envelope.sync.outbox.push(operation);
      }
    }
    const store = new TaskMemoV2ApplicationStore(persistence, envelope, options.now ?? (() => new Date()));
    envelope = store.repairSortKeys(envelope, options.now?.() ?? new Date());
    store.envelope = envelope;
    if (!committed || envelope !== loadedEnvelope) await store.commit(envelope);
    return store;
  }

  get nodes() { return Object.values(this.envelope.domain).map((record) => nodeFromV2Value(record.value)); }
  get outbox() { return [...this.envelope.sync.outbox]; }
  get historyDepths() { return { past: this.envelope.history.past.length, future: this.envelope.history.future.length }; }
  get history(): NodeHistory { return this.nodeHistory(); }
  versionedNode(id: string) { return this.envelope.domain[id]; }

  async command(label: string, type: SyncOperationType, transform: (nodes: Node[]) => Node[], options: { recordHistory?: boolean } = {}) {
    return this.serialize(() => this.commandSerialized(label, type, transform, options));
  }

  private async commandSerialized(label: string, type: SyncOperationType, transform: (nodes: Node[]) => Node[], options: { recordHistory?: boolean }) {
    const before = this.nodes;
    const after = transform(before);
    if (same(encodeNodes(before), encodeNodes(after))) return [];
    const history = options.recordHistory === false ? this.envelope.history : {
      past: [...this.envelope.history.past, encodeEntry({ label, before, after })].slice(-75), future: [],
    };
    return this.apply(type, after, history, this.now());
  }

  async undo(now = this.now()) {
    return this.serialize(() => this.undoSerialized(now));
  }
  private async undoSerialized(now: Date) {
    if (!this.envelope.history.past.length) return [];
    const history = this.nodeHistory();
    const next = undoNodeHistory(history, now);
    return this.apply("undo", next.nodes, { past: next.past.map(encodeEntry), future: next.future.map(encodeEntry) }, now);
  }

  async redo(now = this.now()) {
    return this.serialize(() => this.redoSerialized(now));
  }
  private async redoSerialized(now: Date) {
    if (!this.envelope.history.future.length) return [];
    const next = redoNodeHistory(this.nodeHistory(), now);
    return this.apply("redo", next.nodes, { past: next.past.map(encodeEntry), future: next.future.map(encodeEntry) }, now);
  }

  async receive(incoming: VersionedNode) {
    return this.serialize(() => this.receiveSerialized(incoming));
  }
  private async receiveSerialized(incoming: VersionedNode) {
    if (this.envelope.sync.seenOpIds.includes(incoming.lastOpId)) return "duplicate" as const;
    const selfEcho = incoming.lastDeviceId === this.envelope.deviceId;
    const current = this.envelope.domain[incoming.value.id];
    const winner = selfEcho ? current : chooseVersionedNode(current, incoming);
    let next: Envelope = {
      ...this.envelope,
      domain: winner ? { ...this.envelope.domain, [incoming.value.id]: winner } : this.envelope.domain,
      history: this.envelope.history,
      sync: {
        outbox: selfEcho ? this.envelope.sync.outbox.filter((operation) => operation.opId !== incoming.lastOpId) : this.envelope.sync.outbox,
        seenOpIds: [...this.envelope.sync.seenOpIds, incoming.lastOpId].slice(-500),
      },
    };
    next = this.repairSortKeys(next, this.now());
    await this.commit(next);
    return selfEcho ? "self-echo" as const : "remote" as const;
  }

  async acknowledge(opId: string, record?: VersionedNode) {
    return this.serialize(() => this.acknowledgeSerialized(opId, record));
  }
  private async acknowledgeSerialized(opId: string, record?: VersionedNode) {
    const operation = this.envelope.sync.outbox.find((item) => item.opId === opId);
    let domain = this.envelope.domain;
    if (record && record.lastDeviceId !== this.envelope.deviceId) {
      const current = domain[record.value.id];
      const winner = chooseVersionedNode(current, record);
      domain = { ...domain, [record.value.id]: winner };
    }
    const next: Envelope = {
      ...this.envelope,
      domain,
      history: this.envelope.history,
      sync: {
        outbox: this.envelope.sync.outbox.filter((item) => item.opId !== opId),
        seenOpIds: record ? [...new Set([...this.envelope.sync.seenOpIds, record.lastOpId])].slice(-500) : this.envelope.sync.seenOpIds,
      },
    };
    if (operation || domain !== this.envelope.domain) await this.commit(next);
  }

  private nodeHistory(): NodeHistory {
    return { nodes: this.nodes, past: this.envelope.history.past.map(decodeEntry), future: this.envelope.history.future.map(decodeEntry) };
  }

  private async apply(type: SyncOperationType, nodes: Node[], history: Envelope["history"], commandTime: Date) {
    let localSeq = this.envelope.nextLocalSeq;
    const operations: SyncOperation[] = [];
    const domain = { ...this.envelope.domain };
    const after = new Map(normalizeNodeSortKeys(nodes).map((node) => [node.id, nodeToV2Value(node)]));
    for (const [id, current] of Object.entries(domain)) {
      if (!after.has(id)) after.set(id, { ...current.value, deletedAt: commandTime.toISOString(), deletionBatchId: null });
    }
    for (const [id, value] of after) {
      const current = domain[id];
      if (current && same(current.value, value)) continue;
      const operation: SyncOperation = {
        opId: `${this.envelope.deviceId}:${localSeq}`, deviceId: this.envelope.deviceId, localSeq,
        targetNodeId: id, type, baseRevision: current?.revision ?? 0, payload: { node: value },
        createdAt: commandTime.toISOString(), status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
      };
      localSeq += 1; operations.push(operation); domain[id] = candidateForOperation(operation);
    }
    const next: Envelope = { ...this.envelope, nextLocalSeq: localSeq, domain, history, sync: { ...this.envelope.sync, outbox: [...this.envelope.sync.outbox, ...operations] } };
    await this.commit(next);
    return operations;
  }

  private repairSortKeys(source: Envelope, commandTime: Date) {
    const nodes = Object.values(source.domain).map((record) => nodeFromV2Value(record.value));
    const normalized = normalizeNodeSortKeys(nodes);
    if (same(encodeNodes(nodes), encodeNodes(normalized))) return source;
    let localSeq = source.nextLocalSeq;
    const domain = { ...source.domain };
    const operations: SyncOperation[] = [];
    for (const node of normalized) {
      const current = domain[node.id];
      const value = nodeToV2Value(node);
      if (same(current.value, value)) continue;
      const operation: SyncOperation = {
        opId: `${source.deviceId}:${localSeq}`, deviceId: source.deviceId, localSeq,
        targetNodeId: node.id, type: "update", baseRevision: current.revision, payload: { node: value },
        createdAt: commandTime.toISOString(), status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
      };
      localSeq += 1; operations.push(operation); domain[node.id] = candidateForOperation(operation);
    }
    return { ...source, nextLocalSeq: localSeq, domain, sync: { ...source.sync, outbox: [...source.sync.outbox, ...operations] } };
  }

  private async commit(next: Envelope) {
    const value = JSON.stringify(next);
    await this.persistence.writeJournal(value);
    await this.persistence.writeCommitted(value);
    this.envelope = next;
    await this.persistence.clearJournal();
  }
}
