import type { MemoNode, Node } from '../models/node';
import { isTask } from './memoType';
import { localDateKey, missedRoutineOccurrences, routineOccurrenceDueAt } from './routine';

export type TaskSearchResult = {
  key: string;
  /** Always the stored definition, never an overdue projection ID. */
  memo: MemoNode;
  folder: string;
  dueAt: Date | null;
  occurrenceKey?: string;
};

/** In-memory projection only: no commands, persistence, or synchronization. */
export function searchTasks(nodes: Node[], query: string, now = new Date()): TaskSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const paths = new Map<string | null, string | null>([[null, '無所属']]);
  const path = (parentId: string | null) => {
    if (paths.has(parentId)) return paths.get(parentId)!;
    const titles: string[] = [], visited = new Set<string>();
    let id = parentId;
    while (id) {
      if (visited.has(id)) { titles.unshift('…'); break; }
      visited.add(id);
      const node = byId.get(id);
      if (!node || node.type !== 'category') break;
      if (node.deletedAt || node.purgedAt) { paths.set(parentId, null); return null; }
      titles.unshift(node.title); id = node.parentId;
    }
    const value = titles.join(' > ') || '無所属';
    paths.set(parentId, value);
    return value;
  };
  const results: TaskSearchResult[] = [];
  for (const memo of nodes) {
    if (memo.type !== 'memo' || !isTask(memo) || memo.status !== 'active' || memo.deletedAt || memo.purgedAt ||
      !memo.title.toLocaleLowerCase().includes(needle)) continue;
    const folder = path(memo.parentId);
    if (folder === null) continue;
    const parent = memo.parentId ? byId.get(memo.parentId) : undefined;
    if (parent?.type === 'category' && parent.categoryKind === 'routineRoot') {
      const dueAt = routineOccurrenceDueAt(nodes, memo, now);
      if (dueAt) results.push({ key: memo.id, memo, folder, dueAt, occurrenceKey: localDateKey(now) });
      for (const occurrence of missedRoutineOccurrences(nodes, memo, now)) {
        results.push({ key: occurrence.id, memo, folder, dueAt: occurrence.dueAt, occurrenceKey: occurrence.routineOccurrenceKey });
      }
    } else results.push({ key: memo.id, memo, folder, dueAt: memo.dueAt });
  }
  return results;
}
