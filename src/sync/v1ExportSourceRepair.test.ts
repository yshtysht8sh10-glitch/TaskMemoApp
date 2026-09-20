import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { APPROVED_IPA_MORNING_DROP, createApprovedIpaMorningRepair, createApprovedV1SourceRepair } from "./v1ExportSourceRepair";

const approvedShape = () => JSON.stringify({ schemaVersion: 1, nodes: Array.from({ length: 125 }, (_, index) => ({ id: index === 17 ? "ipa-morning" : `node-${index}` })) });

describe("approved iPhone V1 source repair", () => {
  it("refuses any source whose exact hash is not the approved original", () => expect(() => createApprovedIpaMorningRepair(approvedShape())).toThrow(/SHA-256/));
  it("defines one exact drop and produces no replacement or tombstone", () => {
    expect(APPROVED_IPA_MORNING_DROP).toMatchObject({ nodeId: "ipa-morning", expectedBeforeCount: 125, expectedAfterCount: 124, classification: "USER-APPROVED SOURCE REPAIR / DATA DROP" });
    const raw = approvedShape();
    // Exercise the transformation with an equivalent injected approval hash without weakening the exported production guard.
    const result = createApprovedV1SourceRepair(raw, { ...APPROVED_IPA_MORNING_DROP, sourceSha256: createHash("sha256").update(raw).digest("hex") });
    const repaired = JSON.parse(result.repairedRaw);
    expect(repaired.nodes).toHaveLength(124);
    expect(repaired.nodes.some((node: { id: string }) => node.id === "ipa-morning")).toBe(false);
    expect(result.repairedRaw).not.toContain("tombstone");
  });
});
