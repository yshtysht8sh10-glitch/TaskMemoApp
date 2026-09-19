import { expect, it } from "vitest";
import { isConfiguredV2SyncEnabled, isV2SyncEnabled } from "./featureFlag";

it("keeps current production on V1 without the explicit V2 build flag", () => {
  expect(isV2SyncEnabled("development", "true")).toBe(true);
  expect(isV2SyncEnabled("production", undefined)).toBe(false);
  expect(isV2SyncEnabled("production", "false")).toBe(false);
});

it("allows an explicitly V2-capable production build but rejects test/unknown environments", () => {
  expect(isV2SyncEnabled("production", "true")).toBe(true);
  for (const environment of ["test", ""]) expect(isV2SyncEnabled(environment, "true")).toBe(false);
  for (const flag of [undefined, "false", "1", "TRUE"]) {
    expect(isV2SyncEnabled("development", flag)).toBe(false);
  }
});

it("keeps the application in local-only mode when Firebase configuration is unavailable", () => {
  expect(isConfiguredV2SyncEnabled("development", "true", false)).toBe(false);
  expect(isConfiguredV2SyncEnabled("development", "true", true)).toBe(true);
  expect(isConfiguredV2SyncEnabled("production", "true", false)).toBe(false);
  expect(isConfiguredV2SyncEnabled("production", "true", true)).toBe(true);
});
