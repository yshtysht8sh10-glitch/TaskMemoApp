import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

import type { CategoryNode, DuePreset, MemoNode, Node } from '@/models/node';

export type NodeDraft = {
  title: string;
  parentId: string | null;
  body?: string;
  dueAt?: Date | null;
  duePreset?: DuePreset;
  status?: 'active' | 'completed';
};

export const compareSortKeys = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const compareNodes = (a: Node, b: Node) =>
  compareSortKeys(a.sortKey, b.sortKey) || a.id.localeCompare(b.id);

export function siblingsOf(nodes: Node[], parentId: string | null, excludedId?: string) {
  return nodes
    .filter((node) => node.parentId === parentId && node.deletedAt === null && node.id !== excludedId)
    .sort(compareNodes);
}

export function nextSortKey(nodes: Node[], parentId: string | null) {
  const siblings = siblingsOf(nodes, parentId);
  return generateKeyBetween(siblings.at(-1)?.sortKey ?? null, null);
}

function assertParent(nodes: Node[], parentId: string | null) {
  if (parentId === null) return;
  const parent = nodes.find((node) => node.id === parentId && node.deletedAt === null);
  if (!parent || parent.type !== 'category') throw new Error('移動先のCategoryが見つかりません。');
}

export function canMoveNode(nodes: Node[], nodeId: string, destinationParentId: string | null) {
  const moving = nodes.find((node) => node.id === nodeId && node.deletedAt === null);
  if (!moving) return false;
  if (destinationParentId === null) return true;
  if (destinationParentId === nodeId) return false;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const destination = byId.get(destinationParentId);
  if (!destination || destination.type !== 'category' || destination.deletedAt !== null) return false;

  let current: Node | undefined = destination;
  const visited = new Set<string>();
  while (current) {
    if (current.id === nodeId || visited.has(current.id)) return false;
    visited.add(current.id);
    if (current.parentId === null) return true;
    current = byId.get(current.parentId);
    if (!current) return false;
  }
  return false;
}

export function isDescendant(nodes: Node[], ancestorId: string, possibleDescendantId: string) {
  return !canMoveNode(nodes, ancestorId, possibleDescendantId);
}

