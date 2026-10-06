import { canonical } from '../textFormat/syntax';
import type { SyncNodeValue, VersionedNode, VersionedPinnedNote, VersionedFeatures } from './types';
import { OWNERSHIP_ORDER_POLICY } from './ownershipSortKeys';
export type AnonymousSnapshot = { scope: string; nodes: Record<string, SyncNodeValue>; profile: { body: string; ideasEnabled: boolean } };
export type OwnershipLedger = {
  sourceScope: string; targetScope: string; source: AnonymousSnapshot;
  ancestors: Record<string, SyncNodeValue>;
  state: 'completed' | 'skipped';
};
const equal = (a: unknown, b: unknown) => canonical(a ?? null) === canonical(b ?? null);
const applicable = (ledger: OwnershipLedger | undefined, source: AnonymousSnapshot, target: string) =>
  ledger?.sourceScope === source.scope && ledger.targetScope === target ? ledger : undefined;
/** Never receives cloud state. Normal synchronization cannot trigger a review. */
export function pendingAnonymousChanges(source: AnonymousSnapshot, ledger: OwnershipLedger | undefined, target: string): string[] {
  const previous = applicable(ledger, source, target)?.source;
  const ids = new Set([...Object.keys(source.nodes), ...Object.keys(previous?.nodes ?? {})]);
  const changed = [...ids].filter(id => !equal(source.nodes[id], previous?.nodes[id])).sort();
  if (previous ? !equal(source.profile, previous.profile) : source.profile.body !== '' || source.profile.ideasEnabled) changed.push('$profile');
  return changed;
}
export type ReconcileItem = { id: string; kind: 'same' | 'add' | 'apply' | 'conflict' | 'purged'; local: SyncNodeValue | null; account: VersionedNode | null };
export type OwnershipPlan = { orderPolicy: typeof OWNERSHIP_ORDER_POLICY; source: AnonymousSnapshot; targetScope: string; target: Record<string, VersionedNode>; targetProfile: { pinnedNote: VersionedPinnedNote | null; features: VersionedFeatures | null }; items: ReconcileItem[]; needsReview: boolean; fingerprint: string };
/** Only an untouched empty Account can adopt an unambiguous initial snapshot.
 * The caller must obtain the target from the server after compatibility checks. */
export function canAutoAdoptInitialOwnership(plan: OwnershipPlan, receiptDocumentCount: number) {
  return receiptDocumentCount === 0 && Object.keys(plan.target).length === 0 &&
    plan.targetProfile.pinnedNote === null && plan.targetProfile.features === null && plan.items.length > 0 &&
    plan.items.every(item => item.id === '$profile' || (item.kind === 'add' && item.local &&
      !item.local.deletedAt && !item.local.purgedAt && !item.local.routineOccurrenceKey && !item.local.routineSourceId));
}
export function planOwnershipReconcile(source: AnonymousSnapshot, target: Record<string, VersionedNode>, ledger: OwnershipLedger | undefined, targetScope: string,
  targetProfile: OwnershipPlan['targetProfile'] = { pinnedNote: null, features: null }): OwnershipPlan {
  const history = applicable(ledger, source, targetScope);
  const items = pendingAnonymousChanges(source, ledger, targetScope).map((id): ReconcileItem => {
    const local = source.nodes[id] ?? null; const account = target[id] ?? null;
    if (id === '$profile') return { id, local: null, account: null, kind: 'conflict' };
    const ancestor = history?.ancestors[id];
    const kind = !local ? 'conflict' : equal(local, account?.value) ? 'same'
      : account?.value.purgedAt || local.purgedAt ? 'purged'
      : !account && !local.deletedAt ? 'add'
      : ancestor && equal(account?.value, ancestor) && !local.deletedAt && !account?.value.deletedAt ? 'apply' : 'conflict';
    return { id, local, account, kind };
  });
  const plan = { orderPolicy: OWNERSHIP_ORDER_POLICY, source, targetScope, target, targetProfile, items, needsReview: items.some(i => i.kind !== 'same') };
  return JSON.parse(JSON.stringify({ ...plan, fingerprint: canonical(plan) }));
}
