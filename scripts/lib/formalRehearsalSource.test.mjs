import { describe, expect, it } from "vitest";

import { assessFormalSourceInventory } from "./formalRehearsalSource.mjs";

describe("formal rehearsal source inventory", () => {
  it("does not treat an absent device-local profile inventory as zero candidates", () => {
    expect(assessFormalSourceInventory({ nodes: [] })).toMatchObject({
      profileStatus: "NOT_CAPTURED",
      candidateStatus: "UNKNOWN",
      canRunFormalRehearsal: false,
    });
  });

  it("requires user action when an unresolved candidate exists", () => {
    expect(assessFormalSourceInventory({
      nodes: [],
      localProfileInventory: { complete: true },
      legacyPinnedNoteCandidates: [{ body: "recover me", updatedAt: "2026-09-20T00:00:00.000Z" }],
    })).toMatchObject({ candidateCount: 1, candidateStatus: "USER_ACTION_REQUIRED", canRunFormalRehearsal: false });
  });

  it("allows formal validation only with an explicit complete empty inventory", () => {
    expect(assessFormalSourceInventory({
      nodes: [],
      localProfileInventory: { complete: true },
      legacyPinnedNoteCandidates: [],
    })).toMatchObject({ profileStatus: "CAPTURED", candidateCount: 0, candidateStatus: "CLEAR", canRunFormalRehearsal: true });
  });

  it("allows missing local profile data only with the explicit production non-migration policy", () => {
    expect(assessFormalSourceInventory({ nodes: [] }, { userApprovedNonMigration: true })).toMatchObject({
      profileStatus: "EXPECTED_NON_MIGRATED",
      candidateStatus: "USER_APPROVED_DATA_LOSS",
      canRunFormalRehearsal: true,
      issues: [],
    });
  });
});
