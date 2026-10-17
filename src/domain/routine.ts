import type { CategoryNode, MemoNode, Node, RepeatRule, RoutineOutcome } from "../models/node";

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
  return { state, changedAt: now.toISOString(), version: (memo.routineOutcomes?.[key]?.version ?? 0) + 1 };
}

function setRoutineOutcome(nodes: Node[], memoId: string, date: Date, state: RoutineOutcome['state'], now: Date) {
  const memo = nodes.find((n): n is MemoNode => n.id === memoId && n.type === 'memo');
  if (!memo || memo.deletedAt || memo.purgedAt || !isRoutineDueOn(nodes, memo, date))
    throw new Error('対象日のルーティーンが見つかりません。');
  const key = localDateKey(date);
  if (routineOutcomeOn(memo, key) === state) return nodes;
  const routineHistory = { ...memo.routineHistory };
  // Keep old completion data intact except the selected date when it changes.
  if (state === 'completed') routineHistory[key] = now.toISOString();
  else if (routineHistory[key]) routineHistory[key] = null;
  return nodes.map(n => n.id !== memoId ? n : { ...memo,
    ...(Object.keys(routineHistory).length ? { routineHistory } : {}),
    routineOutcomes: { ...memo.routineOutcomes, [key]: nextRoutineOutcome(memo, key, state, now) }, updatedAt: now });
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
    !isRepeatRuleDate(memo.repeatRule, now) ||
    isRoutineCompletedOn(memo, now) || isRoutineSkippedOn(memo, now)
  )
    return null;
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
    isRepeatRuleDate(memo.repeatRule, date)
  );
};

export function missedRoutineOccurrences(nodes: Node[], memo: MemoNode, now = new Date()): MemoNode[] {
  if (memo.deletedAt !== null || memo.purgedAt || memo.routineOccurrenceKey || !routineCategoryForMemo(nodes, memo) || !isValidRepeatRule(memo.repeatRule)) return [];
  const start = parseLocalDateKey(memo.repeatRule.startsOn)!;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const missed: MemoNode[] = [];
  for (let date = start; date < today; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
    if (!isRepeatRuleDate(memo.repeatRule, date) || isRoutineCompletedOn(memo, date) || isRoutineSkippedOn(memo, date)) continue;
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
  const key = localDateKey(date);
  return nodes.map((node) => {
    if (
      node.id !== memoId ||
      node.type !== "memo" ||
      !isRoutineCompletedOn(node, date)
    )
      return node;
    const routineHistory = { ...node.routineHistory, [key]: null };
    return { ...node, routineHistory, ...(node.routineOutcomes?.[key] ? {
      routineOutcomes: { ...node.routineOutcomes, [key]: nextRoutineOutcome(node, key, 'pending', now) },
    } : {}), updatedAt: now };
  });
}

export function routineHistoryDays(
  memo: MemoNode,
  end = new Date(),
  count = 7,
) {
  if (!isValidRepeatRule(memo.repeatRule)) return [];
  const start = parseLocalDateKey(memo.repeatRule.startsOn)!;
  const days: { key: string; date: Date; completed: boolean }[] = [];
  for (let date = new Date(end.getFullYear(), end.getMonth(), end.getDate()); date >= start && days.length < count; date = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1)) {
    if (!isRepeatRuleDate(memo.repeatRule, date)) continue;
    days.push({ key: localDateKey(date), date, completed: isRoutineCompletedOn(memo, date) });
  }
  return days;
}
