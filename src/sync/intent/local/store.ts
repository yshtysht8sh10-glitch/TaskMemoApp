import { canonical, same } from '../canonical';
import type { Digest } from '../publication';
import { intentError } from '../validation';
import { build, guardFor, hydrate } from './hydration';
import { localIntent } from './replay';
import type { AtomicStorage, Envelope, Event, LocalContext, LocalInput, Notice, RawPair, RecoveryGuard, ServerObservation } from './types';

export class LocalIntentStore {
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private constructor(private readonly storage: AtomicStorage, private readonly context: LocalContext,
    private readonly digest: Digest, private raw: string, private envelope: Envelope) {}

  static async open(storage: AtomicStorage, context: LocalContext, digest: Digest, floor: RecoveryGuard | null): Promise<
    { kind: 'ready'; store: LocalIntentStore } | { kind: 'protected'; reason: string; original: RawPair }> {
    context = JSON.parse(canonical(context)) as LocalContext;
    floor = floor === null ? null : JSON.parse(canonical(floor)) as RecoveryGuard;
    const original = await storage.read();
    try {
      if (storage.scope !== context.storageScope) throw Error('storage-scope-mismatch');
      if (original.journal !== null) throw Error('Journal-present-no-automatic-replay');
      if (original.committed !== null) {
        const envelope = hydrate(original.committed, context, floor, digest);
        return { kind: 'ready', store: new LocalIntentStore(storage, context, digest, original.committed, envelope) };
      }
      if (floor !== null) throw Error('missing-Committed-with-existing-recovery-guard');
      const envelope = build(context, [], 0, 1, [], digest), raw = canonical(envelope);
      await storage.writeAtomic(null, raw);
      return { kind: 'ready', store: new LocalIntentStore(storage, context, digest, raw, envelope) };
    } catch (error) {
      return { kind: 'protected', reason: error instanceof Error ? error.message : 'unknown-hydration-failure', original };
    }
  }

  view(): Envelope { return JSON.parse(this.raw) as Envelope; }
  guard(): RecoveryGuard { return guardFor(this.raw, this.envelope, this.digest); }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.then(() => {
      if (this.stopped) throw Error('writer-stopped-reopen-required');
      return work();
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  private async save(events: readonly Event[], processed: number, signal?: AbortSignal) {
    try {
      const candidate = build(this.context, events, processed, this.envelope.revision + 1,
        [...this.envelope.history, this.guard()], this.digest);
      const raw = canonical(candidate);
      // Validate the complete proposed state before entering the short storage transaction.
      // This candidate is built here from the current verified head, not imported from storage.
      // Validate it against its locally issued candidate guard before CAS; expose that guard only after success.
      hydrate(raw, this.context, guardFor(raw, candidate, this.digest), this.digest);
      await this.storage.writeAtomic(this.raw, raw, signal);
      // No memory, allocation or retirement becomes committed before transaction completion.
      this.raw = raw; this.envelope = candidate;
    } catch (error) { this.stopped = true; throw error; }
  }
  local(input: LocalInput, signal?: AbortSignal) {
    const captured = JSON.parse(canonical(input)) as LocalInput;
    return this.serial(async () => {
      if (this.envelope.halt || this.envelope.snapshot.protection || this.envelope.processed !== this.envelope.events.length)
        throw Error('read-only-or-undrained-inbox');
      const op = localIntent(this.context, this.envelope.nextLocalSeq, captured);
      const error = intentError(this.context.baseline, op);
      if (error) throw Error(error);
      const events = [...this.envelope.events, { kind: 'local' as const, intent: op }];
      await this.save(events, events.length, signal);
      return JSON.parse(canonical(op)) as typeof op;
    });
  }
  receive(notice: Notice, signal?: AbortSignal) {
    const event: Event = JSON.parse(canonical({ kind: 'notification', notice }));
    return this.serial(async () => {
      if (this.envelope.halt) throw Error('local-protection-stop');
      // Detach input before any await; the exact notice is retained even if processing rejects it.
      if (this.envelope.events.some(e => same(e, event))) return;
      await this.save([...this.envelope.events, event], this.envelope.processed, signal);
    });
  }
  drain(signal?: AbortSignal) {
    return this.serial(async () => {
      if (this.envelope.halt) throw Error('local-protection-stop');
      if (this.envelope.processed !== this.envelope.events.length)
        await this.save(this.envelope.events, this.envelope.events.length, signal);
    });
  }
  status(server: ServerObservation | null = null) {
    const e = this.envelope, results = e.snapshot.state.results;
    const unreceived = e.snapshot.ledger.outbox.length, awaiting = e.snapshot.ledger.awaiting.length;
    const conflict = results.filter(r => r.status === 'conflict').length;
    const dependencyPending = results.filter(r => r.status === 'dependency-pending').length;
    const rejected = results.filter(r => r.status === 'rejected').length;
    const protection = this.stopped || e.halt !== null || e.snapshot.protection !== null;
    const inboxPending = [...e.inbox.receipts, ...e.inbox.publications].filter(i => i.status === 'queued' || i.status === 'pending').length;
    const inboxRejected = [...e.inbox.receipts, ...e.inbox.publications].filter(i => i.status === 'rejected').length;
    const unprocessed = e.events.length - e.processed;
    // Caller-supplied trusted observation is separate from receipts and historical applied facts.
    const serverConfirmed = server !== null && same(server.binding, e.snapshot.binding) && same(server.checkpoint, e.snapshot.checkpoint);
    return { unreceived, awaiting, conflict, dependencyPending, rejected, protection, inboxPending, inboxRejected, unprocessed, serverConfirmed,
      complete: serverConfirmed && !protection && unreceived + awaiting + conflict + dependencyPending + rejected + inboxPending + inboxRejected + unprocessed === 0 };
  }
}
