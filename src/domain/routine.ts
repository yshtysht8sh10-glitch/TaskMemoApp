import type { CategoryNode, MemoNode, Node } from '@/models/node';

export const localDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function routineCategoryForParent(nodes: Node[], parentId: string | null): CategoryNode | null {
  const byId = new Map(nodes.map((node) => [node.id, node])); const visited = new Set<string>(); let id = parentId;
  while (id && !visited.has(id)) { visited.add(id); const node = byId.get(id); if (!node || node.type !== 'category') return null; if (node.categoryKind === 'routineDaily' || node.categoryKind === 'routineWeekly') return node; id = node.parentId; }
  return null;
}

export const routineCategoryForMemo = (nodes: Node[], memo: MemoNode) => routineCategoryForParent(nodes, memo.parentId);

export function isRoutineDueOn(nodes: Node[], memo: MemoNode, date = new Date()) {
  const category = routineCategoryForMemo(nodes, memo); if (!category) return false;
  return category.categoryKind === 'routineDaily' || category.routineWeekday === date.getDay();
}

export const isRoutineCompletedOn = (memo: MemoNode, date = new Date()) => !!memo.routineHistory?.[localDateKey(date)];

export function routineOccurrenceDueAt(nodes: Node[], memo: MemoNode, now = new Date()) {
  const category = routineCategoryForMemo(nodes, memo); if (!category) return null;
  if (category.categoryKind === 'routineDaily') {
    if (isRoutineCompletedOn(memo, now)) return null;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  }
  const weekday = category.routineWeekday ?? category.createdAt.getDay();
  let offset = (weekday - now.getDay() + 7) % 7;
  if (offset === 0 && isRoutineCompletedOn(memo, now)) offset = 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 23, 59, 59, 999);
}

export function toggleRoutineCompletion(nodes: Node[], memoId: string, date = new Date()) {
  const key = localDateKey(date); return nodes.map((node) => {
    if (node.id !== memoId || node.type !== 'memo' || !routineCategoryForMemo(nodes, node)) return node;
    const routineHistory = { ...node.routineHistory }; if (routineHistory[key]) delete routineHistory[key]; else routineHistory[key] = date.toISOString();
    return { ...node, routineHistory, updatedAt: date };
  });
}

export function routineHistoryDays(memo: MemoNode, end = new Date(), count = 7) { return Array.from({ length: count }, (_, index) => { const date = new Date(end.getFullYear(), end.getMonth(), end.getDate() - index); return { key: localDateKey(date), date, completed: isRoutineCompletedOn(memo, date) }; }); }
