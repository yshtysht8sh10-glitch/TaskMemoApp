/** SYNTHETIC external authority/witness model. Never imported by an app/provider. */
import { canonical, same } from '../../canonical';
import { evaluateAcceptance } from '../../acceptance';
import { applyPublication, initialClient, makePublication } from '../../publication';
import type { ClientSnapshot, Digest } from '../../publication';
import { LocalIntentStore } from '../../local/store';
import type { AtomicStorage, LocalContext, Notice, RecoveryGuard } from '../../local/types';
import type { Baseline, Intent, Scope } from '../../types';
import type { AuthPrincipal, AuthorityChannel, Claims, Command, Head, Plan, Request, SignatureIssuer, SignedReply, Value } from '../protocol';

const copy = <T,>(v: T): T => JSON.parse(canonical(v));
export class MockIdentity {
  #sessions = new Map<string, { id: string; scope: Scope; expires: number; active: boolean }>();
  constructor(private readonly now: () => number) {}
  issue(scope: Scope, ttl: number) {
    const id = `synthetic-session-${this.#sessions.size + 1}`, token = `opaque-test-token-${id}`;
    this.#sessions.set(token, { id, scope: copy(scope), expires: this.now() + ttl, active: true });
    return { token, id };
  }
  revoke(token: string) { const s = this.#sessions.get(token); if (s) s.active = false; }
  authenticate(token: string): AuthPrincipal {
    const s = this.#sessions.get(token);
    if (!s || !s.active || this.now() >= s.expires) throw Error('auth-expired-or-revoked');
    return { sessionId: s.id, scope: copy(s.scope) };
  }
}

type Realm = { generation: string; epoch: number; baseline: Baseline; server: ClientSnapshot };
const noticeRealm = (context: LocalContext) => canonical([context.binding.scope, context.binding.generation, context.binding.controlEpoch]);
const noticeKey = (context: LocalContext, id: string) => canonical([noticeRealm(context), id]);
type Pending = { plan: Plan; command: Command; sessionId: string };
type Replica = { context: LocalContext; witness: AtomicStorage; raw: string; guard: RecoveryGuard;
  version: number; attached: boolean; pending: Pending | null;
  heads: Map<number, { raw: string; guard: RecoveryGuard }>;
  completed: Map<string, { plan: Plan; command: Command; sessionId: string; witnessRawHash: string; finalizedAt: number }> };
type Settings = { signer: SignatureIssuer; authenticate(token: string): AuthPrincipal; now(): number; digest: Digest; ttl: number };

export class MockAuthority {
  #replicas = new Map<string, Replica>();
  #realms = new Map<string, Realm>();
  #notices = new Map<string, { realm: string; value: Omit<Extract<Notice, { kind: 'receipt' }>, 'binding'> | Omit<Extract<Notice, { kind: 'publication' }>, 'binding'> }>();
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly settings: Settings) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(work); this.#queue = result.catch(() => undefined); return result;
  }
  async provision(id: string, context: LocalContext, witness: AtomicStorage) {
    return this.serial(async () => {
      if (this.#replicas.has(id) || !context.storageScope.startsWith('synthetic:') || witness.scope !== context.storageScope) throw Error('replica-already-provisioned-or-wrong-scope');
      context = copy(context);
      if ([...this.#replicas.values()].some(r => same(r.context.binding.scope, context.binding.scope) &&
        r.context.actorId === context.actorId && r.context.binding.incarnation === context.binding.incarnation)) throw Error('actor-identity-already-bound-to-replica');
      const key = canonical(context.binding.scope), realm = this.#realms.get(key);
      if (realm && (realm.generation !== context.binding.generation || realm.epoch !== context.binding.controlEpoch ||
        !same(realm.baseline, context.baseline))) throw Error('realm-generation-mismatch');
      let raw: string | null = null;
      const shadow: AtomicStorage = { scope: context.storageScope, read: async () => ({ committed: raw, journal: null }),
        writeAtomic: async (expected, value) => { if (expected !== raw) throw Error('shadow-CAS'); raw = value; } };
      const opened = await LocalIntentStore.open(shadow, context, this.settings.digest, null);
      if (opened.kind !== 'ready') throw Error(opened.reason);
      this.#replicas.set(id, { context, witness, raw: raw!, guard: opened.store.guard(), version: 1, attached: false, pending: null,
        heads: new Map([[1, { raw: raw!, guard: opened.store.guard() }]]), completed: new Map() });
      if (!realm) this.#realms.set(key, { generation: context.binding.generation, epoch: context.binding.controlEpoch, baseline: context.baseline,
        server: initialClient(context.binding, context.baseline) });
    });
  }
  /** Publisher privilege is deliberately absent from AuthorityChannel. */
  async publishNotice(replicaId: string, id: string, value: Omit<Extract<Notice, { kind: 'receipt' }>, 'binding'> | Omit<Extract<Notice, { kind: 'publication' }>, 'binding'>) {
    return this.serial(async () => {
      const r = this.#replicas.get(replicaId); if (!r) throw Error('unknown-replica');
      const key = canonical(r.context.binding.scope), realm = this.#realms.get(key)!;
      value = copy(value);
      if (realm.generation !== r.context.binding.generation || realm.epoch !== r.context.binding.controlEpoch) throw Error('retired-publisher-context');
      const prior = this.#notices.get(noticeKey(r.context, id)), proposed = { realm: noticeRealm(r.context), value };
      if (prior) { if (!same(prior, proposed)) throw Error('immutable-notice-collision'); return; }
      if (value.kind === 'receipt') {
        const existing = [...this.#notices.values()].filter(n => n.realm === proposed.realm)
          .flatMap(n => n.value.kind === 'receipt' ? [n.value.receipt] : []);
        const d = evaluateAcceptance(r.context.baseline, existing, JSON.parse(value.receipt.canonicalIntent) as Intent);
        if (d.kind === 'rejected' || !same(d.receipt, value.receipt)) throw Error('invalid-server-receipt');
      } else {
        if (!same(value.publication, makePublication(r.context.baseline, value.publication.state.intents,
          value.publication.manifest.previous, realm.epoch, this.settings.digest))) throw Error('invalid-server-publication');
        const applied = applyPublication(realm.server, value.publication, realm.server.binding, r.context.baseline, this.settings.digest);
        if (applied.kind === 'pending' || applied.kind === 'rejected') throw Error('server-publication-ancestry');
        realm.server = applied.client;
      }
      this.#notices.set(noticeKey(r.context, id), proposed);
    });
  }
  /** A fence model only: production Auth/Rules/control activation is not implemented. */
  async activate(scope: Scope, generation: string, epoch: number) {
    return this.serial(async () => {
      const key = canonical(scope), realm = this.#realms.get(key);
      if (!realm || [...this.#replicas.values()].some(r => canonical(r.context.binding.scope) === key && r.pending)) throw Error('pending-fence-not-drained');
      if (epoch <= realm.epoch) throw Error('non-monotonic-control-epoch');
      realm.generation = generation; realm.epoch = epoch;
    });
  }
  channel(token: string): AuthorityChannel {
    return { call: request => {
      const captured = copy(request);
      return this.serial(() => this.execute(token, captured));
    } };
  }
  private authorize(token: string, r: Replica): AuthPrincipal {
    const auth = this.settings.authenticate(token), b = r.context.binding, realm = this.#realms.get(canonical(b.scope));
    if (!same(auth.scope, b.scope) || realm?.generation !== b.generation || realm.epoch !== b.controlEpoch) throw Error('auth-scope-or-generation-epoch');
    return auth;
  }
  private head(r: Replica, result: Intent | null = null, outcome: Head['outcome'] = 'confirmed'): Head {
    return { type: 'head', version: r.version, guard: r.guard, outcome, pendingId: r.pending?.plan.id ?? null, result };
  }
  private finalize(r: Replica) {
    const p = r.pending!;
    r.raw = p.plan.raw; r.guard = p.plan.guard; r.version = p.plan.targetVersion;
    r.heads.set(r.version, { raw: r.raw, guard: r.guard });
    r.completed.set(p.plan.id, { plan: p.plan, command: p.command, sessionId: p.sessionId,
      witnessRawHash: p.plan.guard.rawHash, finalizedAt: this.settings.now() }); r.pending = null;
    return this.head(r, p.plan.result);
  }
  private async execute(token: string, request: Request): Promise<SignedReply> {
    const r = this.#replicas.get(request.replicaId); if (!r || typeof request.nonce !== 'string' || !request.nonce) throw Error('unknown-replica-or-challenge');
    const auth = this.authorize(token, r);
    const extra = { head: [], initialize: [], observation: [], recover: ['requestId'], notice: ['noticeId'],
      prepare: ['command', 'expectedVersion', 'requestId'], commit: ['requestId'] }[request.kind];
    if (!extra) throw Error('unknown-authority-request');
    if (!same(Object.keys(request).sort(), ['kind', 'nonce', 'replicaId', ...extra].sort())) throw Error('unknown-request-fields');
    let value: Value;
    switch (request.kind) {
      case 'initialize': {
        const raw = await r.witness.read();
        if (!r.attached) {
          if (raw.committed !== null || raw.journal !== null) throw Error('existing-local-original-not-empty');
          this.authorize(token, r);
          await r.witness.writeAtomic(null, r.raw); r.attached = true;
        } else if (raw.committed !== r.raw || raw.journal !== null) throw Error('local-head-unconfirmed');
        value = this.head(r); break;
      }
      case 'head': value = this.head(r); break;
      case 'observation': {
        const server = this.#realms.get(canonical(r.context.binding.scope))!.server;
        if (server.protection) throw Error('server-protection-unresolved');
        value = { type: 'observation', observation: { binding: r.context.binding, checkpoint: server.checkpoint } }; break;
      }
      case 'notice': {
        const n = this.#notices.get(noticeKey(r.context, request.noticeId));
        if (!n || n.realm !== noticeRealm(r.context)) throw Error('unknown-server-notice');
        value = { type: 'notice', id: request.noticeId, notice: { ...n.value, binding: r.context.binding } }; break;
      }
      case 'prepare': {
        if (!r.attached || request.expectedVersion !== r.version) throw Error('stale-independent-head');
        if (r.pending) {
          if (r.pending.plan.id !== request.requestId || !same(r.pending.command, request.command)) throw Error('replica-reservation-busy');
          value = r.pending.plan; break;
        }
        if (r.completed.has(request.requestId)) throw Error('completed-request-must-not-reapply');
        let raw = r.raw;
        const shadow: AtomicStorage = { scope: r.context.storageScope, read: async () => ({ committed: raw, journal: null }),
          writeAtomic: async (expected, candidate) => { if (expected !== raw) throw Error('shadow-CAS'); raw = candidate; } };
        const s = await LocalIntentStore.open(shadow, r.context, this.settings.digest, r.guard);
        if (s.kind !== 'ready') throw Error(s.reason);
        let result: Intent | null = null;
        if (request.command.kind === 'local') result = await s.store.local(request.command.input);
        else if (request.command.kind === 'drain') await s.store.drain();
        else if (request.command.kind === 'receive') {
          const n = this.#notices.get(noticeKey(r.context, request.command.noticeId));
          if (!n || n.realm !== noticeRealm(r.context)) throw Error('unregistered-server-notice');
          await s.store.receive({ ...n.value, binding: r.context.binding });
        } else throw Error('unknown-command');
        this.authorize(token, r);
        const plan: Plan = { type: 'plan', id: request.requestId, expectedVersion: r.version, targetVersion: r.version + 1,
          raw, guard: s.store.guard(), result, deadline: this.settings.now() + this.settings.ttl };
        r.pending = { plan, command: request.command, sessionId: auth.sessionId }; value = plan; break;
      }
      case 'commit': {
        const p = r.pending;
        if (!p || p.plan.id !== request.requestId || p.sessionId !== auth.sessionId || this.settings.now() >= p.plan.deadline) throw Error('expired-or-unauthorized-permit');
        const raw = await r.witness.read();
        this.authorize(token, r);
        if (this.settings.now() >= p.plan.deadline) throw Error('expired-or-unauthorized-permit');
        if (raw.journal !== null) throw Error('Journal-protected');
        if (raw.committed === r.raw) await r.witness.writeAtomic(r.raw, p.plan.raw);
        else if (raw.committed !== p.plan.raw) throw Error('unknown-witness-head');
        this.authorize(token, r); // A revoked session cannot finalize a write whose response was still in flight.
        const observed = await r.witness.read();
        if (observed.journal !== null || observed.committed !== p.plan.raw) throw Error('commit-witness-mismatch');
        this.authorize(token, r);
        value = this.finalize(r); break;
      }
      case 'recover': {
        const raw = await r.witness.read();
        this.authorize(token, r);
        if (raw.journal !== null) { value = this.head(r, null, 'protected'); break; }
        if (r.pending) {
          if (raw.committed === r.pending.plan.raw) { value = this.finalize(r); break; }
          if (raw.committed === r.raw) { value = this.head(r, null, 'retry-required'); break; }
          value = this.head(r, null, 'protected'); break;
        }
        const done = request.requestId ? r.completed.get(request.requestId) : undefined;
        if (raw.committed === r.raw) r.attached = true;
        value = this.head(r, done?.plan.result ?? null, raw.committed === r.raw ? 'confirmed' : 'protected'); break;
      }
      default: throw Error('unknown-authority-request');
    }
    this.authorize(token, r);
    const issuedAt = this.settings.now();
    const claims: Claims = { format: 'authority-boundary/1', purpose: request.kind, nonce: request.nonce,
      replicaId: request.replicaId, sessionId: auth.sessionId, binding: r.context.binding,
      issuedAt, expiresAt: issuedAt + this.settings.ttl, value: copy(value) };
    // Model an RPC serialization boundary: a recipient cannot mutate private registry objects.
    return copy({ keyId: this.settings.signer.keyId, claims, signature: this.settings.signer.sign(canonical(claims)) });
  }
}
