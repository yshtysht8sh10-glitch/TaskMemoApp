import { describe, expect, it } from "vitest";

import { titleClickAction } from "./inlineTitleEdit";

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
});
