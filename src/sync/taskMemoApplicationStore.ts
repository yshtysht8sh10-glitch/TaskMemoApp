import { findRoutineRoot, newRoutineRoot, isRoutineRoot, assertRoutineRootTransition } from '../domain/routineRoot';
import type { NodeHistory } from "../domain/nodeHistory";
import { recordSyncActivity } from "./selfRepairDiagnostics";
import { recordSortKeyPass } from "./sortKeyDiagnostics";
import type { Node } from "../models/node";
import { assertSafeNodeTransition, assertSafeTextTransition } from "./destructiveSyncGuard";
import { createTextSession, type SessionOptions } from "../textFormat/session";
import { planTextEdit } from "../textFormat/planner";
import { canonical, type TextChange, type TextPlan, type TextSession } from "../textFormat/syntax";
import { normalizeNodeSortKeys } from "../domain/sortKeys";
import type { ApplicationJournalPersistence } from "./applicationStore";
import { nodeFromV2Value, nodeToV2Value } from "./nodeV2Codec";
import { candidateForFeaturesOperation, candidateForOperation, candidateForPinnedNoteOperation, chooseVersionedFeatures, chooseVersionedNode, chooseVersionedPinnedNote } from "./revisionModel";
import type { SyncNodeValue, SyncOperation, SyncOperationType, VersionedFeatures, VersionedNode, VersionedPinnedNote } from "./types";
import { decodeLegacyNodes } from './legacyLocalCodec';
import { integrateOwnershipSortKeys } from './ownershipSortKeys';
import { pendingAnonymousChanges, planOwnershipReconcile, sameOwnershipProfile, type AnonymousSnapshot, type OwnershipLedger, type OwnershipPlan } from './ownershipReconcile';

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
type FeaturesHistoryTarget = Omit<PinnedNoteHistoryTarget, 'resourceType' | 'resourceId' | 'before' | 'after'> & {
  resourceType: 'features'; resourceId: 'features'; before: { ideasEnabled: boolean }; after: { ideasEnabled: boolean };
};
type HistoryTarget = NodeHistoryTarget | PinnedNoteHistoryTarget | FeaturesHistoryTarget;
type StoredHistoryEntry = {
  commandId: string;
  label: string;
  targets: HistoryTarget[];
  coalesceUntil?: string;
};
export type LegacyPinnedNoteCandidate = { body: string; updatedAt: string };
type Envelope = {
  ownershipLedgers?: Record<string, OwnershipLedger>;
  ownershipTransaction?: { plan: OwnershipPlan; choices: Record<string, 'local' | 'account'>; opIds: string[]; appliedIds: string[]; history: StoredHistoryEntry; state: 'uploading' | 'conflict' };
  ownershipRecoverySeed?: NonNullable<Envelope['ownershipTransaction']>;
  ownership?: import('./localApplication').LocalOwnership;
  version: 2;
  deviceId: string;
  nextLocalSeq: number;
  domain: Record<string, VersionedNode>;
  history: { past: StoredHistoryEntry[]; future: StoredHistoryEntry[] };
  sync: { outbox: SyncOperation[]; seenOpIds: string[] };
  profile: {
    pinnedNote: { localBody: string; synced: VersionedPinnedNote | null; dirtySince: string | null; migrationPending: boolean; legacyUpdatedAt: string | null };
    legacyPinnedNoteCandidates: LegacyPinnedNoteCandidate[];
    features: { localIdeasEnabled: boolean; synced: VersionedFeatures | null; migrationPending: boolean };
  };
};
type Options = { deviceId: string; now?: () => Date; bootstrapInitialNodes?: boolean; preserveSortKeys?: boolean; initialPinnedNote?: { body: string; updatedAt: Date }; initialIdeasEnabled?: boolean };

