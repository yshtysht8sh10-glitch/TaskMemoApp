import type { Node } from "../models/node";
import type { SyncNodeValue } from "./types";
import { validRoutineLifecycle } from '../domain/routineLifecycleRegister';

const DATE_FIELDS = ["createdAt", "updatedAt", "deletedAt", "purgedAt", "dueAt", "completedAt"] as const;

function asDate(value: unknown) {
  if (value === null || value === undefined || value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") return value.toDate();
  return value;
}

/** Lossless V2 boundary: known Date fields are canonical ISO strings; unknown fields are retained. */
export function nodeToV2Value(node: Node): SyncNodeValue {
  const value: Record<string, unknown> = { ...node };
  for (const field of DATE_FIELDS) {
    const item = value[field];
    if (item instanceof Date) value[field] = item.toISOString();
  }
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key];
  return value as SyncNodeValue;
}

export function nodeFromV2Value(source: SyncNodeValue): Node {
  if (source.routineLifecycle !== undefined && !validRoutineLifecycle(source.routineLifecycle)) throw Error('Routine完了期間が不正です。原本を保持して停止します。');
  const value: Record<string, unknown> = { ...source };
  for (const field of DATE_FIELDS) value[field] = asDate(value[field]);
  if (value.type === "memo" && value.memoType !== "idea" && value.memoType !== "task") value.memoType = "task";
  return value as Node;
}
