import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { initialClient, makePublication, recordClientAccepted } from '../intent/publication';
import { baseline, intent, scope } from '../intent/testFixtures';
import type { Intent } from '../intent/types';
import { encode, hashRecord, syncStatus, verifyCut } from './verify';
import type { Bundle, LocalFacts, Log, Published, Realm } from './types';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const realm: Realm = { scope, mode: 'firebase-standard', generation: baseline.generation,
  baselineSeal: baseline.seal, controlEpoch: 3, activationId: 'activation-a' };
const binding = { scope, generation: realm.generation, baselineSeal: realm.baselineSeal,
  incarnation: 'client-1', activationToken: realm.activationId, controlEpoch: 3 };
const expected = { realm, replicaId: 'replica', session: 'session', nonce: 'challenge', now: 10 };
const deps = { digest, limits: { logs: 50, publications: 50, intents: 1000 }, verifySignature: (key: string, body: string, signature: string) =>
  key === 'test-key' && signature === digest(`synthetic-auth:${body}`) };
function log(accepted: readonly Intent[], parent: Log | null): Log {
  const body = { format: 'n1-log/1' as const, realm, parent: parent?.hash ?? null, accepted };
  return { ...body, hash: hashRecord('log', body, digest) };
}
function publish(source: Log, previous: Published | null): Published {
  const publication = makePublication(baseline, source.accepted,
    previous ? { seq: previous.publication.manifest.seq, hash: previous.publication.manifest.hash }
      : initialClient(binding, baseline).checkpoint, 3, digest);
  const body = { format: 'n1-publication/1' as const, realm, source: source.hash,
    previous: previous?.hash ?? null, publication };
  return { ...body, hash: hashRecord('publication', body, digest) };
}
function bundle(logs: Log[], publications: Published[]): Bundle {
  const last = publications.at(-1);
  const covered = new Set(last?.publication.state.intents.map(o => o.opId));
  const partitions = { applied: [] as string[], conflict: [] as string[],
    'dependency-pending': [] as string[], rejected: [] as string[] };
  for (const r of last?.publication.state.results ?? []) partitions[r.status].push(r.opId);
  for (const ids of Object.values(partitions)) ids.sort();
  const body = { format: 'n1-cut/1' as const, purpose: 'cut' as const, realm,
    replicaId: 'replica', session: 'session', nonce: 'challenge', issuedAt: 1, expiresAt: 100,
    controlVersion: 1, log: logs.at(-1)!.hash, publication: last?.hash ?? null,
    baselineHash: hashRecord('baseline', baseline, digest),
    inventory: { logs: logs.map(l => l.hash), publications: publications.map(p => p.hash) },
    unprocessed: logs.at(-1)!.accepted.filter(o => !covered.has(o.opId)), partitions,
    admissionRejections: [], protection: [] };
  return { baseline, logs, publications, certificate: { body, keyId: 'test-key',
    signature: digest(`synthetic-auth:${encode(body)}`) } };
}
const a = intent('a', { attribute: 'completion', value: { status: 'completed', completedAt: '2026-11-08T01:00:00.000Z' } });
const b = intent('b', { attribute: 'body', value: 'later' });
const cancel = intent('cancel', { attribute: 'completion', value: { status: 'active', completedAt: null } }, ['a']);
const g = log([], null), l1 = log([a], g), l2 = log([a, b], l1);
const p1 = publish(l1, null);

