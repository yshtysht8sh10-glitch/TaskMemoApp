import { nodeToV2Value } from './nodeV2Codec';
import { findRoutineRoot } from '../domain/routineRoot';
import { initialSyncState, transitionSyncState } from "./stateMachine";
import { recordSyncActivity } from "./selfRepairDiagnostics";
import type { SyncAdapter, SyncFailureKind, SyncOperationType, SyncState } from "./types";
import type { LegacyPinnedNoteCandidate, TaskMemoV2ApplicationStore } from "./taskMemoApplicationStore";
import type { Node } from "../models/node";
import type { SessionOptions } from '../textFormat/session';
import type { TextPlan, TextSession } from '../textFormat/syntax';
import { canonical } from '../textFormat/syntax';
import { canAutoAdoptInitialOwnership, type AnonymousSnapshot } from './ownershipReconcile';

const classify = (reason: unknown): { kind: SyncFailureKind; message: string } => {
  if (reason && typeof reason === "object" && "kind" in reason) {
    const kind = String(reason.kind);
    if (kind === "offline" || kind === "temporary" || kind === "permanent") {
      const detail = 'message' in reason && typeof reason.message === 'string' ? reason.message : null;
      return { kind, message: reason instanceof Error ? reason.message : detail ?? (kind === 'offline' ? '通信できません。ローカルデータは保持されています。' : 'クラウド同期を完了できません。設定・権限と通信状態を確認してください。') };
    }
  }
  return { kind: "temporary", message: reason instanceof Error ? reason.message : String(reason) };
};

