import type { MemoNode, Node } from '@/models/node';

export type CompletionHistoryCriterion = 'completedAt' | 'createdAt';
export const COMPLETION_HISTORY_CRITERIA: readonly { id: CompletionHistoryCriterion; label: string }[] = [{ id: 'completedAt', label: '完了日' }, { id: 'createdAt', label: '作成日' }];
export type CompletionHistoryGroup = { key: string; label: string; memos: MemoNode[] };

const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const localDateLabel = (date: Date) => `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

export function completionHistoryGroups(nodes: Node[], criterion: CompletionHistoryCriterion): CompletionHistoryGroup[] {
  const memos = nodes.filter((node): node is MemoNode => node.type === 'memo' && node.deletedAt === null && node.status === 'completed');
  const dateFor = (memo: MemoNode) => criterion === 'completedAt' ? memo.completedAt ?? memo.updatedAt : memo.createdAt;
  memos.sort((a, b) => dateFor(b).getTime() - dateFor(a).getTime() || a.id.localeCompare(b.id));
  const groups = new Map<string, CompletionHistoryGroup>();
  for (const memo of memos) { const date = dateFor(memo); const key = localDateKey(date); const group = groups.get(key); if (group) group.memos.push(memo); else groups.set(key, { key, label: localDateLabel(date), memos: [memo] }); }
  return [...groups.values()];
}
