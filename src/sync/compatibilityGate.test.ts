import { describe, expect, it } from "vitest";
import { validateCompatibilityGate } from "./compatibilityGate";
import { isConfiguredV2SyncEnabled } from "./featureFlag";

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
  it("keeps an explicitly V2 production client on the V2 path when the server gate rejects it", () => {
    expect(isConfiguredV2SyncEnabled("production", "true", true)).toBe(true);
    expect(() => validateCompatibilityGate({ ...valid, v2Enabled: false })).toThrow();
    // Protocol selection remains V2; callers must surface the gate error and never invoke V1.
    expect(isConfiguredV2SyncEnabled("production", "true", true)).toBe(true);
  });
});