export function createNode(
  nodes: Node[],
  type: 'category' | 'memo',
  draft: NodeDraft,
  now = new Date(),
  id = `${type}-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
) {
  const title = draft.title.trim();
  if (!title) throw new Error('タイトルは必須です。');
  assertParent(nodes, draft.parentId);
  const base = {
    id, type, title, parentId: draft.parentId, sortKey: nextSortKey(nodes, draft.parentId),
    createdAt: now, updatedAt: now, deletedAt: null, deletionBatchId: null,
  } as const;
  const node: Node = type === 'category'
    ? ({ ...base, type: 'category' } satisfies CategoryNode)
    : ({ ...base, type: 'memo', body: draft.body ?? '', dueAt: draft.dueAt ?? null,
        duePreset: draft.duePreset ?? 'none', status: 'active',
        completedAt: null } satisfies MemoNode);
  return [...nodes, node];
}

export function duplicateMemo(nodes: Node[], sourceId: string, now = new Date(), id = `memo-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`) {
  const source = nodes.find((node): node is MemoNode => node.id === sourceId && node.type === 'memo' && node.deletedAt === null);
  if (!source) throw new Error('複製するMemoが見つかりません。');
  const siblings = siblingsOf(nodes, source.parentId);
  const sourceIndex = siblings.findIndex((node) => node.id === source.id);
  const next = siblings[sourceIndex + 1];
  const sortKey = generateKeyBetween(source.sortKey, next?.sortKey ?? null);
  const duplicate: MemoNode = { ...source, id, sortKey, dueAt: source.dueAt ? new Date(source.dueAt) : null, createdAt: now, updatedAt: now, deletedAt: null, deletionBatchId: null, status: 'active', completedAt: null };
  return [...nodes, duplicate];
}

export function updateNode(nodes: Node[], id: string, draft: Partial<NodeDraft>, now = new Date()) {
  if (draft.title !== undefined && !draft.title.trim()) throw new Error('タイトルは必須です。');
  return nodes.map((node) => {
    if (node.id !== id) return node;
    if (draft.parentId !== undefined && draft.parentId !== node.parentId) {
      return moveNode(nodes, id, draft.parentId, undefined, now).find((item) => item.id === id)!;
    }
    if (node.type === 'category') return { ...node, title: draft.title?.trim() ?? node.title, updatedAt: now };
    const status = draft.status ?? node.status;
    return {
      ...node,
      title: draft.title?.trim() ?? node.title,
      body: draft.body ?? node.body,
      dueAt: draft.dueAt === undefined ? node.dueAt : draft.dueAt,
      duePreset: draft.duePreset ?? node.duePreset,
      status,
      completedAt: status === 'completed' ? (node.completedAt ?? now) : null,
      updatedAt: now,
    };
  });
}

export function moveNode(
  nodes: Node[], id: string, parentId: string | null, beforeId?: string, now = new Date(),
) {
  const moving = nodes.find((node) => node.id === id);
  if (!moving) throw new Error('移動するNodeが見つかりません。');
  if (!canMoveNode(nodes, id, parentId)) throw new Error('この場所には移動できません。');
  const siblings = siblingsOf(nodes, parentId, id);
  const index = beforeId === undefined ? siblings.length : siblings.findIndex((node) => node.id === beforeId);
  if (beforeId !== undefined && index < 0) throw new Error('挿入位置が見つかりません。');
  if (moving.parentId === parentId) {
    const currentSiblings = siblingsOf(nodes, parentId);
    const currentIndex = currentSiblings.findIndex((node) => node.id === id);
    const nextId = currentSiblings[currentIndex + 1]?.id;
    if ((beforeId === undefined && currentIndex === currentSiblings.length - 1) || beforeId === nextId) return nodes;
  }
  const insertion = index;
  const sortKey = generateKeyBetween(
    insertion > 0 ? siblings[insertion - 1].sortKey : null,
    insertion < siblings.length ? siblings[insertion].sortKey : null,
  );
  return nodes.map((node) => node.id === id ? { ...node, parentId, sortKey, updatedAt: now } : node);
}

export function tryMoveNode(
  nodes: Node[], id: string, parentId: string | null, beforeId?: string, now = new Date(),
) {
  if (!canMoveNode(nodes, id, parentId)) return nodes;
  try { return moveNode(nodes, id, parentId, beforeId, now); } catch { return nodes; }
}

export const reorderNode = moveNode;

export function completeMemo(nodes: Node[], id: string, now = new Date()) {
  return nodes.map((node) => node.id === id && node.type === 'memo'
    ? { ...node, status: 'completed' as const, completedAt: now, updatedAt: now } : node);
}

export function restoreMemo(nodes: Node[], id: string, now = new Date()) {
  return nodes.map((node) => node.id === id && node.type === 'memo'
    ? { ...node, status: 'active' as const, completedAt: null, updatedAt: now } : node);
}

function descendantIds(nodes: Node[], rootId: string) {
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (node.parentId && result.has(node.parentId) && !result.has(node.id)) {
      result.add(node.id); changed = true;
    }
  }
  return result;
}

export function softDeleteNode(nodes: Node[], id: string, cascade = false, now = new Date()) {
  const target = nodes.find((node) => node.id === id);
  if (!target) return nodes;
  if (target.type === 'category' && !cascade) return deleteCategoryOnly(nodes, id, now);
  const ids = cascade && target.type === 'category' ? descendantIds(nodes, id) : new Set([id]);
  const batch = cascade ? `delete-${id}-${now.getTime()}` : null;
  return nodes.map((node) => ids.has(node.id)
    ? { ...node, deletedAt: now, deletionBatchId: batch, updatedAt: now } : node);
}

export function deleteCategoryOnly(nodes: Node[], id: string, now = new Date()) {
  const category = nodes.find((node) => node.id === id && node.type === 'category');
  if (!category) return nodes;
  const children = siblingsOf(nodes, id);
  const outer = siblingsOf(nodes, category.parentId, id);
  const position = outer.findIndex((node) => compareSortKeys(node.sortKey, category.sortKey) > 0);
  const after = position < 0 ? outer.length : position;
  const keys = generateNKeysBetween(
    after > 0 ? outer[after - 1].sortKey : null,
    after < outer.length ? outer[after].sortKey : null,
    children.length,
  );
  const childKeys = new Map(children.map((node, index) => [node.id, keys[index]]));
  return nodes.map((node) => {
    if (node.id === id) return { ...node, deletedAt: now, updatedAt: now };
    const key = childKeys.get(node.id);
    return key ? { ...node, parentId: category.parentId, sortKey: key, updatedAt: now } : node;
  });
}

export function restoreNode(nodes: Node[], id: string, now = new Date()) {
  const target = nodes.find((node) => node.id === id);
  if (!target || target.purgedAt) return nodes;
  const restoreIds = target.deletionBatchId
    ? new Set(nodes.filter((node) => node.deletionBatchId === target.deletionBatchId).map((node) => node.id))
    : new Set([id]);
  return nodes.map((node) => {
    if (!restoreIds.has(node.id)) return node;
    const parent = node.parentId ? nodes.find((item) => item.id === node.parentId) : undefined;
    const parentWillRestore = parent ? restoreIds.has(parent.id) : false;
    const validParent = !node.parentId || (parent?.type === 'category' && (parent.deletedAt === null || parentWillRestore));
    return { ...node, parentId: validParent ? node.parentId : null, deletedAt: null,
      deletionBatchId: null, updatedAt: now };
  });
}

export function hardDeleteNode(nodes: Node[], id: string, now = new Date()) {
  const target = nodes.find((node) => node.id === id);
  if (!target) return nodes;
  const ids = target.type === 'category' ? descendantIds(nodes, id) : new Set([id]);
  const purgedAt = now;
  return nodes.map((node) => ids.has(node.id)
    ? { ...node, deletedAt: node.deletedAt ?? purgedAt, purgedAt, deletionBatchId: null, updatedAt: purgedAt }
    : node);
}

export function visibleNodes(nodes: Node[]) {
  return nodes.filter((node) => node.deletedAt === null);
}

export function completedMemos(nodes: Node[]) {
  return nodes.filter((node): node is MemoNode => node.type === 'memo' && node.deletedAt === null && node.status === 'completed')
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
}
