export type InsertionPosition =
  | { kind: 'prepend' }
  | { kind: 'append' }
  | { kind: 'before'; nodeId: string }
  | { kind: 'after'; nodeId: string };

/** Convert a semantic position into the `beforeId` used by ordered domains. */
export function beforeIdForInsertion(
  orderedIds: readonly string[],
  movingId: string,
  position: InsertionPosition,
) {
  const remaining = orderedIds.filter((id) => id !== movingId);
  if (position.kind === 'prepend') return remaining[0];
  if (position.kind === 'append') return undefined;
  const index = remaining.indexOf(position.nodeId);
  if (index < 0) throw new Error('挿入基準のNodeが見つかりません。');
  return position.kind === 'before' ? remaining[index] : remaining[index + 1];
}
