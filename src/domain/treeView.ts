import type { CategoryNode, Node } from '../models/node';
import { compareNodes, visibleNodes } from './nodeOperations';

export const UNASSIGNED_GROUP_ID = '__unassigned__';
const UNASSIGNED_GROUP: CategoryNode = { id: UNASSIGNED_GROUP_ID, type: 'category', parentId: null, sortKey: '', title: '無所属', createdAt: new Date(0), updatedAt: new Date(0), deletedAt: null };
export type VisibleTreeRow = { node: Node; depth: number; ancestorContinuation: boolean[]; hasNextSibling: boolean; virtual?: 'unassigned' };

export function visibleAncestorGuides(depth: number, ancestorContinuation: boolean[], maxVisibleDepth: number) {
  const hiddenLevels = Math.max(0, depth - maxVisibleDepth);
  const visibleDepth = Math.min(depth, maxVisibleDepth);
  // Index 0 describes the root row itself. The first visible guide column
  // describes the root child's continuation, so ancestor guides start at 1.
  return ancestorContinuation.slice(hiddenLevels + 1, hiddenLevels + visibleDepth);
}

export function flattenVisibleNodes(nodes: Node[], expanded: Set<string>, showCompleted = false) {
  const byParent = new Map<string | null, Node[]>();
  for (const node of visibleNodes(nodes, showCompleted)) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  for (const siblings of byParent.values()) siblings.sort(compareNodes);
  const rows: VisibleTreeRow[] = []; const emitted = new Set<string>();
  const walk = (parentId: string | null, depth: number, ancestors: Set<string>, ancestorContinuation: boolean[]) => {
    const siblings = (byParent.get(parentId) ?? []).filter((node) => parentId !== null || node.type === 'category');
    siblings.forEach((node, index) => {
      if (emitted.has(node.id) || ancestors.has(node.id)) return;
      const hasNextSibling = index < siblings.length - 1;
      emitted.add(node.id); rows.push({ node, depth, ancestorContinuation, hasNextSibling });
      if (node.type === 'category' && expanded.has(node.id)) walk(node.id, depth + 1, new Set([...ancestors, node.id]), [...ancestorContinuation, hasNextSibling]);
    });
  };
  const unassigned = (byParent.get(null) ?? []).filter((node) => node.type === 'memo');
  rows.push({ node: UNASSIGNED_GROUP, depth: 0, ancestorContinuation: [], hasNextSibling: (byParent.get(null) ?? []).some((node) => node.type === 'category'), virtual: 'unassigned' });
  if (expanded.has(UNASSIGNED_GROUP_ID)) unassigned.forEach((node, index) => rows.push({ node, depth: 1, ancestorContinuation: [rows[0].hasNextSibling], hasNextSibling: index < unassigned.length - 1 }));
  walk(null, 0, new Set(), []);
  return rows;
}
