import { canonical, same } from '../canonical';
import type { Digest } from '../publication';
import type { Envelope, AtomicStorage, LocalContext, LocalInput } from '../local/types';
import { LocalIntentStore } from '../local/store';
import { hydrate } from '../local/hydration';
import { replay } from '../local/replay';
import type { AuthorityChannel, Command, Head, PinnedVerifier, Request, Value } from './protocol';

type Options = { replicaId: string; context: LocalContext; sessionId: string; storage: AtomicStorage;
  channel: AuthorityChannel; verifier: PinnedVerifier; now(): number; digest: Digest; nonce(): string };
type Phase = 'checking' | 'ready' | 'blocked' | 'protected' | 'retired';
type RequestBody<T = Request> = T extends Request ? Omit<T, 'nonce' | 'replicaId'> : never;
export type NoticeTicket = Readonly<{ kind: 'verified-notice' }>;
const copy = <T,>(v: T): T => JSON.parse(canonical(v));

/** Protected facade only. Low-level Phase 2A DTO APIs are NOT an authority entry point. */
export class AuthorityBridge {
  #options: Options;
  #store: LocalIntentStore | null = null;
  #phase: Phase = 'checking';
  #reason = 'not-connected';
  #version = 0;
  #pending: string | null = null;
  #clock = -Infinity;
  #nonces = new Set<string>();
  #tickets = new WeakMap<NoticeTicket, { id: string; expiresAt: number }>();
  #queue: Promise<unknown> = Promise.resolve();
  #busy = false;
  constructor(options: Options) { this.#options = { ...options, context: copy(options.context) }; }
  state() { return { phase: this.#busy && this.#phase === 'ready' ? 'checking' : this.#phase,
    reason: this.#reason, pendingRequest: this.#pending, authorityChecking: this.#busy,
    readOnly: this.#busy || this.#phase !== 'ready' || this.#pending !== null }; }
  view(): Envelope { if (!this.#store) throw Error('no-verified-local-view'); return this.#store.view(); }
  retire() { this.#phase = 'retired'; this.#reason = 'auth-or-context-retired'; }
  private blocked(error: unknown) {
    if (this.#phase !== 'retired') this.#phase = 'blocked';
    this.#reason = error instanceof Error ? error.message : 'authority-unavailable';
  }
  private serial<T>(work: () => Promise<T>) {
    const result = this.#queue.then(async () => {
      if (this.#phase === 'retired') throw Error('retired-client');
      this.#busy = true;
      try { return await work(); } catch (error) { this.blocked(error); throw error; }
      finally { this.#busy = false; }
    });
    this.#queue = result.catch(() => undefined); return result;
  }
  private time() {
    const time = this.#options.now();
    if (!Number.isFinite(time) || time < this.#clock) throw Error('untrusted-clock-rollback');
    this.#clock = time; return time;
  }
  private nonce() {
    const value = this.#options.nonce();
    if (!value || this.#nonces.has(value)) throw Error('reused-challenge');
    this.#nonces.add(value); return value;
  }
  private async rpc(body: RequestBody): Promise<{ value: Value; expiresAt: number }> {
    const o = this.#options, request = { ...copy(body), nonce: this.nonce(), replicaId: o.replicaId } as Request;
    this.time();
    const reply = copy(await o.channel.call(request)), c = reply.claims, now = this.time();
    if (!same(Object.keys(reply).sort(), ['claims', 'keyId', 'signature']) ||
      !same(Object.keys(c).sort(), ['binding', 'expiresAt', 'format', 'issuedAt', 'nonce', 'purpose', 'replicaId', 'sessionId', 'value']) ||
      this.#phase === 'retired' || !o.verifier.verify(reply.keyId, canonical(c), reply.signature) ||
      c.format !== 'authority-boundary/1' || c.purpose !== request.kind || c.nonce !== request.nonce ||
      c.replicaId !== o.replicaId || c.sessionId !== o.sessionId || !same(c.binding, o.context.binding) ||
      !Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt) || c.issuedAt > now ||
      c.expiresAt <= now || c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > 60000) throw Error('invalid-or-expired-authority-proof');
    return { value: c.value, expiresAt: c.expiresAt };
  }
  private async install(head: Head, expiresAt: number) {
    if (head.type !== 'head' || head.outcome !== 'confirmed') throw Error(`authority-${head.outcome}`);
    if (!Number.isSafeInteger(head.version) || head.version < 1 || head.version < this.#version ||
      (head.version === this.#version && this.#store && !same(head.guard, this.#store.guard()))) throw Error('authority-head-rollback-or-fork');
    const o = this.#options;
    const opened = await LocalIntentStore.open(o.storage, o.context, o.digest, head.guard);
    if (opened.kind !== 'ready') throw Error(opened.reason);
    if (this.#phase === 'retired' || this.time() >= expiresAt) throw Error('retired-or-expired-client');
    this.#store = opened.store; this.#version = head.version;
    this.#phase = opened.store.status().protection ? 'protected' : 'ready';
    this.#reason = this.#phase === 'protected' ? 'local-protection-not-cleared' : 'verified-independent-head';
  }
  initialize() {
    return this.serial(async () => {
      const r = await this.rpc({ kind: 'initialize' });
      if (r.value.type !== 'head') throw Error('wrong-authority-purpose');
      await this.install(r.value, r.expiresAt);
    });
  }
  open() {
    return this.serial(async () => {
      const r = await this.rpc({ kind: 'head' });
      if (r.value.type !== 'head') throw Error('wrong-authority-purpose');
      await this.install(r.value, r.expiresAt);
    });
  }
  recover() {
    return this.serial(async () => {
      const r = await this.rpc({ kind: 'recover', requestId: this.#pending });
      if (r.value.type !== 'head') throw Error('wrong-recovery-purpose');
      if (r.value.outcome !== 'confirmed' && r.value.pendingId) this.#pending = r.value.pendingId;
      await this.install(r.value, r.expiresAt);
      this.#pending = null;
      return copy(r.value.result);
    });
  }
  retryPrepared() {
    return this.serial(async () => {
      if (!this.#pending) throw Error('no-pending-authority-permit');
      const r = await this.rpc({ kind: 'commit', requestId: this.#pending });
      if (r.value.type !== 'head') throw Error('wrong-retry-purpose');
      await this.install(r.value, r.expiresAt); this.#pending = null;
      return copy(r.value.result);
    });
  }
  private async operation(command: Command) {
    if (this.#phase !== 'ready' && !(this.#phase === 'protected' && command.kind !== 'local')) throw Error('authority-client-not-ready');
    const id = this.nonce(); this.#pending = id;
    const response = await this.rpc({ kind: 'prepare', requestId: id, expectedVersion: this.#version, command });
    const plan = response.value;
    if (plan.type !== 'plan' || plan.id !== id || plan.expectedVersion !== this.#version || plan.targetVersion !== this.#version + 1 || plan.deadline <= this.time())
      throw Error('invalid-write-permit');
    // A signed permit is a candidate, not current head; check its full Phase 2A semantics too.
    hydrate(plan.raw, this.#options.context, plan.guard, this.#options.digest);
    const committed = await this.rpc({ kind: 'commit', requestId: id });
    if (committed.value.type !== 'head' || committed.value.version !== plan.targetVersion || !same(committed.value.guard, plan.guard)) throw Error('commit-head-mismatch');
    await this.install(committed.value, committed.expiresAt); this.#pending = null;
    return copy(committed.value.result);
  }
  local(input: LocalInput) { const captured = copy(input); return this.serial(async () => {
    const result = await this.operation({ kind: 'local', input: captured }); if (!result) throw Error('local-result-missing'); return result;
  }); }
  notice(id: string) { return this.serial(async () => {
    if (this.#phase !== 'ready' && this.#phase !== 'protected') throw Error('authority-client-not-ready');
    const r = await this.rpc({ kind: 'notice', noticeId: id });
    if (r.value.type !== 'notice' || r.value.id !== id) throw Error('notice-purpose-mismatch');
    replay(this.#options.context, [{ kind: 'notification', notice: r.value.notice }], 0, this.#options.digest);
    const ticket: NoticeTicket = Object.freeze({ kind: 'verified-notice' });
    this.#tickets.set(ticket, { id, expiresAt: r.expiresAt }); return ticket;
  }); }
  receive(ticket: NoticeTicket) { return this.serial(async () => {
    const verified = this.#tickets.get(ticket);
    if (!verified || verified.expiresAt <= this.time()) throw Error('untrusted-or-expired-notice');
    await this.operation({ kind: 'receive', noticeId: verified.id });
  }); }
  drain() { return this.serial(async () => { await this.operation({ kind: 'drain' }); }); }
  /** No caller-supplied checkpoint/boolean is allowed to become server confirmation. */
  status(untrusted?: unknown) { return this.serial(async () => {
    if (untrusted !== undefined) throw Error('untrusted-observation-input');
    if (!this.#store || (this.#phase !== 'ready' && this.#phase !== 'protected')) throw Error('authority-client-not-ready');
    const r = await this.rpc({ kind: 'observation' });
    if (r.value.type !== 'observation') throw Error('observation-purpose-mismatch');
    const observation = r.value.observation;
    if (!same(observation.binding, this.#options.context.binding) || !Number.isSafeInteger(observation.checkpoint.seq) ||
      observation.checkpoint.seq < this.#store.view().snapshot.checkpoint.seq || !observation.checkpoint.hash ||
      !same(Object.keys(observation).sort(), ['binding', 'checkpoint']) ||
      !same(Object.keys(observation.checkpoint).sort(), ['hash', 'seq'])) throw Error('invalid-or-rollback-observation');
    return this.#store.status(r.value.observation);
  }); }
}
