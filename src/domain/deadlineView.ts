import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import type { DuePreset, MemoNode, Node } from "@/models/node";
import { compareSortKeys } from "./nodeOperations";
import { routineCategoryForMemo, routineOccurrenceDueAt } from "./routine";
import { isTask } from "./memoType";
import { beforeIdForInsertion } from "./insertionPosition";

export type TodayGranularity = "today" | "dayNight" | "amPm" | "threePart";
export const TODAY_GRANULARITIES: readonly {
  id: TodayGranularity;
  label: string;
}[] = [
  { id: "today", label: "今日" },
  { id: "dayNight", label: "昼間/夜" },
  { id: "amPm", label: "午前/午後" },
  { id: "threePart", label: "朝/昼/夜" },
];
export type DeadlineGroupKey =
  | "overdue"
  | "today"
  | "daytime"
  | "night"
  | "am"
  | "pm"
  | "morning"
  | "day"
  | "evening"
  | "tomorrow"
  | "twoThreeDays"
  | "thisWeek"
  | "nextWeek"
  | "thisMonth"
  | "thisYear"
  | "later"
  | "none";
export type DeadlineCreateContext = {
  label: string;
  initialDuePreset: DuePreset;
  initialDueAt: Date | null;
  dueEditable: boolean;
  targetGroup: DeadlineGroupKey;
  granularity: TodayGranularity;
};
type CreateRule = {
  preset: DuePreset;
  dueAt: (now: Date) => Date | null;
  editable?: boolean;
};
export type DeadlineGroupDefinition = {
  id: DeadlineGroupKey;
  label: string;
  create: CreateRule | null;
  fallbackGroupId: DeadlineGroupKey | null;
  dropLabel?: string;
};
export type DeadlineGroup = DeadlineGroupDefinition & {
  key: DeadlineGroupKey;
  memos: MemoNode[];
};

const endOfDay = (date: Date) => {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
};
const at = (now: Date, hour: number) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour);
const dayEnd = (now: Date, offset: number) =>
  endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
const fixed = (
  preset: DuePreset,
  dueAt: (now: Date) => Date | null,
): CreateRule => ({ preset, dueAt });
const custom = (dueAt: (now: Date) => Date, editable = false): CreateRule => ({
  preset: "custom",
  dueAt,
  editable,
});

const todayDefinitions: Record<
  TodayGranularity,
  readonly DeadlineGroupDefinition[]
