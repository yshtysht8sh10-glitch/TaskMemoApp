import { generateKeyBetween } from 'fractional-indexing';
import { decodeLegacyNodes } from './legacyLocalCodec';
import type { OwnershipPlan } from './ownershipReconcile';
import type { SyncNodeValue } from './types';

export const OWNERSHIP_ORDER_POLICY = 'account-anchors-v1' as const;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const active = (n: SyncNodeValue) => !n.deletedAt && !n.purgedAt;

/** Pure selected-plan projection. Source/account must each be valid on their own.
 * Only adopted local values can change rank; account anchors and originals stay intact.
 * Unselected items project as account, permitting an incremental UI preview. */
export function integrateOwnershipSortKeys(plan: OwnershipPlan, choices: Record<string, 'local' | 'account'>) {
  if (plan.orderPolicy !== OWNERSHIP_ORDER_POLICY) throw new Error('取り込み順序の仕様が変わりました。最新状態で再確認してください。');
  if (Object.entries(plan.source.nodes).some(([id, n]) => id !== n?.id) ||
      Object.entries(plan.target).some(([id, r]) => id !== r?.value?.id))
    throw new Error('取り込みsnapshotのID対応が不正です。原本を保持しました。');
  decodeLegacyNodes(JSON.stringify(Object.values(plan.source.nodes)));
  decodeLegacyNodes(JSON.stringify(Object.values(plan.target).map(r => r.value)));
  const nodes: Record<string, SyncNodeValue> = Object.fromEntries(Object.entries(plan.target).map(([id, r]) => [id, r.value]));
  const adopted = new Set<string>();
  for (const item of plan.items) {
    if (item.id === '$profile' || item.kind === 'same' || choices[item.id] !== 'local') continue;
    if (!item.local || item.kind === 'purged' || item.local.purgedAt || item.account?.value.purgedAt)
      throw new Error('purged Nodeの採用/復活は禁止です。');
    nodes[item.id] = item.local; adopted.add(item.id);
  }
  const groups = new Map<string, SyncNodeValue[]>();
  for (const n of Object.values(nodes).filter(active)) {
    const key = JSON.stringify(n.parentId ?? null);
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const adjustments: { id: string; before: string; after: string }[] = [];
  for (const siblings of groups.values()) {
    siblings.sort((a, b) => compare(a.sortKey as string, b.sortKey as string) ||
      Number(adopted.has(a.id)) - Number(adopted.has(b.id)) || compare(a.id, b.id));
    let previous: string | null = null;
    for (let i = 0; i < siblings.length; i++) {
      const n = siblings[i], original = n.sortKey as string;
      let key = original;
      if (previous !== null && key <= previous) {
        if (!adopted.has(n.id)) throw new Error('アカウントの兄弟順序が不正です。原本を保持しました。');
        // Bound by the very next original key, preserving every noncolliding local
        // key as well as account anchors. Never fall back to normalizing a whole tree.
        const upper = siblings.slice(i + 1).find(next => (next.sortKey as string) > previous!)?.sortKey as string | undefined;
        key = generateKeyBetween(previous, upper ?? null);
        nodes[n.id] = { ...n, sortKey: key };
        adjustments.push({ id: n.id, before: original, after: key });
      }
      previous = key;
    }
  }
  // The merged Domain still satisfies the original uniqueness/tree checks.
  decodeLegacyNodes(JSON.stringify(Object.values(nodes)));
  adjustments.sort((a, b) => compare(a.id, b.id));
  return { nodes, adjustments };
}
