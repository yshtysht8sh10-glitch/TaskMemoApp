import type { CategoryNode, MemoNode, Node, RepeatRule, RoutineOutcome } from "../models/node";
import { lifecycleOccurrenceDueAt } from './routineLifecycle';
import { assertRoutineOutcomesReadable, validRoutineOutcome } from './routineOutcomeMerge';

export const localDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function parseLocalDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return localDateKey(date) === value ? date : null;
}

export function isValidRepeatRule(
  rule: RepeatRule | null | undefined,
): rule is RepeatRule {
  return (
    !!rule &&
    ["day", "week", "month", "year"].includes(rule.frequency) &&
    Number.isInteger(rule.interval) &&
    rule.interval >= 1 &&
    !!parseLocalDateKey(rule.startsOn)
  );
}

export function routineCategoryForParent(
  nodes: Node[],
  parentId: string | null,
): CategoryNode | null {
  const parent = nodes.find(
    (node) =>
      node.id === parentId &&
      node.type === "category" &&
      node.deletedAt === null &&
      !node.purgedAt,
  );
  return parent?.type === "category" && parent.categoryKind === "routineRoot"
    ? parent
    : null;
}

export const routineCategoryForMemo = (nodes: Node[], memo: MemoNode) =>
  memo.memoType === "idea"
    ? null
    : routineCategoryForParent(nodes, memo.parentId);
export const isRoutineCompletedOn = (memo: MemoNode, date = new Date()) =>
  routineOutcomeOn(memo, localDateKey(date)) === 'completed';

export const routineOutcomeOn = (memo: MemoNode, key: string): RoutineOutcome['state'] =>
  memo.routineOutcomes?.[key]?.state ?? (memo.routineHistory?.[key] ? 'completed' : 'pending');
export const isRoutineSkippedOn = (memo: MemoNode, date = new Date()) =>
  routineOutcomeOn(memo, localDateKey(date)) === 'skipped';

export function nextRoutineOutcome(memo: MemoNode, key: string, state: RoutineOutcome['state'], now: Date): RoutineOutcome {
  assertRoutineOutcomesReadable(memo.routineOutcomes);
  const old = memo.routineOutcomes?.[key];
  if (old && new Date(old.changedAt).toISOString() !== old.changedAt)
    throw new Error('旧実績の時刻形式を安全に比較できません。原本を保持して保留します。');
  const version = (old?.version ?? 0) + 1;
  if (!Number.isSafeInteger(version)) throw new Error('実績の版上限です。原本を保持して停止します。');
  return { state, changedAt: now.toISOString(), version };
}

export const isFinalRoutineOutcome = (state: RoutineOutcome['state']) =>
  state === 'completed' || state === 'skipped' || state === 'missed';

/** Stable ID + original date. Existing saved evidence survives rule changes. */
export function setRoutineResult(nodes: Node[], memoId: string, date: Date, state: RoutineOutcome['state'], now = new Date()) {
  const memo = nodes.find((n): n is MemoNode => n.id === memoId && n.type === 'memo');
  const key = localDateKey(date);
  if (!memo || memo.deletedAt || memo.purgedAt || !routineCategoryForMemo(nodes, memo) || !parseLocalDateKey(key) || key > localDateKey(now))
    throw new Error('対象日のルーティーンが見つかりません。');
  assertRoutineOutcomesReadable(memo.routineOutcomes);
  const saved = validRoutineOutcome(memo.routineOutcomes?.[key]) ||
    (typeof memo.routineHistory?.[key] === 'string' && Number.isFinite(Date.parse(memo.routineHistory[key]!)));
  if (!saved && !isRoutineDueOn(nodes, memo, date)) throw new Error('未発生または根拠のない過去回です。');
  if (routineOutcomeOn(memo, key) === state) return nodes;
  const outcome = nextRoutineOutcome(memo, key, state, now);
  const routineHistory = { ...memo.routineHistory };
  if (state === 'completed') routineHistory[key] = outcome.changedAt;
  else if (key in routineHistory) routineHistory[key] = null;
  return nodes.map(n => n.id !== memoId ? n : { ...memo, routineOutcomes: { ...memo.routineOutcomes, [key]: outcome },
    ...(Object.keys(routineHistory).length ? { routineHistory } : {}), updatedAt: now });
}
export const clearRoutineResult = (nodes: Node[], memoId: string, date: Date, now = new Date()) =>
  setRoutineResult(nodes, memoId, date, 'pending', now);

