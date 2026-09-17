import { describe, expect, it } from "vitest";

import { isTitleEditorFor, titleClickAction } from "./inlineTitleEdit";

describe("titleClickAction", () => {
  it("通常状態のクリックは編集を開始する", () => {
    expect(titleClickAction(null, "a")).toBe("begin");
  });

  it("編集中の別Memoクリックは現在の編集終了だけを行う", () => {
    expect(titleClickAction("a", "b")).toBe("finish-current");
  });

  it("編集中の同じMemoクリックでは編集状態を維持する", () => {
    expect(titleClickAction("a", "a")).toBe("keep-current");
  });

  it("クリックしたMemoだけにeditorとautoFocus対象を割り当てる", () => {
    expect(isTitleEditorFor("a", "a")).toBe(true);
    expect(isTitleEditorFor("a", "b")).toBe(false);
    expect(isTitleEditorFor("a", "last")).toBe(false);
    expect(isTitleEditorFor(null, "a")).toBe(false);
  });
});
