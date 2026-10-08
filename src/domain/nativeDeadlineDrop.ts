import type { DeadlineGroup, DeadlineGroupKey } from './deadlineView';
import type { InsertionPosition } from './insertionPosition';

/** Native placeholder indices refer to the original displayed rows, not drop data. */
export function nativeDeadlineGroupForPlaceholder(
  rows: readonly { groupKey: DeadlineGroupKey }[],
  index: number,
  groups: readonly DeadlineGroup[],
  sourceGroup?: DeadlineGroupKey,
): DeadlineGroupKey | null {
  const group = groups.find((item) => item.key === rows[index]?.groupKey);
  return group && (group.key === sourceGroup || (group.create && !group.create.editable)) ? group.key : null;
}

/** Same-bucket reorders use final rows; cross-bucket moves retain append policy. */
export function nativeDeadlineInsertion(
  active: { id: string; sourceGroup: DeadlineGroupKey } | null,
  target: DeadlineGroupKey | null,
  reorderedRows?: readonly { id: string; kind: string; groupKey: DeadlineGroupKey }[],
): { id: string; groupKey: DeadlineGroupKey; position: InsertionPosition } | null {
  if (!active || !target) return null;
  if (target === active.sourceGroup) {
    if (!reorderedRows) return null;
    const index = reorderedRows.findIndex((row) => row.id === active.id);
    if (index < 0) return null;
    const next = reorderedRows.slice(index + 1).find((row) => row.kind === 'memo' && row.groupKey === target);
    return { id: active.id, groupKey: target, position: next ? { kind: 'before', nodeId: next.id } : { kind: 'append' } };
  }
  return { id: active.id, groupKey: target, position: { kind: 'append' } };
}
