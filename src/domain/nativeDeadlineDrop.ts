import type { DeadlineGroup, DeadlineGroupKey } from './deadlineView';
import type { InsertionPosition } from './insertionPosition';

/** Native placeholder indices refer to the original displayed rows, not drop data. */
export function nativeDeadlineGroupForPlaceholder(
  rows: readonly { groupKey: DeadlineGroupKey }[],
  index: number,
  groups: readonly DeadlineGroup[],
): DeadlineGroupKey | null {
  const group = groups.find((item) => item.key === rows[index]?.groupKey);
  return group?.create && !group.create.editable ? group.key : null;
}

/** Preserve Native's cross-bucket append only policy; same-bucket drops are no-ops. */
export function nativeDeadlineInsertion(
  active: { id: string; sourceGroup: DeadlineGroupKey } | null,
  target: DeadlineGroupKey | null,
): { id: string; groupKey: DeadlineGroupKey; position: InsertionPosition } | null {
  if (!active || !target || target === active.sourceGroup) return null;
  return { id: active.id, groupKey: target, position: { kind: 'append' } };
}
