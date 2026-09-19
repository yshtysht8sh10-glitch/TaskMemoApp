import type { NodeHistory } from "../domain/nodeHistory";
import type { Node } from "../models/node";
import { normalizeNodeSortKeys } from "../domain/sortKeys";
import type { ApplicationJournalPersistence } from "./applicationStore";
import { nodeFromV2Value, nodeToV2Value } from "./nodeV2Codec";
import { candidateForOperation, candidateForPinnedNoteOperation, chooseVersionedNode, chooseVersionedPinnedNote } from "./revisionModel";
import type { SyncNodeValue, SyncOperation, SyncOperationType, VersionedNode, VersionedPinnedNote } from "./types";

type NodeHistoryTarget = {
  resourceType: "node";
  resourceId: string;
  before: SyncNodeValue | null;
  after: SyncNodeValue;
  forwardOpId: string;
  forwardRevision: number;
  undoOpId?: string;
  undoRevision?: number;
};
type PinnedNoteHistoryTarget = {
  resourceType: "pinnedNote";
  resourceId: "pinnedNote";
  before: { body: string };
  after: { body: string };
  forwardOpId: string | null;
  forwardRevision: number;
  undoOpId?: string;
  undoRevision?: number;
};
type HistoryTarget = NodeHistoryTarget | PinnedNoteHistoryTarget;
type StoredHistoryEntry = {
  commandId: string;
  label: string;
  targets: HistoryTarget[];
  coalesceUntil?: string;
};
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
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const PINNED_NOTE_HISTORY_COALESCE_MS = 1_000;

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
    // A whole-state snapshot cannot be converted safely after remote changes.
    // Preserve domain/outbox/profile data and discard only legacy Undo/Redo stacks.
    if ([...envelope.history.past, ...envelope.history.future].some((entry) => !Array.isArray((entry as StoredHistoryEntry).targets))) {
      envelope = { ...envelope, history: { past: [], future: [] } };
    }
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
  get history(): NodeHistory {
    const nodes = this.nodes;
    const placeholder = (entry: StoredHistoryEntry) => ({ label: entry.label, before: nodes, after: nodes });
    return { nodes, past: this.envelope.history.past.map(placeholder), future: this.envelope.history.future.map(placeholder) };
  }
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
    return this.applyCommand(type, after, label, options.recordHistory !== false && type !== "purge", this.now());
  }

  async undo(now = this.now()) {
    return this.serialize(() => this.undoSerialized(now));
  }
  private async undoSerialized(now: Date) {
    if (!this.envelope.history.past.length) return [];
    const entry = this.envelope.history.past.at(-1)!;
    if (!this.canReplay(entry, "undo")) return [];
    return this.replayHistory(entry, "undo", now);
  }

  async redo(now = this.now()) {
    return this.serialize(() => this.redoSerialized(now));
  }
  private async redoSerialized(now: Date) {
    if (!this.envelope.history.future.length) return [];
    const entry = this.envelope.history.future[0];
    if (!this.canReplay(entry, "redo")) return [];
    return this.replayHistory(entry, "redo", now);
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
      const latest = this.envelope.history.past.at(-1);
      const target = latest?.targets[0];
      const coalesce = latest?.targets.length === 1
        && target?.resourceType === "pinnedNote"
        && this.envelope.history.future.length === 0
        && typeof latest.coalesceUntil === "string"
        && now.getTime() <= Date.parse(latest.coalesceUntil);
      const entry: StoredHistoryEntry = coalesce
        ? { ...latest, targets: [{ ...target, after: { body } }], coalesceUntil: new Date(now.getTime() + PINNED_NOTE_HISTORY_COALESCE_MS).toISOString() }
        : {
            commandId: `${this.envelope.deviceId}:history:${this.envelope.nextLocalSeq}:${now.getTime()}`,
            label: "常設メモを編集",
            targets: [{ resourceType: "pinnedNote", resourceId: "pinnedNote", before: { body: current.localBody }, after: { body }, forwardOpId: current.synced?.lastOpId ?? null, forwardRevision: current.synced?.revision ?? 0 }],
            coalesceUntil: new Date(now.getTime() + PINNED_NOTE_HISTORY_COALESCE_MS).toISOString(),
          };
      const past = coalesce
        ? [...this.envelope.history.past.slice(0, -1), entry]
        : [...this.envelope.history.past, entry].slice(-75);
      await this.commit({
        ...this.envelope,
        history: { past, future: [] },
        profile: { ...this.envelope.profile, pinnedNote: { ...current, localBody: body, dirtySince: now.toISOString(), migrationPending: false } },
      });
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
      const history = this.attachPinnedForwardIdentity(operation.opId, synced.revision);
      await this.commit({ ...this.envelope, nextLocalSeq: localSeq + 1, history, profile: { ...this.envelope.profile, pinnedNote: { ...current, synced, dirtySince: null } }, sync: { ...this.envelope.sync, outbox: [...this.envelope.sync.outbox, operation] } });
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

  private attachPinnedForwardIdentity(opId: string, revision: number): Envelope["history"] {
    const past = [...this.envelope.history.past];
    const index = past.findLastIndex((entry) => entry.targets.length === 1
      && entry.targets[0].resourceType === "pinnedNote"
      && entry.targets[0].after.body === this.envelope.profile.pinnedNote.localBody);
    if (index < 0) return this.envelope.history;
    const entry = past[index];
    const target = entry.targets[0] as PinnedNoteHistoryTarget;
    past[index] = { ...entry, targets: [{ ...target, forwardOpId: opId, forwardRevision: revision }] };
    return { ...this.envelope.history, past };
  }

  private canReplay(entry: StoredHistoryEntry, direction: "undo" | "redo") {
    return entry.targets.every((target) => {
      if (target.resourceType === "node") {
        const current = this.envelope.domain[target.resourceId];
        if (!current) return false;
        const expectedOpId = direction === "undo" ? target.forwardOpId : target.undoOpId;
        const expectedRevision = direction === "undo" ? target.forwardRevision : target.undoRevision;
        return !!expectedOpId && current.lastOpId === expectedOpId && current.revision === expectedRevision;
      }
      const current = this.envelope.profile.pinnedNote;
      const expectedBody = direction === "undo" ? target.after.body : target.before.body;
      const expectedOpId = direction === "undo" ? target.forwardOpId : target.undoOpId;
      const expectedRevision = direction === "undo" ? target.forwardRevision : target.undoRevision;
      const identityMatches = expectedOpId === null
        ? current.synced === null || current.synced.revision === expectedRevision
        : current.synced?.lastOpId === expectedOpId && current.synced?.revision === expectedRevision;
      return current.localBody === expectedBody && identityMatches;
    });
  }

  private historyNodeValue(current: VersionedNode, target: SyncNodeValue | null, now: Date) {
    if (!target) return { ...current.value, deletedAt: now.toISOString(), deletionBatchId: null, updatedAt: now.toISOString() };
    const value = { ...target };
    const previousTime = typeof current.value.updatedAt === "string" ? Date.parse(current.value.updatedAt) : 0;
    value.updatedAt = new Date(Math.max(now.getTime(), previousTime + 1)).toISOString();
    if (current.value.purgedAt && !value.purgedAt) return null;
    return value;
  }

  private async replayHistory(entry: StoredHistoryEntry, direction: "undo" | "redo", now: Date) {
    let localSeq = this.envelope.nextLocalSeq;
    let domain = { ...this.envelope.domain };
    let profile = this.envelope.profile;
    const operations: SyncOperation[] = [];
    const nextTargets: HistoryTarget[] = [];

    for (const target of entry.targets) {
      if (target.resourceType === "node") {
        const current = domain[target.resourceId];
        const value = this.historyNodeValue(current, direction === "undo" ? target.before : target.after, now);
        if (!value) return [];
        const operation: SyncOperation = {
          opId: `${this.envelope.deviceId}:${localSeq}`, deviceId: this.envelope.deviceId, localSeq,
          targetNodeId: target.resourceId, type: direction, baseRevision: current.revision, payload: { node: value },
          createdAt: now.toISOString(), status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
        };
        localSeq += 1;
        const record = candidateForOperation(operation);
        domain[target.resourceId] = record;
        operations.push(operation);
        nextTargets.push(direction === "undo"
          ? { ...target, undoOpId: operation.opId, undoRevision: record.revision }
          : { ...target, forwardOpId: operation.opId, forwardRevision: record.revision, undoOpId: undefined, undoRevision: undefined });
      } else {
        const current = profile.pinnedNote;
        const body = direction === "undo" ? target.before.body : target.after.body;
        const operation: SyncOperation = {
          opId: `${this.envelope.deviceId}:${localSeq}`, deviceId: this.envelope.deviceId, localSeq,
          targetNodeId: "pinnedNote", targetType: "pinnedNote", type: direction, baseRevision: current.synced?.revision ?? 0,
          payload: { pinnedNote: { body } }, createdAt: now.toISOString(), status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
        };
        localSeq += 1;
        const synced = candidateForPinnedNoteOperation(operation);
        profile = { ...profile, pinnedNote: { ...current, localBody: body, synced, dirtySince: null, migrationPending: false } };
        operations.push(operation);
        nextTargets.push(direction === "undo"
          ? { ...target, undoOpId: operation.opId, undoRevision: synced.revision }
          : { ...target, forwardOpId: operation.opId, forwardRevision: synced.revision, undoOpId: undefined, undoRevision: undefined });
      }
    }

    const moved = { ...entry, targets: nextTargets };
    const history = direction === "undo"
      ? { past: this.envelope.history.past.slice(0, -1), future: [moved, ...this.envelope.history.future] }
      : { past: [...this.envelope.history.past, moved].slice(-75), future: this.envelope.history.future.slice(1) };
    await this.commit({ ...this.envelope, nextLocalSeq: localSeq, domain, profile, history, sync: { ...this.envelope.sync, outbox: [...this.envelope.sync.outbox, ...operations] } });
    return operations;
  }

  private async applyCommand(type: SyncOperationType, nodes: Node[], label: string, recordHistory: boolean, commandTime: Date) {
    let localSeq = this.envelope.nextLocalSeq;
    const operations: SyncOperation[] = [];
    const domain = { ...this.envelope.domain };
    const after = new Map(normalizeNodeSortKeys(nodes).map((node) => [node.id, nodeToV2Value(node)]));
    for (const [id, current] of Object.entries(domain)) {
      if (!after.has(id)) after.set(id, { ...current.value, deletedAt: commandTime.toISOString(), deletionBatchId: null });
    }
    for (const [id, value] of after) {
      const current = domain[id];
      // Import and other whole-state commands must never turn a permanent
      // tombstone back into a normal Node, even temporarily before server ack.
      if (current?.value.purgedAt && !value.purgedAt) continue;
      if (current && same(current.value, value)) continue;
      const operation: SyncOperation = {
        opId: `${this.envelope.deviceId}:${localSeq}`, deviceId: this.envelope.deviceId, localSeq,
        targetNodeId: id, type, baseRevision: current?.revision ?? 0, payload: { node: value },
        createdAt: commandTime.toISOString(), status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
      };
      localSeq += 1; operations.push(operation); domain[id] = candidateForOperation(operation);
    }
    const targets: NodeHistoryTarget[] = operations.map((operation) => {
      const previous = this.envelope.domain[operation.targetNodeId];
      const nextRecord = domain[operation.targetNodeId];
      return { resourceType: "node", resourceId: operation.targetNodeId, before: previous?.value ?? null, after: nextRecord.value, forwardOpId: operation.opId, forwardRevision: nextRecord.revision };
    });
    const history = recordHistory && targets.length ? {
      past: [...this.envelope.history.past, { commandId: `${this.envelope.deviceId}:history:${operations[0].localSeq}`, label, targets }].slice(-75),
      future: [],
    } : this.envelope.history;
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
