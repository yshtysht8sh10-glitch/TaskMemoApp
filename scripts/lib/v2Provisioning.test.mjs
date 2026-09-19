import { describe, expect, it } from "vitest";
import { generateKeyBetween } from "fractional-indexing";
import { createProvisionedSortKey } from "./v2Provisioning.mjs";

describe("V2 RC provisioning sort key", () => {
  it("generates a valid and extendable fractional-indexing key", () => {
    const key = createProvisionedSortKey();
    expect(key).not.toBe("zzzz");
    expect(() => generateKeyBetween(key, null)).not.toThrow();
  });
});
