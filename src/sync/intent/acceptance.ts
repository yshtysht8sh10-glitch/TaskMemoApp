import { canonical, same } from './canonical';
import type { AcceptedReceipt, Baseline, DeliveryLedger, Intent } from './types';
import { intentError, validateBaseline } from './validation';

export type AcceptanceDecision =
  | Readonly<{ kind: 'accepted' | 'duplicate'; receipt: AcceptedReceipt }>
  | Readonly<{ kind: 'rejected'; reason: string; evidence: Intent }>;

/** Pure decision, NOT a server receipt writer. Authentication/freeze transactions are out of scope. */
export function evaluateAcceptance(baseline: Baseline, receipts: readonly AcceptedReceipt[], intent: Intent): AcceptanceDecision {
  validateBaseline(baseline);
  const error = intentError(baseline, intent);
  if (error) return { kind: 'rejected', reason: error, evidence: intent };
  const payload = canonical(intent);
  const prior = receipts.filter(r => r.opId === intent.opId);
  if (prior.length) {
    if (prior.some(r => r.kind !== 'accepted' || !same(r.scope, intent.scope) || r.generation !== intent.generation || r.canonicalIntent !== payload))
      return { kind: 'rejected', reason: 'receipt-identity-collision', evidence: intent };
    return { kind: 'duplicate', receipt: prior[0] };
  }
  return { kind: 'accepted', receipt: { kind: 'accepted', scope: intent.scope, generation: intent.generation, opId: intent.opId, canonicalIntent: payload } };
}

/** Candidate for a future atomic CAS. The caller must not publish it before durable commit succeeds. */
export function recordAccepted(ledger: DeliveryLedger, receipt: AcceptedReceipt): DeliveryLedger {
  const matches = (op: Intent) => receipt.kind === 'accepted' && op.opId === receipt.opId &&
    op.generation === receipt.generation && same(op.scope, receipt.scope) && canonical(op) === receipt.canonicalIntent;
  const moved = ledger.outbox.filter(matches);
  if (!moved.length) return ledger;
  // Never discard an existing pending identity with a different immutable payload.
  if (moved.some(op => ledger.awaiting.some(a => a.opId === op.opId && !same(a, op)))) return ledger;
  return { outbox: ledger.outbox.filter(op => !matches(op)),
    awaiting: [...ledger.awaiting, ...moved.filter(op => !ledger.awaiting.some(a => same(a, op)))] };
}
