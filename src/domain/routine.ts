import type { CategoryNode, MemoNode, Node } from '@/models/node';

export const localDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function routineCategoryForParent(nodes: Node[], parentId: string | null): CategoryNode | null {
  const byId = new Map(nodes.map((node) => [node.id, node])); const visited = new Set<string>(); let id = parentId;
  while (id && !visited.has(id)) { visited.add(id); const node = byId.get(id); if (!node || node.type !== 'category') return null; if (node.categoryKind === 'routineDaily' || node.categoryKind === 'routineWeekly' || node.categoryKind === 'routineMonthly' || node.categoryKind === 'routineYearly') return node; id = node.parentId; }
  return null;
}

export const routineCategoryForMemo = (nodes: Node[], memo: MemoNode) => routineCategoryForParent(nodes, memo.parentId);

export function isRoutineDueOn(nodes: Node[], memo: MemoNode, date = new Date()) {
  const category = routineCategoryForMemo(nodes, memo); if (!category) return false;
  if (category.categoryKind === 'routineDaily') return true;
  if (category.categoryKind === 'routineWeekly') return category.routineWeekday === date.getDay();
  const targetDay = Math.min(category.routineDayOfMonth ?? category.createdAt.getDate(), new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
  if (category.categoryKind === 'routineMonthly') return date.getDate() === targetDay;
  return date.getMonth() === (category.routineMonth ?? category.createdAt.getMonth()) && date.getDate() === targetDay;
}

export const isRoutineCompletedOn = (memo: MemoNode, date = new Date()) => !!memo.routineHistory?.[localDateKey(date)];

export function routineOccurrenceDueAt(nodes: Node[], memo: MemoNode, now = new Date()) {
  const category = routineCategoryForMemo(nodes, memo); if (!category) return null;
  if (category.categoryKind === 'routineDaily') {
    if (isRoutineCompletedOn(memo, now)) return null;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  }
  if (category.categoryKind === 'routineWeekly') {
    const weekday = category.routineWeekday ?? category.createdAt.getDay();
    let offset = (weekday - now.getDay() + 7) % 7;
    if (offset === 0 && isRoutineCompletedOn(memo, now)) offset = 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 23, 59, 59, 999);
  }
  const configuredDay = category.routineDayOfMonth ?? category.createdAt.getDate();
  const occurrence = (year: number, month: number) => new Date(year, month, Math.min(configuredDay, new Date(year, month + 1, 0).getDate()), 23, 59, 59, 999);
  if (category.categoryKind === 'routineMonthly') {
    let result = occurrence(now.getFullYear(), now.getMonth());
    if (result.getTime() < now.getTime() || (result.getDate() === now.getDate() && isRoutineCompletedOn(memo, now))) result = occurrence(now.getFullYear(), now.getMonth() + 1);
    return result;
  }
  const month = category.routineMonth ?? category.createdAt.getMonth();
  let result = occurrence(now.getFullYear(), month);
  if (result.getTime() < now.getTime() || (result.getMonth() === now.getMonth() && result.getDate() === now.getDate() && isRoutineCompletedOn(memo, now))) result = occurrence(now.getFullYear() + 1, month);
  return result;
}

export function routineScheduleLabel(category: CategoryNode) {
  if (category.categoryKind === 'routineDaily') return '毎日';
  if (category.categoryKind === 'routineWeekly') return `毎週（${['日', '月', '火', '水', '木', '金', '土'][category.routineWeekday ?? category.createdAt.getDay()]}曜日）`;
  if (category.categoryKind === 'routineMonthly') return `毎月（${category.routineDayOfMonth ?? category.createdAt.getDate()}日）`;
  return `毎年（${(category.routineMonth ?? category.createdAt.getMonth()) + 1}月${category.routineDayOfMonth ?? category.createdAt.getDate()}日）`;
}

export function toggleRoutineCompletion(nodes: Node[], memoId: string, date = new Date()) {
  const key = localDateKey(date); return nodes.map((node) => {
    if (node.id !== memoId || node.type !== 'memo' || !routineCategoryForMemo(nodes, node)) return node;
    const routineHistory = { ...node.routineHistory }; if (routineHistory[key]) delete routineHistory[key]; else routineHistory[key] = date.toISOString();
    return { ...node, routineHistory, updatedAt: date };
  });
}

export function routineHistoryDays(memo: MemoNode, end = new Date(), count = 7) { return Array.from({ length: count }, (_, index) => { const date = new Date(end.getFullYear(), end.getMonth(), end.getDate() - index); return { key: localDateKey(date), date, completed: isRoutineCompletedOn(memo, date) }; }); }
