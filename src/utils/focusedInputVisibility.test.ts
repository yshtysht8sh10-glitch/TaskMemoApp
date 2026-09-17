import { describe, expect, it } from "vitest";

import {
  focusedInputScrollDirection,
  focusedInputScrollOffset,
} from "./focusedInputVisibility";

describe("focusedInputScrollDirection", () => {
  const viewport = { height: 400, offsetTop: 100 };

  it("キーボード上の可視領域内ならスクロールしない", () => {
    expect(
      focusedInputScrollDirection({ top: 140, bottom: 200 }, viewport),
    ).toBeNull();
  });

  it("入力欄が可視領域の下なら下方向へ補正する", () => {
    expect(
      focusedInputScrollDirection({ top: 470, bottom: 510 }, viewport),
    ).toBe("down");
    expect(
      focusedInputScrollOffset({ top: 470, bottom: 510 }, viewport),
    ).toBe(26);
  });

  it("Visual Viewportの上端より上なら上方向へ補正する", () => {
    expect(
      focusedInputScrollDirection({ top: 90, bottom: 130 }, viewport),
    ).toBe("up");
  });

  it("可視領域より大きい入力欄が画面と重なる場合は移動を繰り返さない", () => {
    expect(
      focusedInputScrollDirection({ top: 50, bottom: 600 }, viewport),
    ).toBeNull();
  });
});
