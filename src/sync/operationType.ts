import type { SyncOperationType } from "./types";

export function inferSyncOperationType(label: string): SyncOperationType {
  if (label.includes("読み込") || label.includes("初期化")) return "import";
  if (label.includes("完全削除")) return "purge";
  if (label.includes("復元")) return "restore";
  if (label.includes("未完了") || label.includes("完了を元") || label.includes("完了取消")) return "uncomplete";
  if (label.includes("完了")) return "complete";
  if (label.includes("削除")) return "softDelete";
  if (label.includes("作成") || label.includes("追加") || label.includes("複製")) return "create";
  return "update";
}
