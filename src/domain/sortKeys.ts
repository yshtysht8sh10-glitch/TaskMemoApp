import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

import type { Node } from "../models/node";

const compareKeys = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function isValidSortKey(key: string) {
  if (typeof key !== "string" || !key) return false;
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

/** Repair only active conflicting ranks; tombstones do not participate in visible ordering. */
export function normalizeNodeSortKeys(nodes: Node[]) {
  const parents = new Set(nodes.filter((node) => node.deletedAt === null && !node.purgedAt).map((node) => node.parentId));
  const replacements = new Map<string, string>();
  for (const parentId of parents) {
    const siblings = nodes.filter((node) => node.parentId === parentId && node.deletedAt === null && !node.purgedAt)
      .sort((a, b) => compareKeys(String(a.sortKey), String(b.sortKey)) || compareKeys(a.id, b.id));
    const valid = new Map<string, Node[]>();
    const invalid: Node[] = [];
    for (const node of siblings) {
      if (!isValidSortKey(node.sortKey)) invalid.push(node);
      else valid.set(node.sortKey, [...(valid.get(node.sortKey) ?? []), node]);
    }
    const sortedKeys = [...valid.keys()].sort(compareKeys);
    let tail = sortedKeys.at(-1) ?? null;
    for (let index = 0; index < sortedKeys.length; index++) {
      const key = sortedKeys[index];
      const duplicates = valid.get(key)!.slice(1);
      if (!duplicates.length) continue;
      const next = sortedKeys[index + 1] ?? null;
      let keys: string[];
      try { keys = generateNKeysBetween(key, next, duplicates.length); }
      catch { keys = generateNKeysBetween(tail, null, duplicates.length); }
      duplicates.forEach((node, duplicateIndex) => replacements.set(node.id, keys[duplicateIndex]));
      if (next === null || (tail !== null && keys[0] > tail)) tail = keys.at(-1)!;
    }
    if (invalid.length) {
      const keys = generateNKeysBetween(tail, null, invalid.length);
      invalid.forEach((node, index) => replacements.set(node.id, keys[index]));
    }
  }
  return replacements.size ? nodes.map((node) => replacements.has(node.id) ? { ...node, sortKey: replacements.get(node.id)! } : node) : nodes;
}

export function initialSortKey() {
  return generateKeyBetween(null, null);
}
