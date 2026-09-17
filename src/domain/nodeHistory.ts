import type { Node } from '@/models/node';

export const NODE_HISTORY_LIMIT = 75;

export type NodeHistoryEntry = {
  label: string;
  before: Node[];
  after: Node[];
};

export type NodeHistory = {
  nodes: Node[];
  past: NodeHistoryEntry[];
  future: NodeHistoryEntry[];
};

export const createNodeHistory = (nodes: Node[]): NodeHistory => ({ nodes, past: [], future: [] });

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const aRecord = a as Record<string, unknown>; const bRecord = b as Record<string, unknown>;
  const keys = Object.keys(aRecord);
  return keys.length === Object.keys(bRecord).length && keys.every((key) => sameValue(aRecord[key], bRecord[key]));
}

function sameNodeContent(a: Node, b: Node) {
  const { updatedAt: _aUpdatedAt, ...aContent } = a;
  const { updatedAt: _bUpdatedAt, ...bContent } = b;
  return sameValue(aContent, bContent);
}

function replayNodes(current: Node[], target: Node[], now: Date) {
  const currentById = new Map(current.map((node) => [node.id, node]));
  return target.map((node) => {
    const previous = currentById.get(node.id);
    if (!previous || sameNodeContent(previous, node)) return node;
    const updatedAt = new Date(Math.max(now.getTime(), previous.updatedAt.getTime() + 1));
    if (previous.type === 'memo' && node.type === 'memo') {
      const routineHistory = { ...node.routineHistory };
      for (const key of Object.keys(previous.routineHistory ?? {}))
        if (!(key in routineHistory)) routineHistory[key] = null;
      return {
        ...node,
        ...(Object.keys(routineHistory).length ? { routineHistory } : {}),
        updatedAt,
      };
    }
    return { ...node, updatedAt };
  });
}

export function sameNodes(a: Node[], b: Node[]) {
  return a === b || (a.length === b.length && a.every((node, index) => sameValue(node, b[index])));
}

export function sameNodeSet(a: Node[], b: Node[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const bById = new Map(b.map((node) => [node.id, node]));
  return a.every((node) => {
    const other = bById.get(node.id);
    return !!other && sameValue(node, other);
  });
}

export function commitNodeHistory(history: NodeHistory, label: string, operation: (nodes: Node[]) => Node[]): NodeHistory {
  const next = operation(history.nodes);
  if (sameNodes(history.nodes, next)) return history;
  const entry = { label, before: history.nodes, after: next };
  return { nodes: next, past: [...history.past, entry].slice(-NODE_HISTORY_LIMIT), future: [] };
}

export function undoNodeHistory(history: NodeHistory, now = new Date()): NodeHistory {
  const entry = history.past.at(-1);
  if (!entry) return history;
  return { nodes: replayNodes(history.nodes, entry.before, now), past: history.past.slice(0, -1), future: [entry, ...history.future] };
}

export function redoNodeHistory(history: NodeHistory, now = new Date()): NodeHistory {
  const [entry, ...future] = history.future;
  if (!entry) return history;
  return { nodes: replayNodes(history.nodes, entry.after, now), past: [...history.past, entry], future };
}

export function replaceNodeHistory(history: NodeHistory, nodes: Node[]): NodeHistory {
  return { nodes, past: [], future: [] };
}

export function reconcileSyncedNodeHistory(history: NodeHistory, nodes: Node[]): NodeHistory {
  if (sameNodeSet(history.nodes, nodes)) return history;
  return replaceNodeHistory(history, nodes);
}
