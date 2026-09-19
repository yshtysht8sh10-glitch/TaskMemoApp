import { redoNodeHistory, undoNodeHistory, type NodeHistory, type NodeHistoryEntry } from "../domain/nodeHistory";
import type { Node } from "../models/node";
import { normalizeNodeSortKeys } from "../domain/sortKeys";
import type { ApplicationJournalPersistence } from "./applicationStore";
import { nodeFromV2Value, nodeToV2Value } from "./nodeV2Codec";
import { candidateForOperation, candidateForPinnedNoteOperation, chooseVersionedNode, chooseVersionedPinnedNote } from "./revisionModel";
import type { SyncNodeValue, SyncOperation, SyncOperationType, VersionedNode, VersionedPinnedNote } from "./types";

type StoredHistoryEntry = { label: string; before: SyncNodeValue[]; after: SyncNodeValue[] };
type Envelope = {
  version: 2;
  deviceId: string;
  nextLocalSeq: number;
  domain: Record<string, VersionedNode>;
  history: { past: StoredHistoryEntry[]; future: StoredHistoryEntry[] };
  sync: { outbox: SyncOperation[]; seenOpIds: string[] };
  profile: {
    pinnedNote: { localBody: string; synced: VersionedPinnedNote | null; dirtySince: string | null; migrationPending: boolean; legacyUpdatedAt: string | null };
    legacyPinnedNoteCandidates: { body: string; updatedAt: string }[];
  };
};
type Options = { deviceId: string; now?: () => Date; bootstrapInitialNodes?: boolean; initialPinnedNote?: { body: string; updatedAt: Date } };

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
      profile: {
        pinnedNote: { localBody: options.initialPinnedNote?.body ?? "", synced: null, dirtySince: null, migrationPending: Boolean(options.initialPinnedNote?.body), legacyUpdatedAt: options.initialPinnedNote?.updatedAt.toISOString() ?? null },
        legacyPinnedNoteCandidates: [],
      },
    };
    if (!envelope.profile) envelope = {
      ...envelope,
      profile: {
        pinnedNote: { localBody: options.initialPinnedNote?.body ?? "", synced: null, dirtySince: null, migrationPending: Boolean(options.initialPinnedNote?.body), legacyUpdatedAt: options.initialPinnedNote?.updatedAt.toISOString() ?? null },
        legacyPinnedNoteCandidates: [],
      },
    };
    if (envelope.profile.pinnedNote.legacyUpdatedAt === undefined) envelope = {
      ...envelope,
      profile: { ...envelope.profile, pinnedNote: { ...envelope.profile.pinnedNote, legacyUpdatedAt: null } },
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
  get pendingCount() { return this.envelope.sync.outbox.length + (this.envelope.profile.pinnedNote.dirtySince ? 1 : 0); }
  get historyDepths() { return { past: this.envelope.history.past.length, future: this.envelope.history.future.length }; }
  get history(): NodeHistory { return this.nodeHistory(); }
  get pinnedNote() { return { body: this.envelope.profile.pinnedNote.localBody }; }
  get legacyPinnedNoteCandidates() { return [...this.envelope.profile.legacyPinnedNoteCandidates]; }
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

  async initializePinnedNote(remote?: VersionedPinnedNote) {
    return this.serialize(async () => {
      const profile = this.envelope.profile;
      const pinned = profile.pinnedNote;
      let nextPinned = pinned;
      let candidates = profile.legacyPinnedNoteCandidates;
      if (pinned.migrationPending) {
        if (!remote) nextPinned = { ...pinned, dirtySince: pinned.localBody ? this.now().toISOString() : null, migrationPending: false, legacyUpdatedAt: null };
        else if (!pinned.localBody || pinned.localBody === remote.value.body) nextPinned = { localBody: remote.value.body, synced: remote, dirtySince: null, migrationPending: false, legacyUpdatedAt: null };
        else {
          const updatedAt = pinned.legacyUpdatedAt ?? this.now().toISOString();
          candidates = [...candidates, { body: pinned.localBody, updatedAt }];
          nextPinned = { localBody: remote.value.body, synced: remote, dirtySince: null, migrationPending: false, legacyUpdatedAt: null };
        }
      } else if (remote) {
        const winner = chooseVersionedPinnedNote(pinned.synced ?? undefined, remote);
        nextPinned = { ...pinned, synced: winner, localBody: pinned.dirtySince ? pinned.localBody : winner.value.body };
      }
      const next = { ...this.envelope, profile: { pinnedNote: nextPinned, legacyPinnedNoteCandidates: candidates } };
      if (!same(next, this.envelope)) await this.commit(next);
    });
  }

  async setPinnedNoteDraft(body: string, now = this.now()) {
    return this.serialize(async () => {
      const current = this.envelope.profile.pinnedNote;
      if (current.localBody === body) return;
      await this.commit({ ...this.envelope, profile: { ...this.envelope.profile, pinnedNote: { ...current, localBody: body, dirtySince: now.toISOString(), migrationPending: false } } });
    });
  }

  async queuePinnedNoteOperation(now = this.now()) {
    return this.serialize(async () => {
      const current = this.envelope.profile.pinnedNote;
      if (!current.dirtySince) return undefined;
      const localSeq = this.envelope.nextLocalSeq;
      const operation: SyncOperation = {
        opId: `${this.envelope.deviceId}:${localSeq}`, deviceId: this.envelope.deviceId, localSeq,
        targetNodeId: "pinnedNote", targetType: "pinnedNote", type: "update", baseRevision: current.synced?.revision ?? 0,
        payload: { pinnedNote: { body: current.localBody } }, createdAt: now.toISOString(), status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
      };
      const synced = candidateForPinnedNoteOperation(operation);
      await this.commit({ ...this.envelope, nextLocalSeq: localSeq + 1, profile: { ...this.envelope.profile, pinnedNote: { ...current, synced, dirtySince: null } }, sync: { ...this.envelope.sync, outbox: [...this.envelope.sync.outbox, operation] } });
      return operation;
    });
  }

  async receivePinnedNote(incoming: VersionedPinnedNote) {
    return this.serialize(async () => {
      if (this.envelope.sync.seenOpIds.includes(incoming.lastOpId)) return "duplicate" as const;
      const current = this.envelope.profile.pinnedNote;
      const selfEcho = incoming.lastDeviceId === this.envelope.deviceId;
      const winner = selfEcho ? current.synced : chooseVersionedPinnedNote(current.synced ?? undefined, incoming);
      const pinnedNote = { ...current, synced: winner ?? current.synced, localBody: current.dirtySince ? current.localBody : (winner?.value.body ?? current.localBody) };
      await this.commit({ ...this.envelope, profile: { ...this.envelope.profile, pinnedNote }, sync: {
        outbox: selfEcho ? this.envelope.sync.outbox.filter((operation) => operation.opId !== incoming.lastOpId) : this.envelope.sync.outbox,
        seenOpIds: [...this.envelope.sync.seenOpIds, incoming.lastOpId].slice(-500),
      } });
      return selfEcho ? "self-echo" as const : "remote" as const;
    });
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

  async acknowledge(opId: string, record?: VersionedNode, pinnedNoteRecord?: VersionedPinnedNote) {
    return this.serialize(() => this.acknowledgeSerialized(opId, record, pinnedNoteRecord));
  }
  private async acknowledgeSerialized(opId: string, record?: VersionedNode, pinnedNoteRecord?: VersionedPinnedNote) {
    const operation = this.envelope.sync.outbox.find((item) => item.opId === opId);
    let domain = this.envelope.domain;
    if (record && record.lastDeviceId !== this.envelope.deviceId) {
      const current = domain[record.value.id];
      const winner = chooseVersionedNode(current, record);
      domain = { ...domain, [record.value.id]: winner };
    }
    let profile = this.envelope.profile;
    if (pinnedNoteRecord) {
      const current = profile.pinnedNote;
      const winner = chooseVersionedPinnedNote(current.synced ?? undefined, pinnedNoteRecord);
      profile = { ...profile, pinnedNote: { ...current, synced: winner, localBody: current.dirtySince ? current.localBody : winner.value.body } };
    }
    const next: Envelope = {
      ...this.envelope,
      domain,
      profile,
      history: this.envelope.history,
      sync: {
        outbox: this.envelope.sync.outbox.filter((item) => item.opId !== opId),
        seenOpIds: record || pinnedNoteRecord ? [...new Set([...this.envelope.sync.seenOpIds, (record ?? pinnedNoteRecord)!.lastOpId])].slice(-500) : this.envelope.sync.seenOpIds,
      },
    };
    if (operation || domain !== this.envelope.domain || profile !== this.envelope.profile) await this.commit(next);
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
