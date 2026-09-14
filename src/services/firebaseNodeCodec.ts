import { Timestamp } from 'firebase/firestore';
import type { Node } from '@/models/node';

const DATE_FIELDS = ['createdAt', 'updatedAt', 'deletedAt', 'dueAt', 'completedAt'] as const;

export function nodeToFirestore(node: Node): Record<string, unknown> {
  const value: Record<string, unknown> = { ...node };
  for (const field of DATE_FIELDS) {
    const date = value[field];
    if (date instanceof Date) value[field] = Timestamp.fromDate(date);
  }
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key];
  return value;
}

export function nodeFromFirestore(id: string, source: Record<string, unknown>): Node {
  const value: Record<string, unknown> = { ...source, id };
  for (const field of DATE_FIELDS) {
    const date = value[field];
    if (date instanceof Timestamp) value[field] = date.toDate();
    else if (date && typeof date === 'object' && 'toDate' in date && typeof date.toDate === 'function') value[field] = date.toDate();
    else if (typeof date === 'string') value[field] = new Date(date);
  }
  return value as Node;
}

export function mergeNodesByUpdatedAt(local: Node[], remote: Node[]) {
  const merged = new Map(remote.map((node) => [node.id, node]));
  for (const node of local) {
    const cloud = merged.get(node.id);
    if (!cloud || node.updatedAt.getTime() > cloud.updatedAt.getTime()) merged.set(node.id, node);
  }
  return [...merged.values()];
}

export function nodeSyncFingerprint(node: Node) {
  return JSON.stringify(node, (_key, value) => value instanceof Date ? value.toISOString() : value);
}
