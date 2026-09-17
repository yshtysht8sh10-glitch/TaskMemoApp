import type { MemoNode, Node } from "@/models/node";
import {
  localDateKey,
  parseLocalDateKey,
  routineCategoryForMemo,
} from "./routine";
import { isIdea } from "./memoType";

export type CompletionHistoryCriterion = "completedAt" | "createdAt";
export const COMPLETION_HISTORY_CRITERIA: readonly {
  id: CompletionHistoryCriterion;
  label: string;
}[] = [
  { id: "completedAt", label: "完了日" },
  { id: "createdAt", label: "作成日" },
];
export type CompletionHistoryItem = {
  key: string;
  kind: "memo" | "routineOccurrence";
  memo: MemoNode;
  occurrenceDate?: Date;
  completedAt: Date;
};
export type CompletionHistoryGroup = {
  key: string;
  label: string;
  items: CompletionHistoryItem[];
};

const localDateLabel = (date: Date) =>
  `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

export function completionHistoryGroups(
  nodes: Node[],
  criterion: CompletionHistoryCriterion,
): CompletionHistoryGroup[] {
  const items: CompletionHistoryItem[] = [];
  for (const node of nodes) {
    if (
      node.type !== "memo" ||
      isIdea(node) ||
      node.deletedAt !== null ||
      node.purgedAt
    )
      continue;
    if (node.status === "completed")
      items.push({
        key: `memo:${node.id}`,
        kind: "memo",
        memo: node,
        completedAt: node.completedAt ?? node.updatedAt,
      });
    if (routineCategoryForMemo(nodes, node))
      for (const [dateKey, timestamp] of Object.entries(
        node.routineHistory ?? {},
      )) {
        const occurrenceDate = parseLocalDateKey(dateKey);
        const completedAt = timestamp ? new Date(timestamp) : null;
        if (
          occurrenceDate &&
          completedAt &&
          !Number.isNaN(completedAt.getTime())
        )
          items.push({
            key: `routine:${node.id}:${dateKey}`,
            kind: "routineOccurrence",
            memo: node,
            occurrenceDate,
            completedAt,
          });
      }
  }
  const dateFor = (item: CompletionHistoryItem) =>
    criterion === "completedAt"
      ? item.completedAt
      : item.kind === "memo"
        ? item.memo.createdAt
        : item.occurrenceDate!;
  items.sort(
    (a, b) =>
      dateFor(b).getTime() - dateFor(a).getTime() || a.key.localeCompare(b.key),
  );
  const groups = new Map<string, CompletionHistoryGroup>();
  for (const item of items) {
    const date = dateFor(item);
    const key = localDateKey(date);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, label: localDateLabel(date), items: [item] });
  }
  return [...groups.values()];
}