function setRoutineOutcome(nodes: Node[], memoId: string, date: Date, state: RoutineOutcome['state'], now: Date) {
  return setRoutineResult(nodes, memoId, date, state, now);
}

export const skipRoutineOccurrence = (nodes: Node[], memoId: string, date: Date, now = new Date()) =>
  setRoutineOutcome(nodes, memoId, date, 'skipped', now);
export const completeRoutineOccurrence = (nodes: Node[], memoId: string, date: Date, now = new Date()) =>
  setRoutineOutcome(nodes, memoId, date, 'completed', now);
export function clearRoutineSkip(nodes: Node[], memoId: string, date: Date, now = new Date()) {
  const memo = nodes.find((n): n is MemoNode => n.id === memoId && n.type === 'memo');
  return memo && isRoutineSkippedOn(memo, date) ? setRoutineOutcome(nodes, memoId, date, 'pending', now) : nodes;
}

const endOfDay = (date: Date) =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
const daysBetween = (a: Date, b: Date) =>
  Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86400000,
  );
const clampedDate = (year: number, month: number, day: number) =>
  new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));

export function isRepeatRuleDate(rule: RepeatRule, date: Date) {
  const start = parseLocalDateKey(rule.startsOn)!;
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (today < start) return false;
  if (rule.frequency === "day" || rule.frequency === "week") {
    const elapsed = daysBetween(start, today);
    const cycle = rule.interval * (rule.frequency === "week" ? 7 : 1);
    return elapsed % cycle === 0;
  }
  if (rule.frequency === "month") {
    const elapsed =
      (today.getFullYear() - start.getFullYear()) * 12 +
      today.getMonth() -
      start.getMonth();
    return (
      elapsed % rule.interval === 0 &&
      localDateKey(today) ===
        localDateKey(
          clampedDate(today.getFullYear(), today.getMonth(), start.getDate()),
        )
    );
  }
  const elapsed = today.getFullYear() - start.getFullYear();
  return (
    elapsed % rule.interval === 0 &&
    localDateKey(today) ===
      localDateKey(
        clampedDate(today.getFullYear(), start.getMonth(), start.getDate()),
      )
  );
}

export function routineOccurrenceDueAt(
  nodes: Node[],
  memo: MemoNode,
  now = new Date(),
) {
  if (
    memo.deletedAt !== null || !!memo.purgedAt ||
    !routineCategoryForMemo(nodes, memo) ||
    !isValidRepeatRule(memo.repeatRule)
  )
    return null;
  if (
    !lifecycleOccurrenceDueAt(memo, now) ||
    isFinalRoutineOutcome(routineOutcomeOn(memo, localDateKey(now)))
  )
    return null;
  if (memo.routineLifecycle) return lifecycleOccurrenceDueAt(memo, now);
  const overridden = memo.routineDueOverrides?.[localDateKey(now)];
  if (overridden) {
    const date = new Date(overridden);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (memo.dueAt) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), memo.dueAt.getHours(), memo.dueAt.getMinutes(), memo.dueAt.getSeconds(), memo.dueAt.getMilliseconds());
  return endOfDay(now);
}

export const isRoutineDueOn = (
  nodes: Node[],
  memo: MemoNode,
  date = new Date(),
) => {
  return (
    !!routineCategoryForMemo(nodes, memo) &&
    isValidRepeatRule(memo.repeatRule) &&
    !!lifecycleOccurrenceDueAt(memo, date)
  );
};

