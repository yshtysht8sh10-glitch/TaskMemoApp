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

export function sameNodes(a: Node[], b: Node[]) {
  return a === b || (a.length === b.length && a.every((node, index) => sameValue(node, b[index])));
}

export function commitNodeHistory(history: NodeHistory, label: string, operation: (nodes: Node[]) => Node[]): NodeHistory {
  const next = operation(history.nodes);
  if (sameNodes(history.nodes, next)) return history;
  const entry = { label, before: history.nodes, after: next };
  return { nodes: next, past: [...history.past, entry].slice(-NODE_HISTORY_LIMIT), future: [] };
}

export function undoNodeHistory(history: NodeHistory): NodeHistory {
  const entry = history.past.at(-1);
  if (!entry) return history;
  return { nodes: entry.before, past: history.past.slice(0, -1), future: [entry, ...history.future] };
}

export function redoNodeHistory(history: NodeHistory): NodeHistory {
  const [entry, ...future] = history.future;
  if (!entry) return history;
  return { nodes: entry.after, past: [...history.past, entry], future };
}

export function replaceNodeHistory(history: NodeHistory, nodes: Node[]): NodeHistory {
  return { nodes, past: [], future: [] };
}
