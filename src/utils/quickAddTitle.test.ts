import { describe, expect, it } from "vitest";
import type { DeadlineCreateContext } from "../domain/deadlineView";
import { quickAddTitleNextStep, quickTitleSourceLabel } from "./quickAddTitle";

const fixed: DeadlineCreateContext = {
  label: "今日", initialDuePreset: "today", initialDueAt: new Date(2026, 8, 25, 23, 59),
  dueEditable: false, targetGroup: "today", granularity: "amPm",
};
const editable: DeadlineCreateContext = {
  label: "日時指定", initialDuePreset: "custom", initialDueAt: new Date(2026, 8, 25, 19),
  dueEditable: true, targetGroup: "pm", granularity: "amPm",
};

describe("mobile deadline quick creation", () => {
  it("keeps the original edit target visible independently of the typed draft", () => {
    const target = { id: "memo-1", title: "ドゥームズデイの予習" };
    const draft = "新しいタイトル";
    expect(quickTitleSourceLabel(target, draft)).toBe("ドゥームズデイの予習");
  });

  it("can create fixed-deadline memo only after title confirmation", () => {
    expect(quickAddTitleNextStep(fixed, " new memo ")).toEqual({
      kind: "create", title: "new memo", deadline: { duePreset: "today", dueAt: fixed.initialDueAt },
    });
  });

  it("retains editable deadline as a second stage without creating a Node", () => {
    expect(quickAddTitleNextStep(editable, "new memo")).toEqual({ kind: "await-due", title: "new memo" });
  });
});
