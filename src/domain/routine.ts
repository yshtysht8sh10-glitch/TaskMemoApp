import type { CategoryNode, MemoNode, Node, RepeatRule } from "@/models/node";

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
  !!memo.routineHistory?.[localDateKey(date)];

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
    !routineCategoryForMemo(nodes, memo) ||
    !isValidRepeatRule(memo.repeatRule)
  )
    return null;
  if (
    !isRepeatRuleDate(memo.repeatRule, now) ||
    isRoutineCompletedOn(memo, now)
  )
    return null;
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
) {
  const key = localDateKey(date);
  return nodes.map((node) => {
    if (
      node.id !== memoId ||
      node.type !== "memo" ||
      !routineCategoryForMemo(nodes, node)
    )
      return node;
    const routineHistory = { ...node.routineHistory };
    routineHistory[key] = routineHistory[key] ? null : date.toISOString();
    return { ...node, routineHistory, updatedAt: date };
  });
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
      !node.routineHistory?.[key]
    )
      return node;
    const routineHistory = { ...node.routineHistory, [key]: null };
    return { ...node, routineHistory, updatedAt: now };
  });
}

export function routineHistoryDays(
  memo: MemoNode,
  end = new Date(),
  count = 7,
) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(
      end.getFullYear(),
      end.getMonth(),
      end.getDate() - index,
    );
    return {
      key: localDateKey(date),
      date,
      completed: isRoutineCompletedOn(memo, date),
    };
  });
}
