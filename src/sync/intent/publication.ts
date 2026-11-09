import { canonical, compare, same } from './canonical';
import { reduceIntents } from './reducer';
import { recordAccepted } from './acceptance';
import type { AcceptedReceipt, ApplicationResult, Baseline, DeliveryLedger, Intent, ReducedState, Scope } from './types';

/** Inject a deterministic SHA-256 implementation; this layer performs no crypto I/O. */
export type Digest = (canonicalJson: string) => string;
export type Checkpoint = Readonly<{ seq: number; hash: string }>;
export type Binding = Readonly<{
  scope: Scope; generation: string; baselineSeal: string; incarnation: string;
  activationToken: string; controlEpoch: number;
}>;
type ManifestBody = Readonly<{
  schema: 'phase1'; scope: Scope; generation: string; baselineSeal: string; controlEpoch: number;
  seq: number; previous: Checkpoint;
  fieldStateHash: string; projectionHash: string; resultHash: string;
  coverageHash: string; conflictHash: string; commandGroupsHash: string;
  protectionHash: string;
}>;
export type Publication = Readonly<{ manifest: ManifestBody & Readonly<{ hash: string }>; state: ReducedState }>;
export type ClientEvidence = Readonly<{
  receipts: readonly Readonly<{ binding: Binding; receipt: AcceptedReceipt }>[];
  /** Only completely verified publications enter this history; protected candidates are not applied. */
  publications: readonly Readonly<{ binding: Binding; publication: Publication; outcome: 'applied' | 'protected' }>[];
  /** Historical confirmation at a specific checkpoint, NOT the current application/conflict status. */
  reflections: readonly Readonly<{ binding: Binding; checkpoint: Checkpoint; intent: Intent; result: ApplicationResult }>[];
}>;
export type ClientSnapshot = Readonly<{
  binding: Binding; checkpoint: Checkpoint; state: ReducedState; ledger: DeliveryLedger;
  /** Sticky quarantined evidence; last verified state is read-only, never a successful new projection. */
  protection: ReducedState | null;
  evidence: ClientEvidence;
}>;
export type PublicationDecision = Readonly<{
  kind: 'applied' | 'noop' | 'stale' | 'pending' | 'rejected' | 'protected'; reason?: string; client: ClientSnapshot;
}>;

function hash(value: unknown, digest: Digest) {
  const result = digest(canonical(value));
  if (!/^[a-f0-9]{64}$/.test(result)) throw Error('SHA-256 digest required');
  return result;
}
function roots(state: ReducedState, digest: Digest) {
  return {
    fieldStateHash: hash(state.fields, digest),
    projectionHash: hash(state.fields.filter(f => 'value' in f).map(f => ({ resource: f.resource, attribute: f.attribute, value: f.value })), digest),
    resultHash: hash(state.results, digest), coverageHash: hash(state.intents, digest),
    conflictHash: hash(state.results.filter(r => r.status === 'conflict'), digest),
    commandGroupsHash: hash(state.intents.map(op => ({ commandId: op.commandId, opId: op.opId, resource: op.resource, writes: op.writes })), digest),
    protectionHash: hash(state.protection, digest),
  };
}

/** Builds a complete in-memory immutable candidate, NOT a server publication or permission. */
export function makePublication(baseline: Baseline, intents: readonly Intent[], previous: Checkpoint, controlEpoch: number, digest: Digest): Publication {
  if (!Number.isSafeInteger(previous.seq) || previous.seq < 0 || previous.seq === Number.MAX_SAFE_INTEGER || !previous.hash ||
    !Number.isSafeInteger(controlEpoch) || controlEpoch < 1) throw Error('Invalid publication predecessor/epoch');
  const state = reduceIntents(baseline, intents);
  const body: ManifestBody = { schema: 'phase1', scope: baseline.scope, generation: baseline.generation,
    baselineSeal: baseline.seal, controlEpoch, seq: previous.seq + 1, previous, ...roots(state, digest) };
  return { manifest: { ...body, hash: hash(body, digest) }, state };
}

/** Binding must be supplied by a future verified activation path. Does not grant edit capability. */
export function initialClient(binding: Binding, baseline: Baseline): ClientSnapshot {
  if (!same(binding.scope, baseline.scope) || binding.generation !== baseline.generation || binding.baselineSeal !== baseline.seal ||
    !binding.incarnation || !binding.activationToken || !Number.isSafeInteger(binding.controlEpoch) || binding.controlEpoch < 1) throw Error('Invalid activation binding');
  return { binding, checkpoint: { seq: 0, hash: baseline.seal }, state: reduceIntents(baseline, []), ledger: { outbox: [], awaiting: [] }, protection: null,
    evidence: { receipts: [], publications: [], reflections: [] } };
}

function orderedUnique<T>(items: readonly T[]): T[] {
  return [...new Map(items.map(item => [canonical(item), item])).entries()]
    .sort(([a], [b]) => compare(a, b)).map(([, item]) => item);
}

function retainPublication(current: ClientSnapshot, publication: Publication, outcome: 'applied' | 'protected'): ClientEvidence {
  const binding = current.binding;
  const checkpoint = { seq: publication.manifest.seq, hash: publication.manifest.hash };
  const reflections = outcome === 'applied' ? publication.state.results.filter(r => r.status === 'applied').flatMap(result =>
    publication.state.intents.filter(op => op.opId === result.opId).map(intent => ({ binding, checkpoint, intent, result }))) : [];
  return { receipts: current.evidence.receipts,
    publications: orderedUnique([...current.evidence.publications, { binding, publication, outcome }]),
    reflections: orderedUnique([...current.evidence.reflections, ...reflections]) };
}