describe('N1 regression-first R128-1 / R128-2', () => {
  it('C02/C20a: verifies P at its own source, preserves later body in U without protection', () => {
    const result = verifyCut(bundle([g, l1, l2], [p1]), expected, deps);
    expect(result.kind).toBe('verified');
    if (result.kind !== 'verified') return;
    expect(result.unprocessed).toEqual([b]);
    expect(result.client.state.fields.find(f => f.attribute === 'body')?.value).toBe('original');
    expect(result.blockers).toContain('unprocessed');
  });
  it('C15b: rejects current previous and live realm with regressed source after completion cancellation', () => {
    const lc = log([a, cancel], l1), pc = publish(lc, p1), oldSource = publish(l1, pc);
    const input = bundle([g, l1, lc], [p1, pc, oldSource]);
    const before = JSON.stringify(input);
    expect(verifyCut(input, expected, deps)).toMatchObject({ kind: 'protected', reason: 'source-regression' });
    expect(JSON.stringify(input)).toBe(before);
  });
});

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }
function sign(b: Bundle): Bundle {
  return { ...b, certificate: { ...b.certificate, signature: digest(`synthetic-auth:${encode(b.certificate.body)}`) } };
}
function localFor(b: Bundle): LocalFacts {
  const v = verifyCut(b, expected, deps);
  if (v.kind !== 'verified') throw Error(JSON.stringify(v));
  return { client: v.client, persisted: true, dirty: false, inboxPending: 0, inboxRejected: 0,
    unprocessed: 0, inFlight: 0, recoveryPending: false, protection: false, changedSinceCut: false };
}
const full = () => bundle([g, l1], [p1]);
function reject(b: unknown, reason?: string) {
  const before = JSON.stringify(b);
  const result = verifyCut(b, expected, deps);
  expect(result.kind).not.toBe('verified');
  if (reason) expect(result).toMatchObject({ reason });
  expect(JSON.stringify(b)).toBe(before);
}
describe('complete cut inventories — C01–C12/C20 and branches', () => {
  it('C01 genesis, accepted-only, and fully applied have separate completion states', () => {
    const empty = bundle([g], []), accepted = bundle([g, l1], []), applied = full();
    expect(syncStatus(empty, expected, deps, localFor(empty)).complete).toBe(true);
    expect(syncStatus(accepted, expected, deps, localFor(accepted)).complete).toBe(false);
    expect(syncStatus(applied, expected, deps, localFor(applied)).complete).toBe(true);
  });
  it('C03 source L2 complete+emphasis, later body at L3 remains only in U', () => {
    const star = intent('star', { attribute: 'emphasis', value: true });
    const ls = log([a, star], l1), later = log([a, star, b], ls), ps = publish(ls, p1);
    const v = verifyCut(bundle([g, l1, ls, later], [p1, ps]), expected, deps);
    expect(v).toMatchObject({ kind: 'verified', unprocessed: [b], blockers: ['unprocessed'] });
  });
  it('C03 abnormal missing source coverage is not confused with normal U', () => {
    const bad = { ...p1, source: l2.hash };
    const { hash: ignored, ...body } = bad; void ignored;
    reject(bundle([g, l1, l2], [{ ...body, hash: hashRecord('publication', body, digest) }]), 'coverage-source-mismatch');
  });
  it.each(['missing', 'duplicate', 'reordered'] as const)('C04/C10 inventory %s is never inferred from counts', kind => {
    const f = full();
    const logs = kind === 'missing' ? [g] : kind === 'duplicate' ? [g, g] : [l1, g];
    reject({ ...f, logs }, 'missing-inventory-member');
  });
  it('C05 same opId with another payload in signed log is protected', () => {
    const forged = log([a, { ...a, createdAt: '2026-11-08T02:00:00.000Z' }], l1);
    reject(bundle([g, l1, forged], [p1]), 'duplicate-or-colliding-identity');
  });
  it.each(['omitted', 'overlap', 'wrong-payload'] as const)('C06 U %s is not a complete partition', kind => {
    const f = bundle([g, l1, l2], [p1]);
    const unprocessed = kind === 'omitted' ? [] : kind === 'overlap' ? [a] : [{ ...b, origin: 'other' }];
    reject(sign({ ...f, certificate: { ...f.certificate, body: { ...f.certificate.body, unprocessed } } }), 'unprocessed-partition-mismatch');
  });
  it.each(['missing', 'duplicate', 'foreign'] as const)('C07 results %s cannot pass even with rebound wrapper', kind => {
    const f = full(), p = clone(p1);
    const result = p.publication.state.results[0];
    const results = kind === 'missing' ? [] : kind === 'duplicate' ? [result, result] : [{ ...result, opId: 'foreign' }];
    const publication = { ...p.publication, state: { ...p.publication.state, results } };
    const { hash: ignored, ...body } = { ...p, publication }; void ignored;
    const replacement = { ...body, hash: hashRecord('publication', body, digest) };
    const modified = { ...f, publications: [replacement], certificate: { ...f.certificate, body: { ...f.certificate.body,
      publication: replacement.hash, inventory: { ...f.certificate.body.inventory, publications: [replacement.hash] } } } };
    reject(sign(modified), 'publication-semantic-mismatch');
  });
  it('C08 conflict is verified but blocks completion; never historical applied', () => {
    const other = intent('other', { attribute: 'completion', value: { status: 'completed', completedAt: '2026-11-08T03:00:00.000Z' } });
    const lc = log([a, other], l1), pc = publish(lc, p1), f = bundle([g, l1, lc], [p1, pc]);
    const v = verifyCut(f, expected, deps);
    expect(v).toMatchObject({ kind: 'verified', blockers: ['conflict'] });
    if (v.kind !== 'verified') return;
    expect(v.client.evidence.reflections.map(r => r.intent.opId)).toEqual(['a']);
    expect(syncStatus(f, expected, deps, localFor(f)).complete).toBe(false);
    const firstConflict = bundle([g, l1, lc], [publish(lc, null)]);
    const first = verifyCut(firstConflict, expected, deps);
    if (first.kind !== 'verified') throw Error('unexpected');
    expect(first.client.evidence.reflections).toEqual([]);
  });
  it('C08 dependency-pending remains in coverage and blocks completion', () => {
    const pending = intent('pending', { attribute: 'body', value: 'new' }, ['missing']);
    const lp = log([pending], g), f = bundle([g, lp], [publish(lp, null)]);
    expect(verifyCut(f, expected, deps)).toMatchObject({ kind: 'verified', blockers: ['dependency-pending'] });
  });
  it('C08 source semantic rejection remains covered and is not an accepted-success result', () => {
    const wrongAttribute = intent('wrong', { attribute: 'body', value: 'new' }, ['a']);
    const lr = log([a, wrongAttribute], l1), f = bundle([g, l1, lr], [p1, publish(lr, p1)]);
    const result = verifyCut(f, expected, deps);
    expect(result).toMatchObject({ kind: 'verified', blockers: ['rejected'] });
    expect(syncStatus(f, expected, deps, localFor(f)).complete).toBe(false);
  });
  it.each(['admissionRejections', 'protection'] as const)('C08 current %s does not corrupt historical P', field => {
    const f = full(), changed = sign({ ...f, certificate: { ...f.certificate, body: { ...f.certificate.body, [field]: ['blocked'] } } });
    const v = verifyCut(changed, expected, deps);
    expect(v.kind).toBe('verified');
    if (v.kind === 'verified') expect(v.client.evidence.reflections).toHaveLength(1);
    expect(syncStatus(changed, expected, deps, localFor(changed)).complete).toBe(false);
  });
  it('C09a later acceptance is not mixed into an old cut; observed notice invalidates completion', () => {
    const f = full(), facts = localFor(f), next = bundle([g, l1, l2], [p1]);
    expect(syncStatus(f, expected, deps, facts).complete).toBe(true);
    expect(syncStatus(f, expected, deps, { ...facts, changedSinceCut: true }).complete).toBe(false);
    expect(verifyCut(next, expected, deps)).toMatchObject({ kind: 'verified', unprocessed: [b] });
  });
  it('C09 mixed roots from a newer cut are detected', () => {
    const f = full(); reject({ ...f, logs: [g, l1, l2] }, 'missing-inventory-member');
  });
  it.each(['realm', 'replicaId', 'session', 'nonce'] as const)('C11 binding mismatch: %s', field => {
    const f = full(), body = { ...f.certificate.body, [field]: field === 'realm' ? { ...realm, scope: { ...scope, uid: 'foreign' } } : 'foreign' };
    reject(sign({ ...f, certificate: { ...f.certificate, body } }), 'binding-mismatch');
  });
  it.each(['generation', 'controlEpoch', 'activationId'] as const)('C11b changed auth epoch claim %s is not installed', field => {
    const f = full(), r = { ...realm, [field]: field === 'controlEpoch' ? 4 : 'foreign' };
    reject(sign({ ...f, certificate: { ...f.certificate, body: { ...f.certificate.body, realm: r } } }), 'binding-mismatch');
  });
  it('C11 signature over an old body is invalid after mutation', () => {
    const f = full(); reject({ ...f, certificate: { ...f.certificate, signature: 'forged' } }, 'invalid-signature');
  });
  it.each(['e2ee', 'drive', 'local', 'unknown'])('negative mode gate %s', mode => {
    const f = full(); reject(sign({ ...f, certificate: { ...f.certificate,
      body: { ...f.certificate.body, realm: { ...realm, mode } } } } as unknown as Bundle), 'unsupported-mode');
  });
  it.each(['n1-cut/2', 'unknown'])('unknown cut schema %s is protected', format => {
    const f = full(); reject(sign({ ...f, certificate: { ...f.certificate, body: { ...f.certificate.body, format } } } as Bundle), 'unknown-schema');
  });
  it('C12 durable log pin cannot be rolled back or forked at same control version', () => {
    const f = full();
    expect(verifyCut(f, { ...expected, pin: { controlVersion: 2, log: l2.hash, publication: p1.hash } }, deps).kind).toBe('protected');
    expect(verifyCut(f, { ...expected, pin: { controlVersion: 1, log: g.hash, publication: null } }, deps)).toMatchObject({ reason: 'control-fork' });
  });
  it('C20c activated member missing is pending; changed member is protected, never partial applied', () => {
    reject({ ...full(), publications: [] }, 'missing-inventory-member');
    const p = clone(p1); (p.publication.state.fields as unknown[]).pop();
    reject({ ...full(), publications: [p] }, 'publication-hash');
  });
  it('baseline content is authenticated, not just a caller-owned seal string', () => {
    const f = bundle([g], []), changed = clone(baseline);
    (changed.resources as unknown[]).pop();
    reject({ ...f, baseline: changed }, 'baseline-hash');
  });
  it('same count but different signed result partition is protected', () => {
    const f = full();
    reject(sign({ ...f, certificate: { ...f.certificate, body: { ...f.certificate.body,
      partitions: { ...f.certificate.body.partitions, applied: ['not-a'] } } } }), 'result-partition-mismatch');
  });
  it('extra unknown wrapper fields do not silently survive schema validation', () => {
    const f = full(); reject(sign({ ...f, certificate: { ...f.certificate,
      body: { ...f.certificate.body, unexpected: true } } } as Bundle), 'unknown-schema');
  });
  it('explicit synthetic work budgets cannot silently truncate successful verification', () => {
    const f = full();
    expect(verifyCut(f, expected, { ...deps, limits: { logs: 1, publications: 1, intents: 1 } })).toMatchObject({ kind: 'pending', reason: 'budget-exceeded' });
    expect(verifyCut(f, expected, { ...deps, limits: {} } as typeof deps).kind).toBe('protected');
  });
});