/** Common V2 Application bridge. Durable local state precedes network I/O. */
export class TaskMemoV2SyncController {
  state: SyncState;
  ownershipAssessment: 'checking' | 'ready' | 'unavailable';
  private unsubscribe?: () => void;
  private running = false;
  private stopped = true;
  private activeFlushGeneration = -1;
  private flushTask: Promise<void> | null = null;
  private generation = 0;
  private paused = false;
  private pauseReason: 'network' | 'ownership' = 'network';
  private receiptsAudited = false;
  private pinnedNoteTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly store: TaskMemoV2ApplicationStore, private readonly adapter: SyncAdapter, private readonly onChange: () => void = () => undefined,
    private readonly options: { localOnly?: boolean; initialOwnership?: { source: () => AnonymousSnapshot; targetScope: string } } = {}) {
    this.state = initialSyncState(store.pendingCount);
    this.ownershipAssessment = options.initialOwnership ? 'checking' : 'ready';
  }

  async start() {
    recordSyncActivity(this.options.localOnly ? "localOnlyStart" : "normalStart", { deviceId: this.store.deviceId });
    this.stop();
    if (this.options.localOnly) {
      this.state = { phase: "offline", pendingCount: this.store.pendingCount, lastError: null };
      this.onChange();
      return;
    }
    this.stopped = false;
    this.receiptsAudited = false;
    this.ownershipAssessment = this.options.initialOwnership ? 'checking' : 'ready';
    const generation = this.generation;
    this.state = transitionSyncState(this.state, { type: "connect", pendingCount: this.store.pendingCount });
    try {
      await this.adapter.connect();
      if (generation !== this.generation) return;
      await this.adapter.auditOutbox?.(this.store.outbox);
      if (generation !== this.generation) return;
      this.receiptsAudited = true;
      await this.adoptInitialOwnership(generation);
      if (generation !== this.generation) return;
      this.ownershipAssessment = 'ready';
      this.onChange();
      if (!this.store.pendingOwnership) {
        await this.store.initializePinnedNote(await this.adapter.readPinnedNote?.());
        await this.store.initializeFeatures(await this.adapter.readFeatures?.());
        await this.store.queuePinnedNoteOperation();
      }
      this.unsubscribe = this.adapter.subscribe?.(
        async (record) => {
          if (generation !== this.generation) return;
          await this.store.receive(record);
          this.refresh();
          await this.flush();
          this.onChange();
        },
        (reason) => { const problem = classify(reason); this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.store.pendingCount, ...problem }); this.onChange(); },
      );
      const unsubscribePinnedNote = this.adapter.subscribePinnedNote?.(
        async (record) => {
          if (generation !== this.generation) return;
          await this.store.receivePinnedNote(record);
          this.refresh(); this.onChange();
        },
        (reason) => { const problem = classify(reason); this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.store.pendingCount, ...problem }); this.onChange(); },
      );
      const unsubscribeFeatures = this.adapter.subscribeFeatures?.(
        async (record) => {
          if (generation !== this.generation) return;
          await this.store.receiveFeatures(record);
          this.refresh(); this.onChange();
        },
        (reason) => { const problem = classify(reason); this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.store.pendingCount, ...problem }); this.onChange(); },
      );
      const unsubscribeNodes = this.unsubscribe;
      this.unsubscribe = () => { unsubscribeNodes?.(); unsubscribePinnedNote?.(); unsubscribeFeatures?.(); };
      this.state = transitionSyncState(this.state, { type: "connected", pendingCount: this.store.pendingCount });
      await this.flush();
      this.onChange();
    } catch (reason) {
      if (generation !== this.generation) return;
      this.ownershipAssessment = 'unavailable';
      const problem = classify(reason);
      this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.store.pendingCount, ...problem });
      this.onChange();
    }
  }

  private async adoptInitialOwnership(generation: number) {
    const initial = this.options.initialOwnership;
    if (!initial || !this.adapter.readRecoverySnapshot || this.store.pendingOwnership || this.store.outbox.length ||
      this.store.nodes.length || this.store.historyDepths.past || this.store.historyDepths.future ||
      this.store.pinnedNote.body || this.store.ideasEnabled || this.store.legacyPinnedNoteCandidates.length) return;
    const source = initial.source();
    if (this.store.hasOwnershipCheckpoint(source.scope, initial.targetScope)) return;
    if (!this.store.unreconciledIds(source, initial.targetScope).length) return;
    const target = await this.adapter.readRecoverySnapshot();
    if (generation !== this.generation) return;
    const plan = this.store.prepareOwnership(source, initial.targetScope);
    const serverNodes = Object.fromEntries(target.nodes.map(record => [record.value.id, record]));
    const serverProfile = { pinnedNote: target.pinnedNote ?? null, features: target.features ?? null };
    if (canonical(plan.target) !== canonical(serverNodes) || canonical(plan.targetProfile) !== canonical(serverProfile) ||
      !canAutoAdoptInitialOwnership(plan, target.receiptDocumentCount)) return;
    // Match the manual commit's final server/source check; never recompute from
    // login age or trust an empty local cache as an empty Cloud.
    const confirmed = await this.adapter.readRecoverySnapshot();
    if (generation !== this.generation || canonical(confirmed) !== canonical(target) || canonical(initial.source()) !== canonical(source)) return;
    await this.store.commitOwnership(plan, Object.fromEntries(plan.items.map(item => [item.id, 'local' as const])));
  }

  pause(reason: 'network' | 'ownership' = 'network') {
    this.paused = true;
    this.pauseReason = reason;
    this.stop();
    this.state = reason === 'ownership'
      ? { phase: this.store.pendingCount ? 'pending' : 'synced', pendingCount: this.store.pendingCount, lastError: null }
      : transitionSyncState(this.state, { type: "failure", pendingCount: this.store.pendingCount, kind: "offline", message: "Development offline simulation" });
    this.onChange();
  }

  async resume() {
    this.paused = false;
    await this.start();
  }

  stop() { recordSyncActivity("stop", { deviceId: this.store.deviceId }); this.stopped = true; this.generation++; this.receiptsAudited = false; this.unsubscribe?.(); this.unsubscribe = undefined; if (this.pinnedNoteTimer) clearTimeout(this.pinnedNoteTimer); this.pinnedNoteTimer = undefined; this.state = { phase: "offline", pendingCount: this.store.pendingCount, lastError: null }; }

  async updatePinnedNote(body: string, debounceMs = 500) {
    await this.store.setPinnedNoteDraft(body);
    this.state = transitionSyncState(this.state, { type: "local-operation", pendingCount: this.store.pendingCount });
    this.onChange();
    if (this.pinnedNoteTimer) clearTimeout(this.pinnedNoteTimer);
    this.pinnedNoteTimer = setTimeout(() => {
      this.pinnedNoteTimer = undefined;
      void this.store.queuePinnedNoteOperation().then(() => this.flush()).then(() => this.onChange());
    }, debounceMs);
  }

  async adoptLegacyPinnedNoteCandidate(candidate: LegacyPinnedNoteCandidate) {
    await this.store.setPinnedNoteDraft(candidate.body);
    await this.store.discardLegacyPinnedNoteCandidate(candidate);
    await this.store.queuePinnedNoteOperation();
    this.state = transitionSyncState(this.state, { type: "local-operation", pendingCount: this.store.pendingCount });
    this.onChange();
    await this.flush();
    this.onChange();
  }

  async discardLegacyPinnedNoteCandidate(candidate: LegacyPinnedNoteCandidate) {
    await this.store.discardLegacyPinnedNoteCandidate(candidate);
    this.onChange();
  }

  async importLegacyPinnedNoteCandidates(candidates: LegacyPinnedNoteCandidate[]) {
    await this.store.importLegacyPinnedNoteCandidates(candidates);
    this.onChange();
  }

  async updateIdeasEnabled(value: boolean, type: SyncOperationType = "update") {
    const operation = await this.store.setIdeasEnabled(value, type);
    if (operation) this.state = transitionSyncState(this.state, { type: "local-operation", pendingCount: this.store.pendingCount });
    this.onChange();
    await this.flush();
    this.onChange();
    return operation;
  }

  async command(label: string, type: SyncOperationType, transform: (nodes: Node[]) => Node[], options: { recordHistory?: boolean } = {}) {
    const operations = await this.store.command(label, type, transform, options);
    if (operations.length) this.state = transitionSyncState(this.state, { type: "local-operation", pendingCount: this.store.pendingCount });
    this.onChange();
    await this.flush();
    this.onChange();
    return operations;
  }

  /** Lazy system setup. Never infer an empty account from an empty local cache. */
  async ensureRoutineRoot() {
    const generation = this.generation;
    if (!this.options.localOnly && this.ownershipAssessment !== 'ready')
      throw new Error('アカウントの初期取り込み確認が完了するまでお待ちください。');
    const existing = findRoutineRoot(this.store.nodes.map(nodeToV2Value));
    if (!existing && !this.options.localOnly) {
      if (this.stopped || this.paused || this.store.pendingOwnership || !this.adapter.readRecoverySnapshot)
        throw new Error('Routine管理領域の準備にはアカウントの同期確認が必要です。');
      await this.adapter.connect();
      const snapshot = await this.adapter.readRecoverySnapshot();
      if (generation !== this.generation || this.stopped) throw new Error('アカウントが切り替わりました。');
      findRoutineRoot(snapshot.nodes.map(record => record.value));
      for (const record of snapshot.nodes) {
        if (generation !== this.generation || this.stopped) throw new Error('アカウントが切り替わりました。');
        await this.store.receive(record);
      }
    }
    if (generation !== this.generation) throw new Error('アカウントが切り替わりました。');
    const id = await this.store.ensureRoutineRoot();
    this.state = transitionSyncState(this.state, { type: 'local-operation', pendingCount: this.store.pendingCount });
    this.onChange();
    void this.flush().then(() => this.onChange());
    return id;
  }

  beginTextEdit(options: Omit<SessionOptions, 'id' | 'now'>) { return this.store.beginTextEdit(options); }
  prepareTextEdit(session: TextSession, text: string) { return this.store.prepareTextEdit(session, text); }
  discardTextEdit(session: TextSession) { this.store.discardTextEdit(session); }
  async saveTextEdit(plan: TextPlan, confirmation?: { fingerprint: string; deletedIds: string[] }) {
    const operations = await this.store.commitTextEdit(plan, confirmation);
    if (operations.length) this.state = transitionSyncState(this.state, { type: 'local-operation', pendingCount: this.store.pendingCount });
    this.onChange();
    void this.flush().then(() => this.onChange()).catch(reason => {
      const problem = classify(reason);
      this.state = transitionSyncState(this.state, { type: 'failure', pendingCount: this.store.pendingCount, ...problem }); this.onChange();
    });
    return operations;
  }

  /** Confirm the durable local write; cloud upload continues independently. */
  async commandLocal(label: string, type: SyncOperationType, transform: (nodes: Node[]) => Node[], options: { recordHistory?: boolean } = {}) {
    const operations = await this.store.command(label, type, transform, options);
    if (operations.length) this.state = transitionSyncState(this.state, { type: "local-operation", pendingCount: this.store.pendingCount });
    this.onChange();
    void this.flush().then(() => this.onChange()).catch((reason) => {
      const problem = classify(reason);
      this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.store.pendingCount, ...problem });
      this.onChange();
    });
    return operations;
  }

  async undo(now?: Date) {
    const operations = await this.store.undo(now);
    if (operations.length) this.state = transitionSyncState(this.state, { type: "local-operation", pendingCount: this.store.pendingCount });
    this.onChange();
    await this.flush();
    this.onChange();
    return operations;
  }

  async redo(now?: Date) {
    const operations = await this.store.redo(now);
    if (operations.length) this.state = transitionSyncState(this.state, { type: "local-operation", pendingCount: this.store.pendingCount });
    this.onChange();
    await this.flush();
    this.onChange();
    return operations;
  }

  async flush() {
    if (this.options.localOnly) return;
    recordSyncActivity("normalFlush", { deviceId: this.store.deviceId });
    if (this.paused) {
      if (this.pauseReason === 'ownership') return;
      this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.store.pendingCount, kind: "offline", message: "Development offline simulation" });
      return;
    }
    if (this.stopped) return;
    if (this.adapter.auditOutbox && !this.receiptsAudited) return;
    if (this.running) {
      // A fresh start must wait for the old generation's in-flight transaction.
      // Same-generation listener callbacks must not wait: upload may await them.
      if (this.activeFlushGeneration === this.generation) return;
      await this.flushTask;
      if (this.stopped) return;
    }
    const generation = this.generation;
    this.running = true;
    this.activeFlushGeneration = generation;
    const task = this.drain(generation);
    this.flushTask = task;
    try { await task; }
    finally { if (this.flushTask === task) this.flushTask = null; }
  }

  private async drain(generation: number) {
    try {
      while (!this.stopped && generation === this.generation && this.store.outbox.length) {
        if (this.store.pendingOwnership?.state === 'conflict') return;
        const operation = this.store.outbox[0];
        this.state = transitionSyncState(this.state, { type: "upload-started", pendingCount: this.store.pendingCount, retry: operation.attemptCount > 0 });
        try {
          if (this.stopped || generation !== this.generation) return;
          const acknowledgement = await this.adapter.upload(operation, undefined, undefined,
            () => !this.stopped && generation === this.generation);
          if (acknowledgement.opId !== operation.opId) throw { kind: "permanent", message: "acknowledgement opId mismatch" };
          await this.store.acknowledge(operation.opId, acknowledgement.record, acknowledgement.pinnedNoteRecord, acknowledgement.featuresRecord);
          this.refresh();
        } catch (reason) {
          if (operation.ownership) await this.store.markOwnershipConflict();
          const problem = classify(reason);
          this.state = transitionSyncState(this.state, { type: "failure", pendingCount: this.store.pendingCount, ...problem });
          return;
        }
      }
    } finally { this.running = false; this.activeFlushGeneration = -1; }
  }

  private refresh() {
    this.state = transitionSyncState(this.state, { type: "acknowledged", pendingCount: this.store.pendingCount });
  }
}
