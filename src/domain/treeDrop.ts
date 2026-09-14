import { canMoveNode, siblingsOf } from './nodeOperations';
import { UNASSIGNED_GROUP_ID } from './treeView';
import type { Node } from '../models/node';

export type DropCandidate = {
  parentId: string | null;
  /** The sibling that will follow the moving node. Undefined means append. */
  beforeId?: string;
  targetId: string;
  kind: 'inside' | 'before';
};

type DropRow = { node: Node; virtual?: 'unassigned' };

function descendantIds(nodes: Node[], rootId: string) {
  const result = new Set<string>(); let changed = true;
  while (changed) { changed = false; for (const node of nodes) if (node.parentId && (node.parentId === rootId || result.has(node.parentId)) && !result.has(node.id)) { result.add(node.id); changed = true; } }
  return result;
}

/** Resolve the actual insertion gap returned by DraggableFlatList. */
export function resolveDropCandidate(nodes: Node[], movingId: string, hover: DropCandidate, reorderedRows: DropRow[]): DropCandidate | null {
  const movingIndex = reorderedRows.findIndex((row) => row.node.id === movingId);
  if (movingIndex < 0) return null;
  const descendants = descendantIds(nodes, movingId);
  const previous = [...reorderedRows.slice(0, movingIndex)].reverse().find((row) => !descendants.has(row.node.id));
  const next = reorderedRows.slice(movingIndex + 1).find((row) => !descendants.has(row.node.id));

  // The placeholder is immediately before the hovered row. This is a sibling
  // insertion even when that row is a Category; treating it as "inside" loses
  // the final gap and can turn a real move into a no-op.
  if (next?.node.id === hover.targetId) {
    if (next.virtual) return nodes.find((node) => node.id === movingId)?.type === 'memo' ? { parentId: null, targetId: next.node.id, kind: 'inside' } : null;
    const candidate = { parentId: next.node.parentId, beforeId: next.node.id, targetId: next.node.id, kind: 'before' as const };
    return canMoveNode(nodes, movingId, candidate.parentId) ? candidate : null;
  }

  // A placeholder immediately after a Category header represents entering it.
  if (hover.kind === 'inside' && previous?.node.id === hover.targetId) return hover;

  if (next && !next.virtual) {
    const candidate = { parentId: next.node.parentId, beforeId: next.node.id, targetId: next.node.id, kind: 'before' as const };
    return canMoveNode(nodes, movingId, candidate.parentId) ? candidate : null;
  }
  return canMoveNode(nodes, movingId, hover.parentId) ? { ...hover, beforeId: undefined } : null;
}

/** Convert a visual row target into one unambiguous domain insertion point. */
export function dropCandidateFor(nodes: Node[], movingId: string, target?: Node): DropCandidate | null {
  const moving = nodes.find((node) => node.id === movingId && node.deletedAt === null);
  if (!moving || !target || target.id === movingId) return null;

  if (target.id === UNASSIGNED_GROUP_ID) {
    if (moving.type !== 'memo') return null;
    const firstRootMemo = siblingsOf(nodes, null, movingId).find((node) => node.type === 'memo');
    return { parentId: null, beforeId: firstRootMemo?.id, targetId: target.id, kind: 'inside' };
  }

  if (target.type === 'category' && (moving.type === 'memo' || target.parentId !== moving.parentId || target.id === moving.parentId)) {
    if (!canMoveNode(nodes, movingId, target.id)) return null;
    // Dropping on a Category header means inserting at the beginning of that
    // Category. This remains meaningful when it is already the current parent.
    const firstChild = siblingsOf(nodes, target.id, movingId)[0];
    return { parentId: target.id, beforeId: firstChild?.id, targetId: target.id, kind: 'inside' };
  }

  const candidate = { parentId: target.parentId, beforeId: target.id, targetId: target.id, kind: 'before' as const };
  return canMoveNode(nodes, movingId, candidate.parentId) ? candidate : null;
}