describe('publication chain monotonicity / pure completion facts', () => {
  it('same-source no-op retains historical facts and original operations, not a new acceptance', () => {
    const noop = publish(l1, p1), f = bundle([g, l1, l2], [p1, noop]);
    const v = verifyCut(f, expected, deps);
    expect(v).toMatchObject({ kind: 'verified', unprocessed: [b], blockers: ['unprocessed'] });
    if (v.kind === 'verified') expect(v.client.evidence.reflections).toHaveLength(2);
  });
  it('historical P1 and later P2 both use their own source', () => {
    const p2 = publish(l2, p1), f = bundle([g, l1, l2], [p1, p2]);
    const v = verifyCut(f, expected, deps);
    expect(v.kind).toBe('verified');
    if (v.kind === 'verified') expect(v.client.state.fields.find(f => f.attribute === 'body')?.value).toBe('later');
  });
  it('source from an unprovided fork is not inferred from seq', () => {
    const fork = log([b], g), pf = publish(fork, p1);
    reject(bundle([g, l1, l2], [p1, pf]), 'missing-publication-source');
  });
  it('source/coverage cannot omit a prior immutable payload even if source claims to advance', () => {
    const lc = log([a, cancel], l1), pc = publish(lc, p1);
    const bad = publish(l1, pc), { hash: ignored, ...body } = { ...bad, source: lc.hash }; void ignored;
    const regressed = { ...body, hash: hashRecord('publication', body, digest) };
    reject(bundle([g, l1, lc], [p1, pc, regressed]), 'coverage-regression');
  });
  it('same-source altered semantic state is rejected even when wrapper is rehashed', () => {
    const noop = publish(l1, p1), state = { ...noop.publication.state, fields: [] };
    const { hash: ignored, ...body } = { ...noop, publication: { ...noop.publication, state } }; void ignored;
    const changed = { ...body, hash: hashRecord('publication', body, digest) };
    reject(bundle([g, l1], [p1, changed]), 'publication-semantic-mismatch');
  });
  it('current accepted actor collision is protected even when only in U', () => {
    const collision = { ...b, actorId: a.actorId, actorIncarnation: a.actorIncarnation };
    const lc = log([a, collision], l1);
    reject(bundle([g, l1, lc], [p1]), 'identity-collision');
  });
  it('JSON restart produces exactly the same client/evidence/ledger/operations', () => {
    const f = full(); expect(verifyCut(clone(f), clone(expected), deps)).toEqual(verifyCut(f, expected, deps));
  });
  it('known receipt must be in its admission log and current accepted map', () => {
    const f = full();
    expect(verifyCut(f, { ...expected, receipts: [{ log: l1.hash, intent: a }] }, deps).kind).toBe('verified');
    expect(verifyCut(f, { ...expected, receipts: [{ log: l1.hash, intent: b }] }, deps)).toMatchObject({ kind: 'protected', reason: 'receipt-omitted-or-colliding' });
    expect(verifyCut(f, { ...expected, receipts: [{ log: l2.hash, intent: b }] }, deps)).toMatchObject({ kind: 'pending', reason: 'receipt-head-not-covered' });
  });
  it.each(['persisted', 'dirty', 'recoveryPending', 'protection', 'changedSinceCut'] as const)('R19 local blocker %s', field => {
    const f = full(), local = localFor(f);
    expect(syncStatus(f, expected, deps, { ...local, [field]: !local[field] }).complete).toBe(false);
  });
  it.each(['inboxPending', 'inboxRejected', 'unprocessed', 'inFlight'] as const)('local work %s blocks completion', field => {
    const f = full(); expect(syncStatus(f, expected, deps, { ...localFor(f), [field]: 1 }).complete).toBe(false);
  });
  it('separate unsent operation is neither retired nor mutated by verification', () => {
    const f = full(), local = localFor(f), unsent = intent('unsent', { attribute: 'body', value: 'offline' });
    const changed = { ...local, client: { ...local.client, ledger: { outbox: [unsent], awaiting: [] } } };
    const raw = JSON.stringify(changed);
    expect(syncStatus(f, expected, deps, changed).complete).toBe(false);
    expect(JSON.stringify(changed)).toBe(raw);
  });
  it.each([100, 101])('R19a/b/c expiry at now=%s cannot claim freshness or erase persisted reflection', now => {
    const f = full(), local = localFor(f), raw = JSON.stringify(local);
    expect(syncStatus(f, { ...expected, now }, deps, local)).toMatchObject({ complete: false, verification: { kind: 'expired' } });
    expect(JSON.stringify(local)).toBe(raw);
  });
  it('wrong local checkpoint/evidence cannot be called durably applied', () => {
    const f = full(), local = localFor(f);
    expect(syncStatus(f, expected, deps, { ...local, client: initialClient(local.client.binding, baseline) }).complete).toBe(false);
  });
  it('authenticated accepted intent can retain an original matching Phase 1 receipt fact', () => {
    const f = full(), local = localFor(f);
    const receipt = { kind: 'accepted' as const, scope, generation: baseline.generation, opId: a.opId, canonicalIntent: encode(a) };
    const client = recordClientAccepted(local.client, receipt, local.client.binding);
    expect(syncStatus(f, expected, deps, { ...local, client }).complete).toBe(true);
    const corrupted = clone(client);
    const facts = corrupted.evidence.receipts as unknown as { receipt: { canonicalIntent: string } }[];
    facts[0].receipt.canonicalIntent = encode(b);
    expect(syncStatus(f, expected, deps, { ...local, client: corrupted }).complete).toBe(false);
  });
});

