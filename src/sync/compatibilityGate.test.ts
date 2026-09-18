import { describe, expect, it } from "vitest";
import { validateCompatibilityGate } from "./compatibilityGate";

describe("sync compatibility gate", () => {
  const valid = { schemaVersion: 1 as const, minimumSyncProtocol: 2, v1WritesAllowed: false, v2Enabled: true };
  it("accepts the current V2 client", () => expect(validateCompatibilityGate(valid)).toEqual(valid));
  it("rejects dual-write and invalid protocol configurations", () => {
    expect(() => validateCompatibilityGate({ ...valid, v1WritesAllowed: true })).toThrow();
    expect(() => validateCompatibilityGate({ ...valid, minimumSyncProtocol: -1 })).toThrow();
  });
  it("fails closed when missing, malformed, disabled, or newer than the client", () => {
    expect(() => validateCompatibilityGate(undefined)).toThrow("ありません");
    expect(() => validateCompatibilityGate({ ...valid, minimumSyncProtocol: 3 })).toThrow("最新版");
    expect(() => validateCompatibilityGate({ ...valid, v2Enabled: false })).toThrow("停止");
  });
});