const encodeNodes = (nodes: Node[]) => nodes.map(nodeToV2Value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const PINNED_NOTE_HISTORY_COALESCE_MS = 1_000;

export class TaskMemoV2ApplicationStore {
  private ownershipPlans = new Map<string, OwnershipPlan>();
  private textSessionSequence = 0;
  private readonly textSessions = new Map<string, TextSession>();
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
    recordSyncActivity("hydrate");
    const journal = await persistence.loadJournal();
    if (journal) { await persistence.writeCommitted(journal); await persistence.clearJournal(); }
    const committed = journal ?? await persistence.loadCommitted();
    const hydrateStarted = new Date();
    const normalizedInitialNodes = normalizeNodeSortKeys(initialNodes);
    recordSortKeyPass("hydrate", initialNodes, normalizedInitialNodes, 0, hydrateStarted, Date.now() - hydrateStarted.getTime());
    const loadedEnvelope = committed ? JSON.parse(committed) as Envelope : null;
    let envelope: Envelope = loadedEnvelope ?? {
      version: 2, deviceId: options.deviceId, nextLocalSeq: 1,
      domain: Object.fromEntries(normalizedInitialNodes.map((node) => [node.id, { value: nodeToV2Value(node), revision: 0, lastOpId: "initial", lastDeviceId: "initial", lastLocalSeq: 0, operationType: "import" }])),
      history: { past: [], future: [] }, sync: { outbox: [], seenOpIds: [] },
      profile: {
        pinnedNote: { localBody: options.initialPinnedNote?.body ?? "", synced: null, dirtySince: null, migrationPending: Boolean(options.initialPinnedNote?.body), legacyUpdatedAt: options.initialPinnedNote?.updatedAt.toISOString() ?? null },
        legacyPinnedNoteCandidates: [],
        features: { localIdeasEnabled: options.initialIdeasEnabled === true, synced: null, migrationPending: true },
      },
    };
    if (loadedEnvelope) {
      const storedNodes = Object.values(envelope.domain).map(record => nodeFromV2Value(record.value));
      const started = new Date();
      recordSortKeyPass("hydrate", storedNodes, normalizeNodeSortKeys(storedNodes), 0,
        started, Date.now() - started.getTime());
    }
    if (!envelope.profile) envelope = {
      ...envelope,
      profile: {
        pinnedNote: { localBody: options.initialPinnedNote?.body ?? "", synced: null, dirtySince: null, migrationPending: Boolean(options.initialPinnedNote?.body), legacyUpdatedAt: options.initialPinnedNote?.updatedAt.toISOString() ?? null },
        legacyPinnedNoteCandidates: [],
        features: { localIdeasEnabled: options.initialIdeasEnabled === true, synced: null, migrationPending: true },
      },
    };
    if (!envelope.profile.features) envelope = {
      ...envelope,
      profile: { ...envelope.profile, features: { localIdeasEnabled: options.initialIdeasEnabled === true, synced: null, migrationPending: true } },
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
    // Remote/committed snapshots are not user edits. Auto-rewriting their sortKeys
    // produced normal Outbox operations and a listener/upload feedback loop.
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
  get ideasEnabled() { return this.envelope.profile.features.localIdeasEnabled; }
  get legacyPinnedNoteCandidates() { return [...this.envelope.profile.legacyPinnedNoteCandidates]; }
  versionedNode(id: string) { return this.envelope.domain[id]; }
  /** Wait for edits already accepted by the UI before taking a recovery snapshot. */
  whenIdle() { return this.serialize(async () => undefined); }
  get deviceId() { return this.envelope.deviceId; }
  get pendingOwnership() { const pending = this.envelope.ownershipTransaction ?? this.envelope.ownershipRecoverySeed; return pending ? JSON.parse(JSON.stringify(pending)) as NonNullable<Envelope['ownershipTransaction']> : undefined; }
  anonymousSnapshot(scope: string): AnonymousSnapshot {
    if (this.envelope.ownership?.scope !== scope) throw new Error('Anonymous所有者が一致しません。');
    return JSON.parse(JSON.stringify({ scope, nodes: Object.fromEntries(Object.values(this.envelope.domain).map(r => [r.value.id, r.value])), profile: { body: this.pinnedNote.body, ideasEnabled: this.ideasEnabled } }));
  }
  prepareOwnership(source: AnonymousSnapshot, targetScope: string) {
    const ledger = this.envelope.ownershipLedgers?.[canonical([source.scope, targetScope])];
    const plan = planOwnershipReconcile(source, this.envelope.domain, ledger, targetScope,
      { pinnedNote: this.envelope.profile.pinnedNote.synced, features: this.envelope.profile.features.synced });
    this.ownershipPlans.set(plan.fingerprint, JSON.parse(JSON.stringify(plan)));
    return plan;
  }
  hasOwnershipCheckpoint(sourceScope: string, targetScope: string) {
    return Boolean(this.envelope.ownershipLedgers?.[canonical([sourceScope, targetScope])]);
  }
  unreconciledIds(source: AnonymousSnapshot, targetScope: string) {
    return pendingAnonymousChanges(source, this.envelope.ownershipLedgers?.[canonical([source.scope, targetScope])], targetScope)
      .filter(id => id !== '$profile' || !sameOwnershipProfile(source.profile,
        { pinnedNote: this.envelope.profile.pinnedNote.synced, features: this.envelope.profile.features.synced }));
  }
  async skipOwnership(source: AnonymousSnapshot, targetScope: string) {
    return this.serialize(async () => {
      if (this.pendingOwnership) throw new Error('取り込み復旧が必要です。');
      const ledger: OwnershipLedger = { sourceScope: source.scope, targetScope, source: JSON.parse(JSON.stringify(source)), ancestors: {}, state: 'skipped' };
      await this.commit({ ...this.envelope, ownershipLedgers: { ...this.envelope.ownershipLedgers, [canonical([source.scope, targetScope])]: ledger } }, true);
      this.ownershipPlans.clear();
    });
  }
  async markOwnershipConflict() {
    return this.serialize(async () => {
      if (this.envelope.ownershipTransaction) await this.commit({ ...this.envelope, ownershipTransaction: { ...this.envelope.ownershipTransaction, state: 'conflict' } }, true);
    });
  }
  async reconfirmOwnership(observed: Record<string, VersionedNode>, targetProfile: OwnershipPlan['targetProfile'], receivedIds: string[] = []) {
    return this.serialize(async () => {
      const transaction = this.pendingOwnership;
      if (!transaction) throw new Error('復旧対象がありません。');
      transaction.appliedIds = [...new Set([...transaction.appliedIds, ...receivedIds.filter(id => transaction.opIds.includes(id))])];
      // Preserve optimistic source and all receipt evidence before projecting the
      // current account snapshot. Only unacknowledged adoption targets can vanish.
      const rejected = new Set(transaction.history.targets.filter(t => !transaction.appliedIds.includes(t.forwardOpId ?? '')).map(t => t.resourceId));
      for (const id of Object.keys(this.envelope.domain)) {
        if (!observed[id] && !rejected.has(id)) throw new Error('remote snapshotから既存account Nodeが欠落しました。復旧を停止しました。');
      }
      decodeLegacyNodes(JSON.stringify(Object.values(observed).map(r => r.value)));
      const profile = { ...this.envelope.profile,
        pinnedNote: { ...this.envelope.profile.pinnedNote, localBody: targetProfile.pinnedNote?.value.body ?? '', synced: targetProfile.pinnedNote, dirtySince: null },
        features: { localIdeasEnabled: targetProfile.features?.value.ideasEnabled ?? false, synced: targetProfile.features, migrationPending: false } };
      const next = { ...this.envelope, domain: observed, profile, sync: { ...this.envelope.sync, outbox: [] },
        ownershipRecoveryBackups: [...((this.envelope as Envelope & { ownershipRecoveryBackups?: unknown[] }).ownershipRecoveryBackups ?? []),
          { transaction, outbox: this.outbox }],
        ownershipTransaction: undefined, ownershipRecoverySeed: { ...transaction, state: 'conflict' as const } };
      await this.commit(next, true);
      const plan = this.prepareOwnership(transaction.plan.source, transaction.plan.targetScope);
      const appliedNodeIds = new Set(transaction.history.targets.filter(t => t.resourceType === 'node' && transaction.appliedIds.includes(t.forwardOpId ?? '')).map(t => t.resourceId));
      plan.items = plan.items.filter(item => !appliedNodeIds.has(item.id));
      const { fingerprint: _fingerprint, ...body } = plan;
      plan.fingerprint = canonical(body);
      this.ownershipPlans.set(plan.fingerprint, JSON.parse(JSON.stringify(plan)));
      return plan;
    });
  }
  async commitOwnership(plan: OwnershipPlan, choices: Record<string, 'local' | 'account'>, confirmation?: { fingerprint: string; deletedIds: string[] }) {
    return this.serialize(async () => {
      const trusted = this.ownershipPlans.get(plan.fingerprint);
      if (!trusted || canonical(trusted) !== canonical(plan) || this.envelope.ownershipTransaction || this.outbox.length)
        throw new Error('取り込みplanが無効、または未送信操作があります。');
      const fresh = this.prepareOwnership(trusted.source, trusted.targetScope);
      if (this.envelope.ownershipRecoverySeed) {
        const applied = new Set(this.envelope.ownershipRecoverySeed.history.targets.filter(t => t.resourceType === 'node' && this.envelope.ownershipRecoverySeed!.appliedIds.includes(t.forwardOpId ?? '')).map(t => t.resourceId));
        fresh.items = fresh.items.filter(i => !applied.has(i.id));
        const { fingerprint: _fingerprint, ...body } = fresh; fresh.fingerprint = canonical(body);
      }
      if (fresh.fingerprint !== plan.fingerprint) throw new Error('確認後にアカウントが変更されました。');
      const integrated = integrateOwnershipSortKeys(trusted, choices);
      const domain = { ...this.envelope.domain }; let profile = this.envelope.profile;
      const seed = this.envelope.ownershipRecoverySeed;
      const operations: SyncOperation[] = []; const targets: HistoryTarget[] = seed?.history.targets.filter(t => seed.appliedIds.includes(t.forwardOpId ?? '')) ?? [];
      const acceptedResources = new Set(targets.map(target => target.resourceType));
      let seq = this.envelope.nextLocalSeq;
      const reconcileId = `${this.deviceId}:ownership:${seq}`;
      const operation = (id: string, payload: Record<string, unknown>, current: VersionedNode | VersionedPinnedNote | VersionedFeatures | null, targetType?: SyncOperation['targetType']): SyncOperation => ({
        opId: `${this.deviceId}:${seq}`, deviceId: this.deviceId, localSeq: seq++, targetNodeId: id, ...(targetType ? { targetType } : {}), type: 'import', baseRevision: current?.revision ?? 0,
        payload, createdAt: this.now().toISOString(), status: 'pending', attemptCount: 0, nextRetryAt: null, lastError: null, ownership: { reconcileId, expectedCurrent: current } });
      for (const item of plan.items) {
        if (item.kind === 'same') continue;
        if (!['local', 'account'].includes(choices[item.id])) throw new Error('各変更の採用先を確認してください。');
        if (choices[item.id] === 'account') continue;
        if (item.id === '$profile') {
          const desired = plan.source.profile;
          if (!acceptedResources.has('pinnedNote') && desired.body !== profile.pinnedNote.localBody) {
            const op = operation('pinnedNote', { pinnedNote: { body: desired.body } }, profile.pinnedNote.synced, 'pinnedNote');
            const record = candidateForPinnedNoteOperation(op); operations.push(op);
            targets.push({ resourceType: 'pinnedNote', resourceId: 'pinnedNote', before: { body: profile.pinnedNote.localBody }, after: { body: desired.body }, forwardOpId: op.opId, forwardRevision: record.revision });
            profile = { ...profile, pinnedNote: { ...profile.pinnedNote, localBody: desired.body, synced: record, dirtySince: null, migrationPending: false } };
          }
          if (!acceptedResources.has('features') && desired.ideasEnabled !== profile.features.localIdeasEnabled) {
            const op = operation('features', { features: { ideasEnabled: desired.ideasEnabled } }, profile.features.synced, 'features');
            const record = candidateForFeaturesOperation(op); operations.push(op);
            targets.push({ resourceType: 'features', resourceId: 'features', before: { ideasEnabled: profile.features.localIdeasEnabled }, after: { ideasEnabled: desired.ideasEnabled }, forwardOpId: op.opId, forwardRevision: record.revision });
            profile = { ...profile, features: { localIdeasEnabled: desired.ideasEnabled, synced: record, migrationPending: false } };
          }
          continue;
        }
        if (item.kind === 'purged' || !item.local || item.local.purgedAt || item.account?.value.purgedAt) throw new Error('purged Nodeの採用/復活は禁止です。');
        const adoptedValue = integrated.nodes[item.id];
        const op = operation(item.id, { node: adoptedValue }, item.account);
        op.type = item.local.deletedAt ? 'softDelete' : item.account ? 'update' : 'create';
        const record = candidateForOperation(op); domain[item.id] = record; operations.push(op);
        if (!isRoutineRoot(adoptedValue)) targets.push({ resourceType: 'node', resourceId: item.id, before: item.account?.value ?? null, after: adoptedValue, forwardOpId: op.opId, forwardRevision: record.revision });
      }
      decodeLegacyNodes(JSON.stringify(Object.values(domain).map(r => r.value)));
      assertRoutineRootTransition(this.nodes, Object.values(domain).map(r => nodeFromV2Value(r.value)));
      const deletedIds = operations.filter(op => op.targetType == null && (op.payload.node as SyncNodeValue).deletedAt &&
        this.envelope.domain[op.targetNodeId] && !this.envelope.domain[op.targetNodeId].value.deletedAt && !this.envelope.domain[op.targetNodeId].value.purgedAt).map(op => op.targetNodeId);
      if (deletedIds.length && (confirmation?.fingerprint !== plan.fingerprint || canonical([...confirmation.deletedIds].sort()) !== canonical([...deletedIds].sort())))
        throw new Error('削除対象の明示確認が必要です。');
      assertSafeTextTransition(this.nodes, Object.values(domain).map(r => nodeFromV2Value(r.value)), deletedIds);
      const history: StoredHistoryEntry = { commandId: reconcileId, label: 'ローカルデータをアカウントへ取り込み', targets };
      const next: Envelope = { ...this.envelope, domain, profile, nextLocalSeq: seq, sync: { ...this.envelope.sync, outbox: operations },
        ownershipRecoverySeed: undefined,
        ownershipTransaction: { plan: trusted, choices: { ...seed?.choices, ...choices }, opIds: [...(seed?.appliedIds ?? []), ...operations.map(op => op.opId)], appliedIds: seed?.appliedIds ?? [], history, state: 'uploading' } };
      if (!operations.length) this.finishOwnership(next);
      await this.commit(next, true); this.ownershipPlans.clear(); return operations;
    });
  }
  private finishOwnership(next: Envelope) {
    const transaction = next.ownershipTransaction!;
    const plan = transaction.plan;
    const previous = next.ownershipLedgers?.[canonical([plan.source.scope, plan.targetScope])];
    const ancestors = { ...previous?.ancestors };
    for (const item of plan.items) {
      if (item.kind === 'same' || transaction.choices[item.id] === 'local') {
        if (item.local) ancestors[item.id] = item.local;
      } else delete ancestors[item.id];
    }
    for (const target of transaction.history.targets) if (target.resourceType === 'node' && plan.source.nodes[target.resourceId])
      ancestors[target.resourceId] = target.after as SyncNodeValue;
    next.ownershipLedgers = { ...next.ownershipLedgers, [canonical([plan.source.scope, plan.targetScope])]: {
      sourceScope: plan.source.scope, targetScope: plan.targetScope, source: plan.source, ancestors, state: 'completed' } };
    if (transaction.history.targets.length) next.history = { past: [...next.history.past, transaction.history].slice(-75), future: [] };
    // Keep complete source/plan/receipt backup; no time-based cleanup.
    (next as Envelope & { ownershipBackups?: unknown[] }).ownershipBackups = [...((next as Envelope & { ownershipBackups?: unknown[] }).ownershipBackups ?? []), transaction];
    delete next.ownershipTransaction;
  }

  beginTextEdit(options: Omit<SessionOptions, 'id' | 'now'>): TextSession {
    if (this.pendingOwnership) throw new Error('ローカル取り込みの復旧中です。');
    const fixedNow = this.now();
    const session = createTextSession(Object.values(this.envelope.domain), { ...options,
      id: `${this.deviceId}-${fixedNow.getTime()}-${++this.textSessionSequence}-${Math.random().toString(36).slice(2)}`, now: fixedNow.toISOString() });
    // Keep a private baseline so callers cannot mutate the commit preconditions.
    this.textSessions.set(session.id, JSON.parse(JSON.stringify(session)) as TextSession);
    return session;
  }
  discardTextEdit(session: TextSession) { this.textSessions.delete(session.id); }
  prepareTextEdit(session: TextSession, text: string): TextPlan {
    const trusted = this.textSessions.get(session.id);
    if (!trusted || canonical(trusted) !== canonical(session)) throw new Error('編集sessionが無効です。');
    return planTextEdit(JSON.parse(JSON.stringify(trusted)) as TextSession, text, Object.values(this.envelope.domain));
  }
  async commitTextEdit(plan: TextPlan, confirmation?: { fingerprint: string; deletedIds: string[] }) {
    return this.serialize(async () => {
      if (this.pendingOwnership) throw new Error('ローカル取り込みの復旧中です。');
      const session = this.textSessions.get(plan.session.id);
      if (!session || canonical(session) !== canonical(plan.session)) throw new Error('編集sessionが無効です。');
      const fresh = planTextEdit(session, plan.document, Object.values(this.envelope.domain));
      if (fresh.errors.length) throw new Error(fresh.errors.map(e => `${e.line}:${e.cell} ${e.message}`).join('\n'));
      if (plan.errors.length || fresh.fingerprint !== plan.fingerprint || canonical(fresh.changes) !== canonical(plan.changes))
        throw new Error('確認した変更planが変わりました。再確認してください。');
      if (fresh.requiresConfirmation && (confirmation?.fingerprint !== fresh.fingerprint ||
          canonical([...(confirmation?.deletedIds ?? [])].sort()) !== canonical([...fresh.deletedIds].sort())))
        throw new Error('削除・大量変更の確認が必要です。');
      if (!fresh.changes.length) { this.textSessions.delete(session.id); return []; }
      const values = new Map(Object.values(this.envelope.domain).map(record => [record.value.id, record.value]));
      fresh.changes.forEach(change => values.set(change.id, change.after));
      assertSafeTextTransition(this.nodes, [...values.values()].map(nodeFromV2Value), fresh.deletedIds);
      assertRoutineRootTransition(this.nodes, [...values.values()].map(nodeFromV2Value));
      const operations = await this.applyCommand('update', this.nodes, 'テキスト編集を保存', true, this.now(), fresh.changes);
      this.textSessions.delete(session.id);
      return operations;
    });
  }

  /** Infrastructure initialization: durable ordinary create, no user Undo entry. */
  async ensureRoutineRoot() {
    return this.serialize(async () => {
      if (this.pendingOwnership) throw new Error('取り込みの完了/復旧を待ってください。');
      const values = Object.values(this.envelope.domain).map(r => r.value);
      const existing = findRoutineRoot(values);
      if (existing) return existing.id;
      const value = newRoutineRoot(values, this.now());
      const after = [...this.nodes, nodeFromV2Value(value)];
      assertSafeNodeTransition(this.nodes, after, 'create');
      await this.applyCommand('create', after, 'Routine管理領域を用意', false, this.now(),
        [{ id: value.id, type: 'create', before: null, after: value, fields: ['categoryKind'], line: 0 }]);
      return value.id;
    });
  }

  async command(label: string, type: SyncOperationType, transform: (nodes: Node[]) => Node[], options: { recordHistory?: boolean } = {}) {
    return this.serialize(() => this.commandSerialized(label, type, transform, options));
  }

  private async commandSerialized(label: string, type: SyncOperationType, transform: (nodes: Node[]) => Node[], options: { recordHistory?: boolean }) {
    if (this.pendingOwnership) throw new Error('取り込みの完了/復旧を待ってください。');
    const before = this.nodes;
    const after = transform(before);
    if (same(encodeNodes(before), encodeNodes(after))) return [];
    assertSafeNodeTransition(before, after, type);
    assertRoutineRootTransition(before, after);
    return this.applyCommand(type, after, label, options.recordHistory !== false && type !== "purge", this.now());
  }

  async undo(now = this.now()) {
    if (this.pendingOwnership) throw new Error('取り込みは部分適用/復旧中です。Undoできません。');
    return this.serialize(() => this.undoSerialized(now));
  }
  private async undoSerialized(now: Date) {
    if (this.pendingOwnership) throw new Error('取り込みの復旧中です。');
    if (!this.envelope.history.past.length) return [];
    const entry = this.envelope.history.past.at(-1)!;
    if (!this.canReplay(entry, "undo")) return [];
    return this.replayHistory(entry, "undo", now);
  }

  async redo(now = this.now()) {
    if (this.pendingOwnership) throw new Error('取り込みは部分適用/復旧中です。Redoできません。');
    return this.serialize(() => this.redoSerialized(now));
  }
  private async redoSerialized(now: Date) {
    if (this.pendingOwnership) throw new Error('取り込みの復旧中です。');
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
          const candidate = { body: pinned.localBody, updatedAt };
          if (!candidates.some((item) => same(item, candidate))) candidates = [...candidates, candidate];
          nextPinned = { localBody: remote.value.body, synced: remote, dirtySince: null, migrationPending: false, legacyUpdatedAt: null };
        }
      } else if (remote) {
        const winner = chooseVersionedPinnedNote(pinned.synced ?? undefined, remote);
        nextPinned = { ...pinned, synced: winner, localBody: pinned.dirtySince ? pinned.localBody : winner.value.body };
      }
      const next = { ...this.envelope, profile: { ...profile, pinnedNote: nextPinned, legacyPinnedNoteCandidates: candidates } };
      if (!same(next, this.envelope)) await this.commit(next);
    });
  }

  async importLegacyPinnedNoteCandidates(candidates: LegacyPinnedNoteCandidate[]) {
    return this.serialize(async () => {
      const merged = [...this.envelope.profile.legacyPinnedNoteCandidates];
      for (const candidate of candidates) if (!merged.some((item) => same(item, candidate))) merged.push(candidate);
      if (!same(merged, this.envelope.profile.legacyPinnedNoteCandidates))
        await this.commit({ ...this.envelope, profile: { ...this.envelope.profile, legacyPinnedNoteCandidates: merged } });
    });
  }

  async discardLegacyPinnedNoteCandidate(candidate: LegacyPinnedNoteCandidate) {
    return this.serialize(async () => {
      const candidates = this.envelope.profile.legacyPinnedNoteCandidates.filter((item) => !same(item, candidate));
      if (candidates.length !== this.envelope.profile.legacyPinnedNoteCandidates.length)
        await this.commit({ ...this.envelope, profile: { ...this.envelope.profile, legacyPinnedNoteCandidates: candidates } });
    });
  }

  async initializeFeatures(remote?: VersionedFeatures) {
    return this.serialize(async () => {
      const current = this.envelope.profile.features;
      if (current.migrationPending) {
        if (remote) {
          await this.commit({ ...this.envelope, profile: { ...this.envelope.profile, features: { localIdeasEnabled: remote.value.ideasEnabled, synced: remote, migrationPending: false } } });
        } else if (current.localIdeasEnabled) {
          await this.setIdeasEnabledSerialized(true, "import", true);
        } else {
          await this.commit({ ...this.envelope, profile: { ...this.envelope.profile, features: { ...current, migrationPending: false } } });
        }
        return;
      }
      if (!remote) return;
      const winner = chooseVersionedFeatures(current.synced ?? undefined, remote);
      const next = { localIdeasEnabled: winner.value.ideasEnabled, synced: winner, migrationPending: false };
      if (!same(next, current)) await this.commit({ ...this.envelope, profile: { ...this.envelope.profile, features: next } });
    });
  }

  async setIdeasEnabled(value: boolean, type: SyncOperationType = "update", force = false) {
    return this.serialize(() => this.setIdeasEnabledSerialized(value, type, force));
  }
  private async setIdeasEnabledSerialized(value: boolean, type: SyncOperationType, force: boolean) {
    if (this.pendingOwnership) throw new Error('取り込みの復旧中です。');
    const current = this.envelope.profile.features;
    if (!force && current.localIdeasEnabled === value) return undefined;
    const localSeq = this.envelope.nextLocalSeq;
    const operation: SyncOperation = {
      opId: `${this.envelope.deviceId}:${localSeq}`, deviceId: this.envelope.deviceId, localSeq,
      targetNodeId: "features", targetType: "features", type, baseRevision: current.synced?.revision ?? 0,
      payload: { features: { ideasEnabled: value } }, createdAt: this.now().toISOString(), status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
    };
    const synced = candidateForFeaturesOperation(operation);
    await this.commit({
      ...this.envelope,
      nextLocalSeq: localSeq + 1,
      profile: { ...this.envelope.profile, features: { localIdeasEnabled: value, synced, migrationPending: false } },
      sync: { ...this.envelope.sync, outbox: [...this.envelope.sync.outbox, operation] },
    });
    return operation;
  }

  async receiveFeatures(incoming: VersionedFeatures) {
    return this.serialize(async () => {
      const current = this.envelope.profile.features;
      if (this.envelope.sync.seenOpIds.includes(incoming.lastOpId) &&
          (current.synced?.revision ?? -1) >= incoming.revision) return "duplicate" as const;
      const sameDevice = incoming.lastDeviceId === this.envelope.deviceId;
      const selfEcho = sameDevice && this.envelope.sync.outbox.some(operation => operation.opId === incoming.lastOpId);
      const winner = selfEcho ? current.synced : chooseVersionedFeatures(current.synced ?? undefined, incoming);
      const features = winner ? { localIdeasEnabled: winner.value.ideasEnabled, synced: winner, migrationPending: false } : current;
      const localMutation = !same(features, current);
      await this.commit({ ...this.envelope, nextLocalSeq: sameDevice ? Math.max(this.envelope.nextLocalSeq, incoming.lastLocalSeq + 1) : this.envelope.nextLocalSeq,
        profile: { ...this.envelope.profile, features }, sync: {
        outbox: selfEcho ? this.envelope.sync.outbox.filter((operation) => operation.opId !== incoming.lastOpId) : this.envelope.sync.outbox,
        seenOpIds: [...this.envelope.sync.seenOpIds, incoming.lastOpId].slice(-500),
      } });
      if (localMutation) recordSyncActivity("listenerLocalMutation", { operationId: incoming.lastOpId, deviceId: incoming.lastDeviceId });
      return selfEcho ? "self-echo" as const : "remote" as const;
    });
  }

  async setPinnedNoteDraft(body: string, now = this.now()) {
    return this.serialize(async () => {
      if (this.pendingOwnership) throw new Error('取り込みの復旧中です。');
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
      const current = this.envelope.profile.pinnedNote;
      if (this.envelope.sync.seenOpIds.includes(incoming.lastOpId) &&
          (current.synced?.revision ?? -1) >= incoming.revision) return "duplicate" as const;
      const sameDevice = incoming.lastDeviceId === this.envelope.deviceId;
      const selfEcho = sameDevice && this.envelope.sync.outbox.some(operation => operation.opId === incoming.lastOpId);
      const winner = selfEcho ? current.synced : chooseVersionedPinnedNote(current.synced ?? undefined, incoming);
      const pinnedNote = { ...current, synced: winner ?? current.synced, localBody: current.dirtySince ? current.localBody : (winner?.value.body ?? current.localBody) };
      const localMutation = !same(pinnedNote, current);
      await this.commit({ ...this.envelope, nextLocalSeq: sameDevice ? Math.max(this.envelope.nextLocalSeq, incoming.lastLocalSeq + 1) : this.envelope.nextLocalSeq,
        profile: { ...this.envelope.profile, pinnedNote }, sync: {
        outbox: selfEcho ? this.envelope.sync.outbox.filter((operation) => operation.opId !== incoming.lastOpId) : this.envelope.sync.outbox,
        seenOpIds: [...this.envelope.sync.seenOpIds, incoming.lastOpId].slice(-500),
      } });
      if (localMutation) recordSyncActivity("listenerLocalMutation", { operationId: incoming.lastOpId, deviceId: incoming.lastDeviceId });
      return selfEcho ? "self-echo" as const : "remote" as const;
    });
  }
  private async receiveSerialized(incoming: VersionedNode) {
    const current = this.envelope.domain[incoming.value.id];
    if (this.envelope.sync.seenOpIds.includes(incoming.lastOpId) &&
        (current?.revision ?? -1) >= incoming.revision) return "duplicate" as const;
    const sameDevice = incoming.lastDeviceId === this.envelope.deviceId;
    const selfEcho = sameDevice && this.envelope.sync.outbox.some(operation => operation.opId === incoming.lastOpId);
    const winner = selfEcho ? current : chooseVersionedNode(current, incoming);
    let next: Envelope = {
      ...this.envelope,
      nextLocalSeq: sameDevice ? Math.max(this.envelope.nextLocalSeq, incoming.lastLocalSeq + 1) : this.envelope.nextLocalSeq,
      domain: winner ? { ...this.envelope.domain, [incoming.value.id]: winner } : this.envelope.domain,
      history: this.envelope.history,
      sync: {
        outbox: selfEcho ? this.envelope.sync.outbox.filter((operation) => operation.opId !== incoming.lastOpId) : this.envelope.sync.outbox,
        seenOpIds: [...this.envelope.sync.seenOpIds, incoming.lastOpId].slice(-500),
      },
    };
    const remoteNodes = Object.values(next.domain).map(record => nodeFromV2Value(record.value));
    const started = new Date();
    try { recordSortKeyPass("remote-listener", remoteNodes, normalizeNodeSortKeys(remoteNodes), 0,
      started, Date.now() - started.getTime()); } catch { /* Passive diagnostics never reject remote input. */ }
    const localMutation = !same(next.domain, this.envelope.domain);
    await this.commit(next);
    if (localMutation) recordSyncActivity("listenerLocalMutation", { operationId: incoming.lastOpId, deviceId: incoming.lastDeviceId });
    return selfEcho ? "self-echo" as const : "remote" as const;
  }

  async acknowledge(opId: string, record?: VersionedNode, pinnedNoteRecord?: VersionedPinnedNote, featuresRecord?: VersionedFeatures) {
    return this.serialize(() => this.acknowledgeSerialized(opId, record, pinnedNoteRecord, featuresRecord));
  }
  private async acknowledgeSerialized(opId: string, record?: VersionedNode, pinnedNoteRecord?: VersionedPinnedNote, featuresRecord?: VersionedFeatures) {
    const operation = this.envelope.sync.outbox.find((item) => item.opId === opId);
    if (operation?.ownership && (record ?? pinnedNoteRecord ?? featuresRecord)?.lastOpId !== opId)
      throw new Error('取り込みoperationの受領値が一致しません。復旧が必要です。');
    let domain = this.envelope.domain;
    if (record && operation?.type === 'create' && operation.targetNodeId === 'system-routine' &&
        isRoutineRoot(operation.payload.node as SyncNodeValue) && domain[record.value.id]?.lastOpId === opId) {
      findRoutineRoot([record.value]);
      domain = { ...domain, [record.value.id]: record };
    } else if (record && record.lastDeviceId !== this.envelope.deviceId) {
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
    if (featuresRecord) {
      const current = profile.features;
      const winner = chooseVersionedFeatures(current.synced ?? undefined, featuresRecord);
      profile = { ...profile, features: { localIdeasEnabled: winner.value.ideasEnabled, synced: winner, migrationPending: false } };
    }
    const next: Envelope = {
      ...this.envelope,
      domain,
      profile,
      history: this.envelope.history,
      sync: {
        outbox: this.envelope.sync.outbox.filter((item) => item.opId !== opId),
        seenOpIds: record || pinnedNoteRecord || featuresRecord ? [...new Set([...this.envelope.sync.seenOpIds, (record ?? pinnedNoteRecord ?? featuresRecord)!.lastOpId])].slice(-500) : this.envelope.sync.seenOpIds,
      },
    };
    if (operation?.ownership && next.ownershipTransaction) {
      const transaction = next.ownershipTransaction;
      next.ownershipTransaction = { ...transaction, appliedIds: [...new Set([...transaction.appliedIds, opId])] };
      if (next.ownershipTransaction.opIds.every(id => next.ownershipTransaction!.appliedIds.includes(id))) this.finishOwnership(next);
    }
    if (operation || domain !== this.envelope.domain || profile !== this.envelope.profile) await this.commit(next, Boolean(operation?.ownership));
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
      if (target.resourceType === 'features') {
        const current = this.envelope.profile.features.synced;
        return current?.lastOpId === (direction === 'undo' ? target.forwardOpId : target.undoOpId)
          && current?.revision === (direction === 'undo' ? target.forwardRevision : target.undoRevision);
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
        if (current && isRoutineRoot(current.value)) { nextTargets.push(target); continue; }
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
      } else if (target.resourceType === 'features') {
        const current = profile.features;
        const value = direction === 'undo' ? target.before : target.after;
        const operation: SyncOperation = { opId: `${this.deviceId}:${localSeq}`, deviceId: this.deviceId, localSeq: localSeq++, targetNodeId: 'features', targetType: 'features', type: direction,
          baseRevision: current.synced?.revision ?? 0, payload: { features: value }, createdAt: now.toISOString(), status: 'pending', attemptCount: 0, nextRetryAt: null, lastError: null };
        const synced = candidateForFeaturesOperation(operation);
        profile = { ...profile, features: { localIdeasEnabled: value.ideasEnabled, synced, migrationPending: false } };
        operations.push(operation);
        nextTargets.push(direction === 'undo' ? { ...target, undoOpId: operation.opId, undoRevision: synced.revision }
          : { ...target, forwardOpId: operation.opId, forwardRevision: synced.revision, undoOpId: undefined, undoRevision: undefined });
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

  private async applyCommand(type: SyncOperationType, nodes: Node[], label: string, recordHistory: boolean, commandTime: Date, textChanges?: TextChange[]) {
    let localSeq = this.envelope.nextLocalSeq;
    const operations: SyncOperation[] = [];
    const domain = { ...this.envelope.domain };
    const normalizationStarted = new Date();
    const normalizedNodes = textChanges ? nodes : normalizeNodeSortKeys(nodes);
    // Text plans carry reviewed raw patches; never re-encode untouched legacy fields.
    const after = textChanges ? new Map(Object.values(domain).map(record => [record.value.id, record.value]))
      : new Map(normalizedNodes.map((node) => [node.id, nodeToV2Value(node)]));
    const textTypes = new Map(textChanges?.map(change => [change.id, change.type]));
    textChanges?.forEach(change => after.set(change.id, change.after));
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
        targetNodeId: id, type: textTypes.get(id) ?? type, baseRevision: current?.revision ?? 0, payload: { node: value },
        createdAt: commandTime.toISOString(), status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null,
      };
      localSeq += 1; operations.push(operation); domain[id] = candidateForOperation(operation);
    }
    const beforeKeys = new Map(nodes.map(node => [node.id, node.sortKey]));
    const normalizedIds = new Set(normalizedNodes.filter(node => beforeKeys.get(node.id) !== node.sortKey).map(node => node.id));
    recordSortKeyPass(type === "import" || label.includes("移行") ? "migration" :
      label.includes("ルーティン") ? "routine" : "local-command", nodes, normalizedNodes,
      operations.filter(operation => normalizedIds.has(operation.targetNodeId)).length,
      normalizationStarted, Date.now() - normalizationStarted.getTime());
    const targets: NodeHistoryTarget[] = operations.filter(operation => !isRoutineRoot(domain[operation.targetNodeId].value)).map((operation) => {
      const previous = this.envelope.domain[operation.targetNodeId];
      const nextRecord = domain[operation.targetNodeId];
      return { resourceType: "node", resourceId: operation.targetNodeId, before: previous?.value ?? null, after: nextRecord.value, forwardOpId: operation.opId, forwardRevision: nextRecord.revision };
    });
    const history = recordHistory && targets.length ? {
      past: [...this.envelope.history.past, { commandId: `${this.envelope.deviceId}:history:${operations[0].localSeq}`, label, targets }].slice(-75),
      future: [],
    } : this.envelope.history;
    const next: Envelope = { ...this.envelope, nextLocalSeq: localSeq, domain, history, sync: { ...this.envelope.sync, outbox: [...this.envelope.sync.outbox, ...operations] } };
    await this.commit(next, Boolean(textChanges));
    return operations;
  }

  private async commit(next: Envelope, atomic = false) {
    atomic = atomic || next.ownership?.kind === 'local' || Boolean(next.ownershipTransaction || next.ownershipRecoverySeed);
    const previousIds = new Set(this.envelope.sync.outbox.map(operation => operation.opId));
    const generated = next.sync.outbox.filter(operation => !previousIds.has(operation.opId));
    const value = JSON.stringify(next);
    if (atomic) {
      if (!this.persistence.writeAtomic) throw new Error('原子的なテキスト保存に対応したstorageが必要です。');
      const expected = await this.persistence.loadCommitted();
      if (expected === null || canonical(JSON.parse(expected)) !== canonical(this.envelope))
        throw new Error('保存先が別の操作で更新されました。再読込してください。');
      await this.persistence.writeAtomic(expected, value);
    } else {
      await this.persistence.writeJournal(value);
      await this.persistence.writeCommitted(value);
    }
    this.envelope = next;
    recordSyncActivity("localCommit", { deviceId: next.deviceId });
    for (const operation of generated) recordSyncActivity("outboxGenerated", { operationId: operation.opId, deviceId: operation.deviceId });
    if (!atomic) await this.persistence.clearJournal();
  }
}
