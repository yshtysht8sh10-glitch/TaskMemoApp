import { canonical, same } from '../intent/canonical';
import { applyPublication, initialClient, makePublication, recordClientAccepted } from '../intent/publication';
import { intentError, validateBaseline } from '../intent/validation';
import type { Intent } from '../intent/types';
import type { Bundle, Cut, Dependencies, Expected, LocalFacts, Realm, Verification } from './types';

/** Restricted JSON canonicalization for NEW wrappers; legacy canonicalIntent bytes are unchanged. */
export function encode(input: unknown): string {
  const walk = (v: unknown): void => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (Number.isSafeInteger(v) && !Object.is(v, -0)) return; throw Error('non-integer'); }
    if (typeof v !== 'object' || !v) throw Error('non-json');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) throw Error('non-plain-json');
    const keys = Reflect.ownKeys(v);
    if (keys.some(k => typeof k !== 'string')) throw Error('symbol-key');
    for (const key of keys as string[]) {
      if (Array.isArray(v) && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (!d.enumerable || !('value' in d)) throw Error('accessor-or-hidden-key');
      walk(d.value);
    }
    if (Array.isArray(v) && (Object.keys(v).length !== v.length ||
      Object.keys(v).some((k, i) => k !== String(i)))) throw Error('non-json-array');
  };
  walk(input);
  return canonical(input);
}
export function hashRecord(domain: 'log' | 'publication' | 'baseline', input: unknown, digest: Dependencies['digest']): string {
  const h = digest(encode({ domain: `taskmemo-n1/${domain}/1`, value: input }));
  if (!/^[a-f0-9]{64}$/.test(h)) throw Error('SHA-256-required');
  return h;
}
class Stop extends Error {
  constructor(readonly kind: 'protected' | 'pending' | 'expired', message: string) { super(message); }
}
function check(ok: unknown, why: string): asserts ok { if (!ok) throw new Stop('protected', why); }
function exact(v: object, keys: string) {
  check(v && typeof v === 'object' && !Array.isArray(v) &&
    same(Object.keys(v).sort(), keys.split(' ').sort()), 'unknown-schema');
}
function text(v: unknown) { check(typeof v === 'string' && v.length > 0, 'invalid-string'); }
function integer(v: unknown, min = 0) { check(Number.isSafeInteger(v) && Number(v) >= min, 'invalid-integer'); }
function realm(r: Realm) {
  exact(r, 'scope mode generation baselineSeal controlEpoch activationId');
  exact(r.scope, 'projectId uid'); text(r.scope.projectId); text(r.scope.uid);
  check(r.mode === 'firebase-standard', 'unsupported-mode');
  text(r.generation); text(r.baselineSeal); text(r.activationId); integer(r.controlEpoch, 1);
}
function opMap(ops: readonly Intent[], baseline: Bundle['baseline']) {
  check(Array.isArray(ops), 'invalid-map');
  const m = new Map<string, Intent>();
  for (const op of ops) {
    check(!intentError(baseline, op), 'invalid-intent');
    check(!m.has(op.opId), 'duplicate-or-colliding-identity'); m.set(op.opId, op);
  }
  return m;
}
function subset(a: Map<string, Intent>, b: Map<string, Intent>) {
  return [...a].every(([key, value]) => b.has(key) && same(value, b.get(key)));
}
function partition(p: Bundle['publications'][number] | undefined): Cut['partitions'] {
  const result = { applied: [] as string[], conflict: [] as string[], 'dependency-pending': [] as string[], rejected: [] as string[] };
  for (const r of p?.publication.state.results ?? []) result[r.status].push(r.opId);
  for (const ids of Object.values(result)) ids.sort();
  return result;
}

