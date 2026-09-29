import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("常設メモの入力欄", () => {
  it("iPhone でフォーカス時に拡大されない文字サイズを使う", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./DeadlineView.tsx", import.meta.url)),
      "utf8",
    );
    const pinnedInput = source.match(/pinnedInput:\s*\{([^}]+)\}/)?.[1];

    expect(pinnedInput).toBeDefined();
    expect(Number(pinnedInput?.match(/fontSize:\s*(\d+)/)?.[1])).toBeGreaterThanOrEqual(16);
    expect(source.match(/styles\.pinnedInput/g)).toHaveLength(2);
  });
});