export function missedRoutineOccurrences(nodes: Node[], memo: MemoNode, now = new Date()): MemoNode[] {
  if (memo.deletedAt !== null || memo.purgedAt || memo.routineOccurrenceKey || !routineCategoryForMemo(nodes, memo) || !isValidRepeatRule(memo.repeatRule)) return [];
  const retainedKeys = memo.routineLifecycle?.periods.flatMap(p => Object.keys(p.retained)) ?? [];
  const first = [memo.repeatRule.startsOn, ...retainedKeys].sort()[0];
  const start = parseLocalDateKey(first)!;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const missed: MemoNode[] = [];
  for (let date = start; date < today; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
    if (isFinalRoutineOutcome(routineOutcomeOn(memo, localDateKey(date)))) continue;
    const dueAt = routineOccurrenceDueAt(nodes, memo, date);
    if (!dueAt) continue;
    const key = localDateKey(date);
    missed.push({ ...memo, id: `routine-overdue:${memo.id}:${key}`, dueAt, routineOccurrenceKey: key, routineSourceId: memo.id });
  }
  return missed;
}

export function repeatRuleLabel(rule: RepeatRule | null | undefined) {
  if (!isValidRepeatRule(rule)) return "未設定";
  const units = { day: "日", week: "週間", month: "か月", year: "年" } as const;
  if (rule.interval === 1)
    return { day: "毎日", week: "毎週", month: "毎月", year: "毎年" }[
      rule.frequency
    ];
  return `${rule.interval}${units[rule.frequency]}おき`;
}

export function toggleRoutineCompletion(
  nodes: Node[],
  memoId: string,
  date = new Date(),
  now = date,
) {
  const memo = nodes.find((n): n is MemoNode => n.id === memoId && n.type === 'memo');
  if (!memo || !routineCategoryForMemo(nodes, memo)) return nodes;
  // Legacy routines without rules can still cancel an existing completion.
  const completed = isRoutineCompletedOn(memo, date);
  if (completed) return clearRoutineCompletion(nodes, memoId, date, now);
  if (!isRoutineDueOn(nodes, memo, date)) return nodes;
  return completeRoutineOccurrence(nodes, memoId, date, now);
}

export function clearRoutineCompletion(
  nodes: Node[],
  memoId: string,
  date: Date,
  now = new Date(),
) {
  const memo = nodes.find((n): n is MemoNode => n.id === memoId && n.type === 'memo');
  return memo && isRoutineCompletedOn(memo, date) ? clearRoutineResult(nodes, memoId, date, now) : nodes;
}

/** Saved results shared by the completed list and the Routine editor.
 * Target dates are identities; changedAt is the actual action timestamp. */
export function recordedRoutineResults(memo: MemoNode) {
  assertRoutineOutcomesReadable(memo.routineOutcomes);
  const results: { key: string; date: Date; outcome: 'completed' | 'skipped' | 'missed'; changedAt: Date }[] = [];
  for (const key of new Set([...Object.keys(memo.routineHistory ?? {}), ...Object.keys(memo.routineOutcomes ?? {})])) {
    const outcome = routineOutcomeOn(memo, key);
    if (outcome !== 'completed' && outcome !== 'skipped' && outcome !== 'missed') continue;
    const timestamp = memo.routineOutcomes?.[key]?.changedAt ?? memo.routineHistory?.[key];
    const date = parseLocalDateKey(key), changedAt = timestamp ? new Date(timestamp) : null;
    if (date && changedAt && Number.isFinite(changedAt.getTime())) results.push({ key, date, outcome, changedAt });
  }
  return results.sort((a, b) => b.key.localeCompare(a.key));
}

export type RoutineHistoryDay = { key: string; date: Date; completed: boolean; outcome: RoutineOutcome['state'] };

export function routineHistoryDays(
  memo: MemoNode,
  end = new Date(),
  count = 7,
): RoutineHistoryDay[] {
  const today = localDateKey(end);
  const days: RoutineHistoryDay[] = recordedRoutineResults(memo)
    .filter(result => result.key <= today)
    .map(result => ({ key: result.key, date: result.date, completed: result.outcome === 'completed', outcome: result.outcome }));
  if (memo.status === 'active' && memo.deletedAt === null && !memo.purgedAt && memo.memoType !== 'idea' &&
    isValidRepeatRule(memo.repeatRule) && lifecycleOccurrenceDueAt(memo, end) && routineOutcomeOn(memo, today) === 'pending') {
    days.unshift({ key: today, date: new Date(end.getFullYear(), end.getMonth(), end.getDate()), completed: false, outcome: 'pending' });
  }
  return days.slice(0, Math.max(0, count));
}
