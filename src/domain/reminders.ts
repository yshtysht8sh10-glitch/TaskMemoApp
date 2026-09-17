import type { MemoNode, Node } from "../models/node";
import { routineCategoryForMemo } from "./routine";
import { isIdea } from "./memoType";

export type ReminderPreferences = {
  enabled: boolean;
  sameDay: boolean;
  dayBefore: boolean;
};
export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  enabled: false,
  sameDay: true,
  dayBefore: true,
};
export type ReminderPlan = {
  key: string;
  memoId: string;
  title: string;
  body: string;
  triggerAt: Date;
};

const morningOn = (date: Date, dayOffset: number) =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + dayOffset,
    9,
    0,
    0,
    0,
  );
const sameDayTrigger = (memo: MemoNode) =>
  memo.duePreset === "custom"
    ? new Date(memo.dueAt!)
    : morningOn(memo.dueAt!, 0);

export function reminderPlans(
  nodes: Node[],
  preferences: ReminderPreferences,
  now = new Date(),
): ReminderPlan[] {
  if (!preferences.enabled) return [];
  return nodes
    .flatMap((node): ReminderPlan[] => {
      if (
        node.type !== "memo" ||
        isIdea(node) ||
        node.deletedAt ||
        node.purgedAt ||
        node.status !== "active" ||
        !node.dueAt ||
        node.repeatRule ||
        routineCategoryForMemo(nodes, node)
      )
        return [];
      const candidates = [
        preferences.dayBefore
          ? {
              key: "day-before",
              at: morningOn(node.dueAt, -1),
              body: `「${node.title}」の期限は明日です`,
            }
          : null,
        preferences.sameDay
          ? {
              key: "same-day",
              at: sameDayTrigger(node),
              body: `「${node.title}」の期限が近づいています`,
            }
          : null,
      ].filter(
        (item): item is NonNullable<typeof item> =>
          !!item && item.at.getTime() > now.getTime(),
      );
      return candidates.map((item) => ({
        key: `${node.id}:${item.key}`,
        memoId: node.id,
        title: "TaskMemo",
        body: item.body,
        triggerAt: item.at,
      }));
    })
    .sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime())
    .slice(0, 60);
}
