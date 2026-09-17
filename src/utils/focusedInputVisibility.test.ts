import { describe, expect, it } from "vitest";

import {
  focusedInputScrollDirection,
  focusedInputScrollOffset,
  normalizeVisibleViewport,
  focusedInputScrollPlan,
  focusedInputRevealPlan,
  shouldRevealFocusedInput,
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

  it.each([0, 1, 80, Number.NaN])(
    "Visual Viewportの異常なheight %sをmodal配置やscroll補正へ使わない",
    (height) => {
      expect(
        normalizeVisibleViewport(
          { height, offsetTop: 900 },
          { height: 800, offsetTop: 0 },
        ),
      ).toEqual({ height: 800, offsetTop: 0 });
    },
  );

  it("keyboard未表示ならfocusだけでviewport補正を開始しない", () => {
    expect(
      shouldRevealFocusedInput(
        { height: 800, offsetTop: 0 },
        { height: 800, offsetTop: 0 },
      ),
    ).toBe(false);
  });

  it("一時的に異常なoffsetTopが来ても可視領域を画面外へずらさない", () => {
    expect(
      normalizeVisibleViewport(
        { height: 480, offsetTop: 900 },
        { height: 800, offsetTop: 0 },
      ),
    ).toEqual({ height: 480, offsetTop: 0 });
  });

  it("keyboardで可視領域が十分に縮んだ場合だけ内部scroll補正を許可する", () => {
    expect(
      shouldRevealFocusedInput(
        { height: 480, offsetTop: 0 },
        { height: 800, offsetTop: 0 },
      ),
    ).toBe(true);
  });

  it("末尾付近の入力欄は不足するscroll領域をkeyboard insetで補う", () => {
    expect(
      focusedInputScrollPlan(
        { scrollTop: 500, scrollHeight: 1000, clientHeight: 500 },
        260,
      ),
    ).toEqual({ extraBottomSpace: 260, targetScrollTop: 760 });
  });

  it("Safariのfocus scrollを戻した後も一覧内inputをkeyboard上へ出す", () => {
    const plan = focusedInputRevealPlan({
      baselineWindowScrollY: 0,
      currentWindowScrollY: 180,
      inputBounds: { top: 620, bottom: 670 },
      viewport: { height: 420, offsetTop: 0 },
      container: { scrollTop: 400, scrollHeight: 1000, clientHeight: 580 },
    });

    expect(plan.windowScrollTop).toBe(0);
    expect(plan.inputBoundsAfterWindowRestore).toEqual({ top: 800, bottom: 850 });
    expect(plan.containerScrollOffset).toBe(446);
    expect(plan.scroll).toEqual({ extraBottomSpace: 426, targetScrollTop: 846 });
    expect(plan.inputBoundsAfterReveal.bottom).toBeLessThan(420);
  });
});
