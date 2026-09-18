export const TASKMEMO_SYNC_PROTOCOL = 2;

export type CompatibilityGate = {
  schemaVersion: 1;
  minimumSyncProtocol: number;
  v1WritesAllowed: boolean;
  v2Enabled: boolean;
};

export function validateCompatibilityGate(value: unknown): CompatibilityGate {
  if (!value || typeof value !== "object") throw new Error("同期compatibility gateがありません。安全のため同期を停止しました。");
  const gate = value as Partial<CompatibilityGate>;
  if (gate.schemaVersion !== 1 || !Number.isInteger(gate.minimumSyncProtocol) || typeof gate.v1WritesAllowed !== "boolean" || typeof gate.v2Enabled !== "boolean")
    throw new Error("同期compatibility gateの形式が不正です。安全のため同期を停止しました。");
  if (!gate.v2Enabled) throw new Error("V2同期は管理者により停止されています。");
  if (gate.v1WritesAllowed || gate.minimumSyncProtocol! < 2) throw new Error("V1/V2の同時書き込みを防ぐため同期を停止しました。");
  if (gate.minimumSyncProtocol! > TASKMEMO_SYNC_PROTOCOL) throw new Error("このアプリは古いため同期できません。最新版へ更新してください。");
  return gate as CompatibilityGate;
}
