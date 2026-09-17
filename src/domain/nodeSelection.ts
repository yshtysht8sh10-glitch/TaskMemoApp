import type { MemoNode, Node } from "../models/node";
import {
  canContainMemo,
  canMoveNode,
  compareNodes,
  completeMemo,
  moveNode,
  softDeleteNode,
} from "./nodeOperations";
import { isRoutineCompletedOn, routineCategoryForMemo } from "./routine";
import { isTask } from "./memoType";

const active = (node: Node) => node.deletedAt === null && !node.purgedAt;

function selectedAncestorId(
  nodesById: ReadonlyMap<string, Node>,
  selectedIds: ReadonlySet<string>,
  node: Node,
) {
  let parentId = node.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    if (selectedIds.has(parentId)) return parentId;
    visited.add(parentId);
    parentId = nodesById.get(parentId)?.parentId ?? null;
  }
  return null;
}

export function normalizeSelectedNodeIds(nodes: Node[], ids: Iterable<string>) {
  const requested = new Set(ids);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes
    .filter(
      (node) =>
        requested.has(node.id) &&
        active(node) &&
        !(node.type === "category" && node.categoryKind === "routineRoot") &&
        !selectedAncestorId(byId, requested, node),
    )
    .sort(compareNodes)
    .map((node) => node.id);
}

export function selectedNodeState(
  nodes: Node[],
  selectedIds: ReadonlySet<string>,
  nodeId: string,
): "selected" | "contained" | "none" {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return "none";
  if (
    selectedAncestorId(
      new Map(nodes.map((item) => [item.id, item])),
      selectedIds,
      node,
    )
  )
    return "contained";
  return selectedIds.has(nodeId) ? "selected" : "none";
}

export function expandedSelectedNodeIds(nodes: Node[], ids: Iterable<string>) {
  const roots = new Set(normalizeSelectedNodeIds(nodes, ids));
  const included = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes)
      if (
        node.parentId &&
        included.has(node.parentId) &&
        active(node) &&
        !included.has(node.id)
      ) {
        included.add(node.id);
        changed = true;
      }
  }
  return included;
}

export function completableSelectedMemoIds(
  nodes: Node[],
  ids: Iterable<string>,
  now = new Date(),
) {
  const included = expandedSelectedNodeIds(nodes, ids);
  return nodes
    .filter(
      (node): node is MemoNode =>
        included.has(node.id) &&
        node.type === "memo" &&
        isTask(node) &&
        active(node) &&
        (routineCategoryForMemo(nodes, node)
          ? !isRoutineCompletedOn(node, now)
          : node.status === "active"),
    )
    .map((node) => node.id);
}

export function canMoveSelectedNodes(
  nodes: Node[],
  ids: Iterable<string>,
  destinationId: string | null,
) {
  const roots = normalizeSelectedNodeIds(nodes, ids);
  if (!roots.length) return false;
  const destination = destinationId
    ? nodes.find(
        (node) =>
          node.id === destinationId && node.type === "category" && active(node),
      )
    : null;
  if (destinationId && !destination) return false;
  return roots.every((id) => {
    const node = nodes.find((item) => item.id === id)!;
    return (
      canMoveNode(nodes, id, destinationId) &&
      (node.type !== "memo" || canContainMemo(nodes, destinationId)) &&
      !(
        node.type === "category" &&
        destination?.type === "category" &&
        destination.categoryKind === "routineRoot"
      )
    );
  });
}

export function moveSelectedNodes(
  nodes: Node[],
  ids: Iterable<string>,
  destinationId: string | null,
  now = new Date(),
) {
  const roots = normalizeSelectedNodeIds(nodes, ids);
  if (!canMoveSelectedNodes(nodes, roots, destinationId))
    throw new Error("選択したNodeをこの場所へ移動できません。");
  return roots.reduce(
    (current, id) => moveNode(current, id, destinationId, undefined, now),
    nodes,
  );
}

export function completeSelectedNodes(
  nodes: Node[],
  ids: Iterable<string>,
  now = new Date(),
) {
  return completableSelectedMemoIds(nodes, ids, now).reduce(
    (current, id) => completeMemo(current, id, now),
    nodes,
  );
}

export function deleteSelectedNodes(
  nodes: Node[],
  ids: Iterable<string>,
  now = new Date(),
) {
  return normalizeSelectedNodeIds(nodes, ids).reduce((current, id) => {
    const node = current.find((item) => item.id === id);
    return node
      ? softDeleteNode(current, id, node.type === "category", now)
      : current;
  }, nodes);
}
