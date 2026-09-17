import { getFirestore, Timestamp } from 'firebase-admin/firestore';

import type { Node } from '../../src/models/node.js';
import type { TaskMemoNodeRepository } from '../../src/external-ai/repository.js';

const DATE_FIELDS = ['createdAt', 'updatedAt', 'deletedAt', 'purgedAt', 'dueAt', 'completedAt'] as const;

function fromFirestore(id: string, source: Record<string, unknown>): Node {
  const value: Record<string, unknown> = { ...source, id };
  for (const field of DATE_FIELDS) {
    const current = value[field];
    if (current && typeof current === 'object' && 'toDate' in current && typeof current.toDate === 'function') value[field] = current.toDate();
  }
  return value as Node;
}

function toFirestore(node: Node) {
  const value: Record<string, unknown> = { ...node };
  delete value.id;
  for (const field of DATE_FIELDS) {
    const current = value[field];
    if (current instanceof Date) value[field] = Timestamp.fromDate(current);
  }
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key];
  return value;
}

const fingerprint = (node: Node) => JSON.stringify(node, (_key, value) => value instanceof Date ? value.toISOString() : value);

export class FirestoreTaskMemoNodeRepository implements TaskMemoNodeRepository {
  private readonly db = getFirestore();

  async read(uid: string) {
    const snapshot = await this.db.collection('users').doc(uid).collection('nodes').get();
    return snapshot.docs.map((document) => fromFirestore(document.id, document.data()));
  }

  async transact<T>(uid: string, mutate: (nodes: Node[]) => { nodes: Node[]; result: T }, audit?: { operation: string }) {
    const collection = this.db.collection('users').doc(uid).collection('nodes');
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(collection);
      const before = snapshot.docs.map((document) => fromFirestore(document.id, document.data()));
      const changed = mutate(before);
      const previous = new Map(before.map((node) => [node.id, fingerprint(node)]));
      const changedIds: string[] = [];
      for (const node of changed.nodes) {
        if (previous.get(node.id) !== fingerprint(node)) { transaction.set(collection.doc(node.id), toFirestore(node)); changedIds.push(node.id); }
      }
      if (audit && changedIds.length) transaction.set(this.db.collection('users').doc(uid).collection('externalAiAuditLogs').doc(), {
        operation: audit.operation, changedNodeIds: changedIds, occurredAt: Timestamp.now(), source: 'remote-mcp',
      });
      // Documents are never physically deleted here. purgedAt tombstones therefore survive
      // every external-AI operation and remain compatible with the client sync path.
      return changed.result;
    });
  }
}
