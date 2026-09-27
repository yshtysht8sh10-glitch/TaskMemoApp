import { expect, it } from "vitest";
import { shouldEnterLocalRecovery } from "./localRecoveryRouting";

it("honors a first local recovery request but ignores its stale URL after sync self repair", () => {
  expect(shouldEnterLocalRecovery(false, true, false)).toBe(true);
  expect(shouldEnterLocalRecovery(true, true, false)).toBe(true);
  expect(shouldEnterLocalRecovery(true, true, true)).toBe(true);
  expect(shouldEnterLocalRecovery(false, true, true)).toBe(false);
  expect(shouldEnterLocalRecovery(false, false, true)).toBe(false);
});