/** Pure verifier: complete, inline, immutable inventories only. No fetching, signing, CAS or SDK. */
export function verifyCut(input: unknown, expected: Expected, deps: Dependencies): Verification {
  try {
    // Detach plain JSON before invoking an injected verifier; never mutate caller data.
    const b = JSON.parse(encode(input)) as Bundle;
    const e = JSON.parse(encode(expected)) as Expected;
    realm(e.realm); integer(e.now); text(e.replicaId); text(e.session); text(e.nonce);
    exact(b, 'baseline logs publications certificate');
    exact(b.certificate, 'body keyId signature');
    const c = b.certificate.body;
    exact(c, 'format purpose realm replicaId session nonce issuedAt expiresAt controlVersion log publication baselineHash inventory unprocessed partitions admissionRejections protection');
    check(c.format === 'n1-cut/1' && c.purpose === 'cut', 'unknown-schema');
    realm(c.realm);
    check(same(c.realm, e.realm) && c.replicaId === e.replicaId && c.session === e.session && c.nonce === e.nonce, 'binding-mismatch');
    integer(c.issuedAt); integer(c.expiresAt); integer(c.controlVersion, 1);
    check(c.issuedAt < c.expiresAt && e.now >= c.issuedAt, 'invalid-time');
    if (e.now >= c.expiresAt) throw new Stop('expired', 'cut-expired');
    text(b.certificate.keyId); text(b.certificate.signature);
    check(deps.verifySignature(b.certificate.keyId, encode(c), b.certificate.signature) === true, 'invalid-signature');
    exact(c.inventory, 'logs publications');
    exact(c.partitions, 'applied conflict dependency-pending rejected');
    for (const ids of [...Object.values(c.partitions), c.admissionRejections, c.protection]) {
      check(Array.isArray(ids), 'invalid-partition'); ids.forEach(text);
      check(new Set(ids).size === ids.length, 'duplicate-partition');
    }
    exact(deps.limits, 'logs publications intents');
    for (const n of Object.values(deps.limits)) integer(n, 1);
    check(Array.isArray(b.logs) && Array.isArray(b.publications), 'invalid-inventory');
    if (b.logs.length > deps.limits.logs || b.publications.length > deps.limits.publications ||
      b.logs.reduce((n, l) => n + (Array.isArray(l.accepted) ? l.accepted.length : 0), 0) +
      b.publications.reduce((n, p) => n + p.publication.state.intents.length, 0) + c.unprocessed.length > deps.limits.intents)
      throw new Stop('pending', 'budget-exceeded');
    exact(b.baseline, 'scope generation seal resources');
    check(hashRecord('baseline', b.baseline, deps.digest) === c.baselineHash, 'baseline-hash');
    check(same(b.baseline.scope, c.realm.scope) && b.baseline.generation === c.realm.generation &&
      b.baseline.seal === c.realm.baselineSeal, 'baseline-binding');
    validateBaseline(b.baseline);
    if (!same(c.inventory.logs, b.logs.map(l => l.hash)) || !same(c.inventory.publications, b.publications.map(p => p.hash)))
      throw new Stop('pending', 'missing-inventory-member');
    check(b.logs.length > 0, 'missing-genesis');
    const maps: Map<string, Intent>[] = [], logIndex = new Map<string, number>();
    for (const [i, l] of b.logs.entries()) {
      exact(l, 'format realm parent accepted hash');
      check(l.format === 'n1-log/1' && same(l.realm, c.realm), 'log-binding');
      check(l.parent === (i ? b.logs[i - 1].hash : null), 'log-ancestry');
      const { hash, ...body } = l;
      check(hashRecord('log', body, deps.digest) === hash && !logIndex.has(hash), 'log-hash');
      const m = opMap(l.accepted, b.baseline);
      const commands = new Set<string>(), actors = new Set<string>();
      for (const op of m.values()) {
        const actor = canonical([op.actorId, op.actorIncarnation, op.localSeq]);
        check(!commands.has(op.commandId) && !actors.has(actor), 'identity-collision');
        commands.add(op.commandId); actors.add(actor);
      }
      check(i ? subset(maps[i - 1], m) : m.size === 0, 'log-regression');
      maps.push(m); logIndex.set(hash, i);
    }
    check(c.log === b.logs.at(-1)!.hash, 'log-head-mismatch');
    const current = maps.at(-1)!;
    const binding = { scope: c.realm.scope, generation: c.realm.generation, baselineSeal: c.realm.baselineSeal,
      incarnation: e.replicaId, activationToken: c.realm.activationId, controlEpoch: c.realm.controlEpoch };
    let client = initialClient(binding, b.baseline), previousSource = 0, previousCoverage = maps[0];
    for (const [i, p] of b.publications.entries()) {
      exact(p, 'format realm source previous publication hash');
      check(p.format === 'n1-publication/1' && same(p.realm, c.realm), 'publication-binding');
      const source = logIndex.get(p.source);
      if (source === undefined) throw new Stop('pending', 'missing-publication-source');
      check(source >= previousSource, 'source-regression');
      check(p.previous === (i ? b.publications[i - 1].hash : null), 'publication-ancestry');
      const { hash, ...body } = p;
      check(hashRecord('publication', body, deps.digest) === hash, 'publication-hash');
      const coverage = opMap(p.publication.state.intents, b.baseline);
      check(subset(previousCoverage, coverage), 'coverage-regression');
      check(coverage.size === maps[source].size && subset(coverage, maps[source]), 'coverage-source-mismatch');
      // R128-1: NEVER use the current log's later accepted operations here.
      const computed = makePublication(b.baseline, b.logs[source].accepted, client.checkpoint, c.realm.controlEpoch, deps.digest);
      check(same(computed, p.publication), 'publication-semantic-mismatch');
      const seen = new Set<string>();
      for (const r of p.publication.state.results) {
        check(coverage.has(r.opId) && !seen.has(r.opId), 'result-not-one-to-one'); seen.add(r.opId);
      }
      check(seen.size === coverage.size, 'result-not-one-to-one');
      if (i && source === previousSource) check(same(b.publications[i - 1].publication.state, p.publication.state), 'non-noop-same-source');
      const decision = applyPublication(client, p.publication, binding, b.baseline, deps.digest);
      check(decision.kind === 'applied', `phase1-${decision.reason ?? decision.kind}`);
      client = decision.client; previousSource = source; previousCoverage = coverage;
    }
    check(c.publication === (b.publications.at(-1)?.hash ?? null), 'publication-head-mismatch');
    const u = opMap(c.unprocessed, b.baseline);
    const expectedU = new Map([...current].filter(([key]) => !previousCoverage.has(key)));
    check(u.size === expectedU.size && subset(u, expectedU), 'unprocessed-partition-mismatch');
    check(same(c.partitions, partition(b.publications.at(-1))), 'result-partition-mismatch');
    if (e.pin) {
      const pinned = logIndex.get(e.pin.log);
      check(pinned !== undefined && c.controlVersion >= e.pin.controlVersion, 'pin-regression');
      const publicationPresent = e.pin.publication === null || b.publications.some(p => p.hash === e.pin!.publication);
      check(publicationPresent, 'pin-regression');
      check(c.controlVersion !== e.pin.controlVersion || (c.log === e.pin.log && c.publication === e.pin.publication), 'control-fork');
    }
    for (const receipt of e.receipts ?? []) {
      const index = logIndex.get(receipt.log);
      if (index === undefined) throw new Stop('pending', 'receipt-head-not-covered');
      check(maps[index].has(receipt.intent.opId) && current.has(receipt.intent.opId) &&
        same(maps[index].get(receipt.intent.opId), receipt.intent) &&
        same(current.get(receipt.intent.opId), receipt.intent), 'receipt-omitted-or-colliding');
    }
    const blockers = [];
    if (u.size) blockers.push('unprocessed');
    for (const status of ['conflict', 'dependency-pending', 'rejected'] as const)
      if (c.partitions[status].length) blockers.push(status);
    if (c.admissionRejections.length) blockers.push('admission-rejection');
    if (c.protection.length || client.protection) blockers.push('protection');
    return { kind: 'verified', client, unprocessed: [...u.values()], blockers, cut: c };
  } catch (error) {
    return { kind: error instanceof Stop ? error.kind : 'protected', reason: error instanceof Error ? error.message : 'malformed-input' };
  }
}

