import { describe, expect, it, vi } from "vitest";
import { confirmedSave } from "./confirmedSave";

describe("confirmedSave", () => {
  it("永続化が完了するまで成功を返さない", async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => { complete = resolve; });
    const result = confirmedSave(() => pending, vi.fn());
    let settled = false;
    void result.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    complete();
    await expect(result).resolves.toBe(true);
  });

  it("QuotaExceededErrorを成功扱いせず、エラーを通知して再試行できる", async () => {
    const onFailure = vi.fn();
    const quota = new DOMException("quota", "QuotaExceededError");
    await expect(confirmedSave(() => Promise.reject(quota), onFailure)).resolves.toBe(false);
    expect(onFailure).toHaveBeenCalledWith(quota);
    await expect(confirmedSave(() => Promise.resolve(), onFailure)).resolves.toBe(true);
  });
});
