import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

import type { Node } from "../models/node";

export function isValidSortKey(key: string) {
  if (!key) return false;
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

/** Canonicalizes complete sibling groups so invalid and duplicate legacy ranks cannot enter authoritative state. */
export function normalizeNodeSortKeys(nodes: Node[]) {
  const parents = new Set(nodes.map((node) => node.parentId));
  let result = nodes;
  for (const parentId of parents) {
    const siblings = result
      .filter((node) => node.parentId === parentId)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id));
    const valid = siblings.every((node, index) =>
      isValidSortKey(node.sortKey) && (index === 0 || node.sortKey !== siblings[index - 1].sortKey),
    );
    if (valid) continue;
    const keys = generateNKeysBetween(null, null, siblings.length);
    const replacements = new Map(siblings.map((node, index) => [node.id, keys[index]]));
    result = result.map((node) => replacements.has(node.id) ? { ...node, sortKey: replacements.get(node.id)! } : node);
  }
  return result;
}

export function initialSortKey() {
  return generateKeyBetween(null, null);
}
