import { describe, expect, it, vi } from "vitest";
import { subscribeToWebOnline } from "./webOnlineListener";

describe("Web online listener boundary", () => {
  it("registers and symmetrically removes the online listener on Web", () => {
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const listener = vi.fn();
    const cleanup = subscribeToWebOnline("web", target, listener);
    expect(target.addEventListener).toHaveBeenCalledWith("online", listener);
    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledWith("online", listener);
  });

  it("does not require DOM event APIs on React Native", () => {
    const partialWindow = Object.defineProperties({}, {
      addEventListener: { get: () => { throw new Error("Native must not inspect addEventListener"); } },
      removeEventListener: { get: () => { throw new Error("Native must not inspect removeEventListener"); } },
    });
    const cleanup = subscribeToWebOnline("android", partialWindow, vi.fn());
    expect(cleanup).not.toThrow();
  });

  it("fails safe when a Web-like global does not provide the complete listener pair", () => {
    const addEventListener = vi.fn();
    const cleanup = subscribeToWebOnline("web", { addEventListener }, vi.fn());
    expect(addEventListener).not.toHaveBeenCalled();
    expect(cleanup).not.toThrow();
  });
});
