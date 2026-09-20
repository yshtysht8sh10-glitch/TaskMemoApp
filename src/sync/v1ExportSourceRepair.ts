import { createHash } from "node:crypto";

export const APPROVED_IPA_MORNING_DROP = {
  classification: "USER-APPROVED SOURCE REPAIR / DATA DROP" as const,
  sourceSha256: "29667feba0cae76e2da9e0caf9c4d2c0e5fb3a082bdd72bf428bebe6b8ff4146",
  nodeId: "ipa-morning",
  reason: "ユーザーが当該Nodeの完全な破棄を明示的に許可",
  expectedBeforeCount: 125,
  expectedAfterCount: 124,
};

export function createApprovedV1SourceRepair(raw: string, approval: typeof APPROVED_IPA_MORNING_DROP) {
  const sourceSha256 = createHash("sha256").update(raw).digest("hex");
  if (sourceSha256 !== approval.sourceSha256) throw new Error("Original SHA-256 does not match the approved source.");
  const source = JSON.parse(raw) as { schemaVersion?: unknown; nodes?: { id?: unknown }[] };
  if (source.schemaVersion !== 1 || !Array.isArray(source.nodes) || source.nodes.length !== approval.expectedBeforeCount) throw new Error("Original schema/count does not match the approved repair.");
  const matches = source.nodes.filter((node) => node?.id === approval.nodeId);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${approval.nodeId} Node.`);
  const repaired = { ...source, nodes: source.nodes.filter((node) => node?.id !== approval.nodeId) };
  if (repaired.nodes.length !== approval.expectedAfterCount) throw new Error("Repaired Node count mismatch.");
  const repairedRaw = `${JSON.stringify(repaired, null, 2)}\n`;
  return {
    repairedRaw,
    audit: {
      ...approval,
      repairedSha256: createHash("sha256").update(repairedRaw).digest("hex"),
      beforeCount: source.nodes.length,
      afterCount: repaired.nodes.length,
    },
  };
}

export function createApprovedIpaMorningRepair(raw: string) { return createApprovedV1SourceRepair(raw, APPROVED_IPA_MORNING_DROP); }
