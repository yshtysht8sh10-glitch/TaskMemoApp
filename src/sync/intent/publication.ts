import { canonical, same } from './canonical';
import { reduceIntents } from './reducer';
import { recordAccepted } from './acceptance';
import type { AcceptedReceipt, Baseline, DeliveryLedger, Intent, ReducedState, Scope } from './types';

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
export type ClientSnapshot = Readonly<{
  binding: Binding; checkpoint: Checkpoint; state: ReducedState; ledger: DeliveryLedger;
  /** Sticky quarantined evidence; last verified state is read-only, never a successful new projection. */
  protection: ReducedState | null;
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
  return { binding, checkpoint: { seq: 0, hash: baseline.seal }, state: reduceIntents(baseline, []), ledger: { outbox: [], awaiting: [] }, protection: null };
}

function settleAwaiting(state: ReducedState, ledger: DeliveryLedger): DeliveryLedger {
  const reflected = (op: Intent) => state.results.some(r => r.opId === op.opId && r.status === 'applied') &&
    state.intents.some(known => same(known, op));
  const awaiting = ledger.awaiting.filter(op => !reflected(op));
  return awaiting.length === ledger.awaiting.length ? ledger : { outbox: ledger.outbox, awaiting };
}

/** Receipt transition against the CURRENT verified snapshot, never against an old notification.
 * Pure atomic candidate only. Hydration must verify this snapshot before calling it.
 */
export function recordClientAccepted(current: ClientSnapshot, receipt: AcceptedReceipt, callbackBinding: Binding): ClientSnapshot {
  if (!same(callbackBinding, current.binding) || !same(receipt.scope, current.binding.scope) ||
      receipt.generation !== current.binding.generation) return current;
  const pending = [...current.ledger.outbox, ...current.ledger.awaiting].filter(op => op.opId === receipt.opId);
  if (receipt.kind !== 'accepted' || !pending.length || pending.some(op => op.generation !== receipt.generation ||
      !same(op.scope, receipt.scope) || canonical(op) !== receipt.canonicalIntent)) return current;
  const received = recordAccepted(current.ledger, receipt);
  const ledger = current.protection ? received : settleAwaiting(current.state, received);
  return ledger === current.ledger ? current : { ...current, ledger };
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
    if (evidence.protection.length) return { kind: 'protected', reason: 'identity-collision',
      client: { ...current, protection: evidence } };
    const coverage = new Set(expected.state.intents.map(canonical));
    if (current.state.intents.some(op => !coverage.has(canonical(op)))) return keep('rejected', 'operation-coverage-regression');
    return { kind: 'applied', client: { binding: current.binding, checkpoint: { seq: m.seq, hash: m.hash },
      state: expected.state, ledger: settleAwaiting(expected.state, current.ledger), protection: null } };
  } catch { return keep('rejected', 'malformed-publication'); }
}
