import { deadlineDraftForCreateContext, type DeadlineCreateContext } from "../domain/deadlineView";

export function quickTitleSourceLabel(target: { title: string }, fallback = "新規メモ") {
  return target.title || fallback;
}

export function quickAddTitleNextStep(context: DeadlineCreateContext, title: string) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("タイトルは必須です。");
  if (context.dueEditable) return { kind: "await-due", title: trimmed } as const;
  return { kind: "create", title: trimmed, deadline: deadlineDraftForCreateContext(context) } as const;
}
