import { describe, expect, it } from "vitest";

import { countBadgeText, shouldAnimateCountChange } from "./countBadge";

describe("shouldAnimateCountChange", () => {
  it("1件以上は数字だけを表示し、0件は表示しない", () => {
    expect(countBadgeText(13)).toBe("13");
    expect(countBadgeText(0)).toBeNull();
  });
  it("初回表示ではアニメーションしない", () => {
    expect(shouldAnimateCountChange(null, 13)).toBe(false);
  });

  it("件数が変わった場合だけアニメーションする", () => {
    expect(shouldAnimateCountChange(13, 14)).toBe(true);
    expect(shouldAnimateCountChange(13, 12)).toBe(true);
    expect(shouldAnimateCountChange(13, 13)).toBe(false);
  });

  it("0から1への出現はアニメーションし、0件への変更は対象外にする", () => {
    expect(shouldAnimateCountChange(0, 1)).toBe(true);
    expect(shouldAnimateCountChange(1, 0)).toBe(false);
  });

  it("reduced motionでは件数が変化してもアニメーションしない", () => {
    expect(shouldAnimateCountChange(2, 3, true)).toBe(false);
  });
});
