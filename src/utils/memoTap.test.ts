import { afterEach, describe, expect, it, vi } from "vitest";
import { createTitleTapHandler, isMobileTitleEditor, quickTitleExit } from "./memoTap";

afterEach(() => vi.useRealTimers());

describe("memo title tap", () => {
  it("holds only title single press for 250ms", () => {
    vi.useFakeTimers();
    const single = vi.fn(); const double = vi.fn();
    const handler = createTitleTapHandler(single, double);
    handler.press();
    expect(single).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(single).toHaveBeenCalledOnce();
    expect(double).not.toHaveBeenCalled();
  });

  it("double press cancels sheet opening", () => {
    vi.useFakeTimers();
    const single = vi.fn(); const double = vi.fn();
    const handler = createTitleTapHandler(single, double);
    handler.press(); vi.advanceTimersByTime(120); handler.press(); vi.runAllTimers();
    expect(single).not.toHaveBeenCalled();
    expect(double).toHaveBeenCalledOnce();
  });

  it("routes phone web and native to Quick Editor, desktop web to inline", () => {
    expect(isMobileTitleEditor("ios", 1000)).toBe(true);
    expect(isMobileTitleEditor("android", 1000)).toBe(true);
    expect(isMobileTitleEditor("web", 390, true)).toBe(true);
    expect(isMobileTitleEditor("web", 1200, false)).toBe(false);
  });

  it("commits ordinary exits, cancels only explicit cancel, and keeps empty titles open", () => {
    expect(quickTitleExit(" new title ", true)).toEqual({ kind: "save", title: "new title" });
    expect(quickTitleExit(" new title ", false)).toEqual({ kind: "cancel" });
    expect(quickTitleExit("   ", true)).toEqual({ kind: "invalid" });
  });
});
