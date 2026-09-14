import type { Node } from '@/models/node';
import type { VisibleTreeRow } from '@/domain/treeView';

let traceSequence = 0;
let activeTraceId = 'tree-initial';
let mountSequence = 0;

export function beginTreeDragTrace(nodeId: string) {
  activeTraceId = `tree-drag-${++traceSequence}-${nodeId}`;
  return activeTraceId;
}

export const currentTreeTraceId = () => activeTraceId;

export function nodesRevision(nodes: Node[]) {
  return nodes.map((node) => `${node.id}:${node.parentId ?? 'root'}:${node.sortKey}:${node.updatedAt.getTime()}`).join('|');
}

export function nextTreeMountId() {
  return ++mountSequence;
}

export function summarizeNodes(nodes: Node[]) {
  return nodes.map((node) => ({ id: node.id, type: node.type, parentId: node.parentId, sortKey: node.sortKey, updatedAt: node.updatedAt.toISOString() }));
}

export function summarizeRows(rows: VisibleTreeRow[]) {
  return rows.map((row, index) => ({ index, key: row.node.id, id: row.node.id, parentId: row.node.parentId, depth: row.depth, hasNextSibling: row.hasNextSibling, ancestorContinuation: row.ancestorContinuation, virtual: row.virtual ?? null }));
}

export function treeDiagnosticLog(event: string, payload: Record<string, unknown> = {}) {
  if (!__DEV__) return;
  console.info(`[TaskMemoTree] ${JSON.stringify({ event, traceId: activeTraceId, at: Date.now(), ...payload })}`);
}
