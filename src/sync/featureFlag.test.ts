import { expect, it } from "vitest";
import { isConfiguredV2SyncEnabled, isV2SyncEnabled } from "./featureFlag";

it("requires both development and an explicit flag; production always fails closed", () => {
  expect(isV2SyncEnabled("development", "true")).toBe(true);
  for (const environment of ["production", "test", ""]) {
    expect(isV2SyncEnabled(environment, "true")).toBe(false);
  }
  for (const flag of [undefined, "false", "1", "TRUE"]) {
    expect(isV2SyncEnabled("development", flag)).toBe(false);
  }
});

it("keeps the application in local-only mode when Firebase configuration is unavailable", () => {
  expect(isConfiguredV2SyncEnabled("development", "true", false)).toBe(false);
  expect(isConfiguredV2SyncEnabled("development", "true", true)).toBe(true);
});