describe('canonical encoding — fixed cross-runtime vectors', () => {
  it('sorts keys, preserves null/false/Unicode and distinguishes absent from null', () => {
    expect(encode({ z: null, a: [false, '日本語', 1] })).toBe('{"a":[false,"日本語",1],"z":null}');
    expect(encode({})).not.toBe(encode({ a: null }));
    expect(encode('é')).not.toBe(encode('e\u0301'));
    expect(digest(encode({ a: false }))).toBe('5cd40cde8aebb4b90dfb1cf75cb2f0580d58a86bda6f6f19bf872ab9e041fa32');
    expect(digest(encode({ z: null, a: [false, '日本語', 1] }))).toBe('1dfeb27dc871233022e50201cff6417d79cfaab02b44fba41d266a1bd279b950');
  });
  it.each([undefined, NaN, Infinity, -0, 1.1, Number.MAX_SAFE_INTEGER + 1, new Date(0), [, 1]])('rejects lossy non-JSON input %s', value => {
    expect(() => encode(value)).toThrow();
  });
  it('does not execute accessors or accept symbol/hidden fields', () => {
    let calls = 0;
    expect(() => encode({ get value() { calls++; return 1; } })).toThrow();
    expect(calls).toBe(0);
    expect(() => encode({ [Symbol('key')]: 1 })).toThrow();
  });
  it('new domains cannot alias hashes; invalid digest dependency fails closed', () => {
    expect(hashRecord('log', {}, digest)).not.toBe(hashRecord('publication', {}, digest));
    expect(() => hashRecord('log', {}, () => 'not-a-hash')).toThrow();
  });
});