/** Pure pre-CAS/after-CAS assessment, NOT proof that the supplied local facts were persisted. */
export function syncStatus(input: unknown, expected: Expected, deps: Dependencies, local: LocalFacts) {
  const verification = verifyCut(input, expected, deps);
  if (verification.kind !== 'verified') return { complete: false, verification };
  let complete = false;
  try {
    encode(local);
    for (const n of [local.inboxPending, local.inboxRejected, local.unprocessed, local.inFlight]) integer(n);
    let candidate = verification.client;
    for (const fact of local.client.evidence.receipts) {
      exact(fact, 'binding receipt');
      exact(fact.receipt, 'kind scope generation opId canonicalIntent');
      candidate = recordClientAccepted(candidate, fact.receipt, fact.binding);
    }
    complete = verification.blockers.length === 0 && local.persisted === true && local.dirty === false &&
      local.recoveryPending === false && local.protection === false && local.changedSinceCut === false &&
      local.inboxPending + local.inboxRejected + local.unprocessed + local.inFlight === 0 &&
      local.client.protection === null && local.client.ledger.outbox.length + local.client.ledger.awaiting.length === 0 &&
      same(local.client.binding, verification.client.binding) && same(local.client.checkpoint, verification.client.checkpoint) &&
      same(local.client.state, candidate.state) && same(local.client.evidence, candidate.evidence);
  } catch { /* Malformed facts never mean synchronization success. */ }
  return { complete, verification };
}