/** Normalize delivery obligations from facts, never from the mutable CURRENT result alone.
 * A historical reflection retires awaiting only; conflict/protection remains in the current state.
 */
function normalizeLedger(binding: Binding, evidence: ClientEvidence, ledger: DeliveryLedger): DeliveryLedger {
  let received = ledger;
  for (const fact of evidence.receipts) if (same(fact.binding, binding)) received = recordAccepted(received, fact.receipt);
  const awaiting = received.awaiting.filter(op => !evidence.reflections.some(fact =>
    same(fact.binding, binding) && fact.result.status === 'applied' && same(fact.intent, op)));
  const next = { outbox: orderedUnique(received.outbox), awaiting: orderedUnique(awaiting) };
  return same(next, ledger) ? ledger : next;
}

/** Receipt transition against retained verified facts, never an unverified/stale notification.
 * Pure atomic candidate only. Hydration must verify this snapshot before calling it.
 */
export function recordClientAccepted(current: ClientSnapshot, receipt: AcceptedReceipt, callbackBinding: Binding): ClientSnapshot {
  if (!same(callbackBinding, current.binding) || !same(receipt.scope, current.binding.scope) ||
      receipt.generation !== current.binding.generation) return current;
  const pending = [...current.ledger.outbox, ...current.ledger.awaiting].filter(op => op.opId === receipt.opId);
  if (receipt.kind !== 'accepted' || pending.some(op => op.generation !== receipt.generation ||
      !same(op.scope, receipt.scope) || canonical(op) !== receipt.canonicalIntent)) return current;
  const known = [...pending, ...current.state.intents, ...current.evidence.reflections.map(f => f.intent)];
  if (!known.some(op => op.opId === receipt.opId && op.generation === receipt.generation &&
      same(op.scope, receipt.scope) && canonical(op) === receipt.canonicalIntent)) return current;
  if (current.evidence.receipts.some(f => f.receipt.opId === receipt.opId && !same(f.receipt, receipt))) return current;
  const evidence: ClientEvidence = { ...current.evidence,
    receipts: orderedUnique([...current.evidence.receipts, { binding: current.binding, receipt }]) };
  const next = { ...current, evidence, ledger: normalizeLedger(current.binding, evidence, current.ledger) };
  return same(next, current) ? current : next;
}

/** Pure CAS candidate. The existing local Store/Journal/CAS/receipt adapters never call this. */
export function applyPublication(current: ClientSnapshot, publication: Publication, callbackBinding: Binding, baseline: Baseline, digest: Digest): PublicationDecision {
  const keep = (kind: PublicationDecision['kind'], reason: string): PublicationDecision => ({
    kind: current.protection ? 'protected' : kind, reason, client: current,
  });
  try {
    const m = publication.manifest;
    if (!same(callbackBinding, current.binding) || !same(m.scope, current.binding.scope) ||
      m.generation !== current.binding.generation || m.baselineSeal !== current.binding.baselineSeal || m.controlEpoch !== current.binding.controlEpoch ||
      !same(baseline.scope, current.binding.scope) || baseline.generation !== current.binding.generation || baseline.seal !== current.binding.baselineSeal)
      return keep('rejected', 'retired-binding');
    if (m.schema !== 'phase1' || !Number.isSafeInteger(m.seq) || m.seq < 1 || m.seq !== m.previous.seq + 1) return keep('rejected', 'invalid-sequence');
    if (m.seq < current.checkpoint.seq) return keep('stale', 'older-publication');
    if (m.seq === current.checkpoint.seq) return m.hash === current.checkpoint.hash
      ? keep('noop', 'duplicate-publication') : keep('rejected', 'publication-fork');
    if (m.previous.seq > current.checkpoint.seq) return keep('pending', 'missing-predecessor');
    if (m.previous.seq !== current.checkpoint.seq || m.previous.hash !== current.checkpoint.hash) return keep('rejected', 'publication-fork');
    // Recompute state and every bound member, rather than trusting a caller-supplied "verified" flag.
    const expected = makePublication(baseline, publication.state.intents, current.checkpoint, current.binding.controlEpoch, digest);
    if (!same(publication, expected)) return keep('rejected', 'manifest-or-member-mismatch');
    // Evidence is append-only even when it cannot become an authoritative publication.
    const evidence = reduceIntents(baseline, [...current.state.intents, ...(current.protection?.intents ?? []), ...expected.state.intents]);
    if (evidence.protection.length) {
      const history = retainPublication(current, expected, 'protected');
      return { kind: 'protected', reason: 'identity-collision',
        client: { ...current, protection: evidence, evidence: history, ledger: normalizeLedger(current.binding, history, current.ledger) } };
    }
    const coverage = new Set(expected.state.intents.map(canonical));
    if (current.state.intents.some(op => !coverage.has(canonical(op)))) return keep('rejected', 'operation-coverage-regression');
    const history = retainPublication(current, expected, 'applied');
    return { kind: 'applied', client: { binding: current.binding, checkpoint: { seq: m.seq, hash: m.hash },
      state: expected.state, ledger: normalizeLedger(current.binding, history, current.ledger), protection: null, evidence: history } };
  } catch { return keep('rejected', 'malformed-publication'); }
}
