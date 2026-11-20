import type { MemoNode } from '@/models/node';

/** Display the stored instant; never recalculate a relative preset. */
export function formatDeadlineInstant(date: Date | null): string | null {
  if (!date || !Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}まで`;
}

export function formatDueLabel(memo: MemoNode): string | null {
  return formatDeadlineInstant(memo.dueAt);
}