> = {
  today: [
    {
      id: "today",
      label: "今日",
      create: fixed("today", (now) => dayEnd(now, 0)),
      fallbackGroupId: "tomorrow",
      dropLabel: "今日までに変更",
    },
  ],
  dayNight: [
    {
      id: "daytime",
      label: "今日-昼間（～19:00）",
      create: custom((now) => at(now, 19)),
      fallbackGroupId: "night",
      dropLabel: "今日19時までに変更",
    },
    {
      id: "night",
      label: "今日-夜（～24:00）",
      create: fixed("today", (now) => dayEnd(now, 0)),
      fallbackGroupId: "tomorrow",
      dropLabel: "今日中に変更",
    },
  ],
  amPm: [
    {
      id: "am",
      label: "今日-午前（～12:00）",
      create: custom((now) => at(now, 12)),
      fallbackGroupId: "pm",
      dropLabel: "今日12時までに変更",
    },
    {
      id: "pm",
      label: "今日-午後（～24:00）",
      create: fixed("today", (now) => dayEnd(now, 0)),
      fallbackGroupId: "tomorrow",
      dropLabel: "今日中に変更",
    },
  ],
  threePart: [
    {
      id: "morning",
      label: "今日-朝（～10:00）",
      create: custom((now) => at(now, 10)),
      fallbackGroupId: "day",
      dropLabel: "今日10時までに変更",
    },
    {
      id: "day",
      label: "今日-昼（～17:00）",
      create: custom((now) => at(now, 17)),
      fallbackGroupId: "evening",
      dropLabel: "今日17時までに変更",
    },
    {
      id: "evening",
      label: "今日-夜（～24:00）",
      create: fixed("today", (now) => dayEnd(now, 0)),
      fallbackGroupId: "tomorrow",
      dropLabel: "今日中に変更",
    },
  ],
};
const common: readonly DeadlineGroupDefinition[] = [
  { id: "overdue", label: "期限切れ", create: null, fallbackGroupId: null },
  {
    id: "tomorrow",
    label: "明日",
    create: fixed("tomorrow", (now) => dayEnd(now, 1)),
    fallbackGroupId: "twoThreeDays",
    dropLabel: "明日までに変更",
  },
  {
    id: "twoThreeDays",
    label: "2〜3日以内",
    create: custom((now) => dayEnd(now, 3)),
    fallbackGroupId: "thisWeek",
    dropLabel: "3日以内に変更",
  },
  {
    id: "thisWeek",
    label: "今週",
    create: fixed("thisWeek", (now) => dayEnd(now, (7 - now.getDay()) % 7)),
    fallbackGroupId: "nextWeek",
    dropLabel: "今週までに変更",
  },
  {
    id: "nextWeek",
    label: "来週",
    create: custom((now) => dayEnd(now, ((7 - now.getDay()) % 7) + 7)),
    fallbackGroupId: "thisMonth",
    dropLabel: "来週までに変更",
  },
  {
    id: "thisMonth",
    label: "今月",
    create: fixed("thisMonth", (now) =>
      endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    ),
    fallbackGroupId: "thisYear",
    dropLabel: "今月までに変更",
  },
  {
    id: "thisYear",
    label: "今年",
    create: fixed("thisYear", (now) =>
      endOfDay(new Date(now.getFullYear(), 11, 31)),
    ),
    fallbackGroupId: "later",
    dropLabel: "今年までに変更",
  },
  {
    id: "later",
    label: "それ以降",
    create: custom((now) => new Date(now.getFullYear() + 1, 0, 1), true),
    fallbackGroupId: null,
  },
  {
    id: "none",
    label: "期限なし",
    create: fixed("none", () => null),
    fallbackGroupId: null,
    dropLabel: "期限なしに変更",
  },
];
export function deadlineGroupDefinitions(granularity: TodayGranularity) {
  return [common[0], ...todayDefinitions[granularity], ...common.slice(1)];
}
export const ALL_DEADLINE_GROUPS = [
  common[0],
  ...Object.values(todayDefinitions).flat(),
  ...common.slice(1),
];
export const DEADLINE_GROUPS = deadlineGroupDefinitions("amPm");
export const allDeadlineGroupIds = () => [
  ...new Set(ALL_DEADLINE_GROUPS.map((group) => group.id)),
];

