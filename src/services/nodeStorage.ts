import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Node } from "../models/node";
import { ensureRoutineCategories } from "../domain/nodeOperations";
import { normalizeNodeSortKeys } from "../domain/sortKeys";

const STORAGE_KEY = "@taskmemo/nodes/v1";
const DATE_FIELDS = [
  "createdAt",
  "updatedAt",
  "deletedAt",
  "purgedAt",
  "dueAt",
  "completedAt",
] as const;

export function normalizeLegacyRanks(nodes: Node[]) {
  return ensureRoutineCategories(normalizeNodeSortKeys(nodes));
}

export async function loadNodes(fallback: Node[]) {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return normalizeLegacyRanks(fallback);
  const parsed = JSON.parse(raw) as Record<string, unknown>[];
  return normalizeLegacyRanks(
    parsed.map((item) => {
      const node = { ...item } as Record<string, unknown>;
      for (const field of DATE_FIELDS)
        if (typeof node[field] === "string")
          node[field] = new Date(node[field] as string);
      if (
        node.type === "memo" &&
        node.memoType !== "idea" &&
        node.memoType !== "task"
      )
        node.memoType = "task";
      return node as Node;
    }),
  );
}

export async function saveNodes(nodes: Node[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
}

export async function resetNodes() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
