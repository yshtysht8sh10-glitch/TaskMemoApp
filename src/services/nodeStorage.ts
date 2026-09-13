import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

import type { Node } from '@/models/node';

const STORAGE_KEY = '@taskmemo/nodes/v1';
const DATE_FIELDS = ['createdAt', 'updatedAt', 'deletedAt', 'dueAt', 'completedAt'] as const;

export function normalizeLegacyRanks(nodes: Node[]) {
  const parents = new Set(nodes.map((node) => node.parentId));
  let result = nodes;
  for (const parentId of parents) {
    const siblings = result.filter((node) => node.parentId === parentId).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const valid = siblings.every((node, index) => {
      if (index > 0 && node.sortKey === siblings[index - 1].sortKey) return false;
      try { generateKeyBetween(node.sortKey, null); return true; } catch { return false; }
    });
    if (!valid) {
      const keys = generateNKeysBetween(null, null, siblings.length);
      const replacements = new Map(siblings.map((node, index) => [node.id, keys[index]]));
      result = result.map((node) => replacements.has(node.id) ? { ...node, sortKey: replacements.get(node.id)! } : node);
    }
  }
  return result;
}

export async function loadNodes(fallback: Node[]) {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return normalizeLegacyRanks(fallback);
  const parsed = JSON.parse(raw) as Record<string, unknown>[];
  return normalizeLegacyRanks(parsed.map((item) => {
    const node = { ...item } as Record<string, unknown>;
    for (const field of DATE_FIELDS) if (typeof node[field] === 'string') node[field] = new Date(node[field] as string);
    return node as Node;
  }));
}

export async function saveNodes(nodes: Node[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
}

export async function resetNodes() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