const boundaries = (now: Date) => {
  const weekOffset = (7 - now.getDay()) % 7;
  return {
    todayEnd: dayEnd(now, 0),
    tomorrowEnd: dayEnd(now, 1),
    threeDaysEnd: dayEnd(now, 3),
    weekEnd: dayEnd(now, weekOffset),
    nextWeekEnd: dayEnd(now, weekOffset + 7),
    monthEnd: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    yearEnd: endOfDay(new Date(now.getFullYear(), 11, 31)),
  };
};
export function deadlineGroupForDueAt(
  dueAt: Date | null,
  now = new Date(),
  granularity: TodayGranularity = "amPm",
): DeadlineGroupKey {
  if (!dueAt) return "none";
  const time = dueAt.getTime();
  const b = boundaries(now);
  if (time < now.getTime()) return "overdue";
  if (time <= b.todayEnd.getTime()) {
    const value = dueAt.getHours() + dueAt.getMinutes() / 60;
    if (granularity === "today") return "today";
    if (granularity === "dayNight") return value <= 19 ? "daytime" : "night";
    if (granularity === "amPm") return value <= 12 ? "am" : "pm";
    return value <= 10 ? "morning" : value <= 17 ? "day" : "evening";
  }
  if (time <= b.tomorrowEnd.getTime()) return "tomorrow";
  if (time <= b.threeDaysEnd.getTime()) return "twoThreeDays";
  if (time <= b.weekEnd.getTime()) return "thisWeek";
  if (time <= b.nextWeekEnd.getTime()) return "nextWeek";
  if (time <= b.monthEnd.getTime()) return "thisMonth";
  if (time <= b.yearEnd.getTime()) return "thisYear";
  return "later";
}
export const deadlineGroupForMemo = (
  memo: MemoNode,
  now = new Date(),
  granularity: TodayGranularity = "amPm",
) => {
  const byDate = deadlineGroupForDueAt(memo.dueAt, now, granularity);
  // Late in the week, the calendar-week endpoint overlaps the earlier
  // "today / tomorrow / 2-3 days" buckets. Preserve the explicit quick-add or
  // drop intent while the generated deadline is still in the current week.
  if (
    memo.duePreset === "thisWeek" &&
    memo.dueAt &&
    memo.dueAt.getTime() >= now.getTime() &&
    memo.dueAt.getTime() <= boundaries(now).weekEnd.getTime()
  )
    return "thisWeek";
  return byDate;
};
export function visibleDeadlineGroup(
  source: DeadlineGroupKey,
  visible: ReadonlySet<DeadlineGroupKey>,
  _granularity: TodayGranularity,
): DeadlineGroupKey | null {
  return visible.has(source) ? source : null;
}
export function deadlineCreateContext(
  definition: DeadlineGroupDefinition,
  now = new Date(),
  granularity: TodayGranularity = "amPm",
): DeadlineCreateContext | null {
  if (!definition.create) return null;
  return {
    label: definition.label,
    initialDuePreset: definition.create.preset,
    initialDueAt: definition.create.dueAt(now),
    dueEditable: !!definition.create.editable,
    targetGroup: definition.id,
    granularity,
  };
}
export function deadlineDraftForCreateContext(
  context: DeadlineCreateContext,
  editableDueAt?: Date | null,
  now = new Date(),
) {
  const dueAt = context.dueEditable
    ? (editableDueAt ?? null)
    : context.initialDueAt;
  if (
    context.dueEditable &&
    deadlineGroupForDueAt(dueAt, now, context.granularity) !==
      context.targetGroup
  )
    throw new Error(`「${context.label}」に入る期限を指定してください。`);
  return { duePreset: context.initialDuePreset, dueAt };
}
export function deadlineGroups(
  nodes: Node[],
  now = new Date(),
  visibleGroupIds?: ReadonlySet<DeadlineGroupKey>,
  granularity: TodayGranularity = "amPm",
): DeadlineGroup[] {
  const definitions = deadlineGroupDefinitions(granularity);
  const visible =
    visibleGroupIds ?? new Set(definitions.map((group) => group.id));
  const grouped = new Map<DeadlineGroupKey, MemoNode[]>();
  const occurrenceDueAt = (memo: MemoNode) =>
    routineCategoryForMemo(nodes, memo)
      ? routineOccurrenceDueAt(nodes, memo, now)
      : memo.dueAt;
  const memos = nodes
    .filter(
      (node): node is MemoNode =>
        node.type === "memo" &&
        isTask(node) &&
        node.status === "active" &&
        node.deletedAt === null &&
        (!routineCategoryForMemo(nodes, node) ||
          occurrenceDueAt(node) !== null),
    )
    .sort((a, b) =>
      a.deadlineSortKey && b.deadlineSortKey
        ? compareSortKeys(a.deadlineSortKey, b.deadlineSortKey) ||
          a.id.localeCompare(b.id)
        : (occurrenceDueAt(a)?.getTime() ?? Infinity) -
            (occurrenceDueAt(b)?.getTime() ?? Infinity) ||
          compareSortKeys(a.sortKey, b.sortKey) ||
          a.id.localeCompare(b.id),
    );
  for (const memo of memos) {
    const source = routineCategoryForMemo(nodes, memo)
      ? deadlineGroupForDueAt(occurrenceDueAt(memo), now, granularity)
      : deadlineGroupForMemo(memo, now, granularity);
    const key = visibleDeadlineGroup(source, visible, granularity);
    if (key) grouped.set(key, [...(grouped.get(key) ?? []), memo]);
  }
  return definitions
    .filter((definition) => visible.has(definition.id))
    .map((definition) => ({
      ...definition,
      key: definition.id,
      memos: grouped.get(definition.id) ?? [],
    }));
}
export function updateMemoDeadline(
  nodes: Node[],
  memoId: string,
  targetId: DeadlineGroupKey,
  now = new Date(),
  granularity: TodayGranularity = "amPm",
) {
  const target = deadlineGroupDefinitions(granularity).find(
    (group) => group.id === targetId,
  );
  const memo = nodes.find((node) => node.id === memoId);
  if (
    !target?.create ||
    target.create.editable ||
    !memo ||
    memo.type !== "memo" ||
    !isTask(memo) ||
    memo.deletedAt !== null ||
    memo.status !== "active"
  )
    return nodes;
  return nodes.map((node) =>
    node.id === memoId
      ? {
          ...node,
          duePreset: target.create!.preset,
          dueAt: target.create!.dueAt(now),
          updatedAt: now,
        }
      : node,
  );
}
export function moveMemoInDeadlineList(
  nodes: Node[],
  memoId: string,
  targetId: DeadlineGroupKey,
  beforeId?: string,
  now = new Date(),
  granularity: TodayGranularity = "amPm",
) {
  const target = deadlineGroupDefinitions(granularity).find(
    (group) => group.id === targetId,
  );
  const moving = nodes.find(
    (node): node is MemoNode => node.id === memoId && node.type === "memo",
  );
  if (
    !moving ||
    !isTask(moving) ||
    moving.deletedAt !== null ||
    moving.status !== "active" ||
    !target
  )
    return nodes;
  const same = deadlineGroupForMemo(moving, now, granularity) === targetId;
  if (!same && (!target.create || target.create.editable)) return nodes;
  const ordered = deadlineGroups(nodes, now, undefined, granularity).flatMap(
    (group) => group.memos,
  );
  const keys = generateNKeysBetween(null, null, ordered.length);
  const withKeys = nodes.map((node) => {
    if (node.type !== "memo") return node;
    const index = ordered.findIndex((memo) => memo.id === node.id);
    return index >= 0
      ? { ...node, deadlineSortKey: node.deadlineSortKey ?? keys[index] }
      : node;
  });
  const changed = same
    ? withKeys
    : updateMemoDeadline(withKeys, memoId, targetId, now, granularity);
  const targetMemos =
    deadlineGroups(changed, now, undefined, granularity)
      .find((group) => group.key === targetId)
      ?.memos.filter((memo) => memo.id !== memoId) ?? [];
  const found = beforeId
    ? targetMemos.findIndex((memo) => memo.id === beforeId)
    : targetMemos.length;
  const index = found < 0 ? targetMemos.length : found;
  const deadlineSortKey = generateKeyBetween(
    targetMemos[index - 1]?.deadlineSortKey ?? null,
    targetMemos[index]?.deadlineSortKey ?? null,
  );
  return changed.map((node) =>
    node.id === memoId ? { ...node, deadlineSortKey, updatedAt: now } : node,
  );
}

export function deadlineBeforeIdForDrop(
  groups: readonly DeadlineGroup[],
  groupId: DeadlineGroupKey,
  movingId: string,
  targetId: string,
  placement: "before" | "after",
) {
  const group = groups.find((item) => item.key === groupId);
  if (!group) throw new Error("移動先の期限グループが見つかりません。");
  return beforeIdForInsertion(
    group.memos.map((memo) => memo.id),
    movingId,
    { kind: placement, nodeId: targetId },
  );
}
export function categoryPath(nodes: Node[], parentId: string | null) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const titles: string[] = [];
  const visited = new Set<string>();
  let id = parentId;
  while (id) {
    if (visited.has(id)) {
      titles.unshift("…");
      break;
    }
    visited.add(id);
    const node = byId.get(id);
    if (!node || node.type !== "category") break;
    titles.unshift(node.title);
    id = node.parentId;
  }
  return titles.length ? titles.join(" > ") : "無所属";
}
