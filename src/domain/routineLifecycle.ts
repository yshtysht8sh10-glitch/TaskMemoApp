import type { MemoNode, Node } from '../models/node';
import { isValidRepeatRule, isRepeatRuleDate, localDateKey, parseLocalDateKey, routineCategoryForMemo } from './routine';

export const isRoutineDefinitionCompleted = (memo: MemoNode) =>
  memo.routineLifecycle?.periods.at(-1)?.resumedAt === null;

/** Eligibility without daily outcomes: historical results remain independently editable. */
export function lifecycleOccurrenceDueAt(memo: MemoNode, date: Date): Date | null {
  const key = localDateKey(date);
  const periods = memo.routineLifecycle?.periods ?? [];
  const overrideValue = memo.routineDueOverrides?.[key];
  const overrideDate = overrideValue ? new Date(overrideValue) : null;
  const override = overrideDate && Number.isFinite(overrideDate.getTime()) ? overrideDate : null;
  for (const period of periods) {
    if (period.retained[key]) return override ?? new Date(period.retained[key]);
  }
  if (!isValidRepeatRule(memo.repeatRule) || !isRepeatRuleDate(memo.repeatRule, date)) return null;
  const due = override ?? (memo.dueAt
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), memo.dueAt.getHours(), memo.dueAt.getMinutes(), memo.dueAt.getSeconds(), memo.dueAt.getMilliseconds())
    : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999));
  for (const period of periods) {
    if (key < localDateKey(new Date(period.completedAt))) continue;
    if (!period.resumedAt || key < localDateKey(new Date(period.resumedAt)) || due.getTime() < Date.parse(period.resumedAt)) return null;
  }
  return due;
}

export function completeRoutineDefinition(nodes: Node[], id: string, now = new Date()): Node[] {
  const memo = nodes.find((n): n is MemoNode => n.id === id && n.type === 'memo');
  if (!memo || memo.deletedAt || memo.purgedAt || !routineCategoryForMemo(nodes, memo)) throw Error('Routineが見つかりません。');
  if (isRoutineDefinitionCompleted(memo)) return nodes;
  const lastResume = memo.routineLifecycle?.periods.at(-1)?.resumedAt;
  if (lastResume && now.getTime() < Date.parse(lastResume)) throw Error('端末日時を確認してください。再開日時より前に完了できません。');
  const retained: Record<string, string> = {};
  if (isValidRepeatRule(memo.repeatRule)) {
    const today = localDateKey(now);
    for (let date = parseLocalDateKey(memo.repeatRule.startsOn)!; localDateKey(date) <= today; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
      const due = lifecycleOccurrenceDueAt(memo, date);
      if (due) retained[localDateKey(date)] = due.toISOString();
    }
  }
  const periods = [...(memo.routineLifecycle?.periods ?? []), { completedAt: now.toISOString(), resumedAt: null, retained }];
  return nodes.map(n => n.id === id ? { ...memo, routineLifecycle: { version: (memo.routineLifecycle?.version ?? 0) + 1, periods }, updatedAt: now } : n);
}

export function resumeRoutineDefinition(nodes: Node[], id: string, now = new Date()): Node[] {
  const memo = nodes.find((n): n is MemoNode => n.id === id && n.type === 'memo');
  if (!memo || memo.deletedAt || memo.purgedAt || !routineCategoryForMemo(nodes, memo)) throw Error('Routineが見つかりません。');
  if (!isRoutineDefinitionCompleted(memo)) return nodes;
  if (now.getTime() < Date.parse(memo.routineLifecycle!.periods.at(-1)!.completedAt)) throw Error('端末日時を確認してください。完了日時より前に再開できません。');
  const periods = memo.routineLifecycle!.periods.map((p, i, all) => i === all.length - 1 ? { ...p, resumedAt: now.toISOString() } : p);
  return nodes.map(n => n.id === id ? { ...memo, routineLifecycle: { version: memo.routineLifecycle!.version + 1, periods }, updatedAt: now } : n);
}
