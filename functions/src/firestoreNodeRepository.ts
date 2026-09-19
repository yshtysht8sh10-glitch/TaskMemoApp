import { createHash } from 'node:crypto';
import { getFirestore, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

import type { Node } from '../../src/models/node.js';
import { ExternalAiError } from '../../src/external-ai/errors.js';
import type { ExternalAiWriteContext, TaskMemoNodeRepository, TaskMemoReadSnapshot } from '../../src/external-ai/repository.js';
import { applyRevisionOperation } from '../../src/sync/revisionModel.js';
import type { SyncNodeValue, SyncOperation, SyncOperationType, VersionedNode } from '../../src/sync/types.js';

const DATE_FIELDS = ['createdAt', 'updatedAt', 'deletedAt', 'purgedAt', 'dueAt', 'completedAt'] as const;
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
const fingerprint = (value: unknown) => JSON.stringify(stable(value), (_key, item) => item instanceof Date ? item.toISOString() : item);
const safeId = (value: string) => createHash('sha256').update(value).digest('hex');
const sequence = (value: string) => Number.parseInt(safeId(value).slice(0, 12), 16);

function decodeNode(value: SyncNodeValue): Node {
  const node: Record<string, unknown> = { ...value };
  for (const field of DATE_FIELDS) if (typeof node[field] === 'string') node[field] = new Date(node[field] as string);
  return node as Node;
}

function encodeNode(node: Node): SyncNodeValue {
  const value: Record<string, unknown> = { ...node };
  for (const field of DATE_FIELDS) if (value[field] instanceof Date) value[field] = (value[field] as Date).toISOString();
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key];
  return value as SyncNodeValue;
}

function validateUid(uid: string) {
  if (!uid || uid.includes('/')) throw new ExternalAiError('auth', '認証済みユーザーを確認できません。');
}

function validateRecord(uid: string, id: string, data: Record<string, unknown>): VersionedNode {
  const record = data.record as VersionedNode | undefined;
  const value = record?.value;
  const validBase = value && (value.type === 'category' || value.type === 'memo')
    && typeof value.title === 'string' && typeof value.sortKey === 'string'
    && (value.parentId === null || typeof value.parentId === 'string')
    && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string'
    && (value.deletedAt === null || typeof value.deletedAt === 'string');
  const validMemo = value?.type !== 'memo' || (typeof value.body === 'string' && typeof value.status === 'string'
    && (value.dueAt === null || typeof value.dueAt === 'string'));
  if (data.ownerUid !== uid || data.schemaVersion !== 2 || !record || record.value?.id !== id
    || !Number.isInteger(record.revision) || record.revision < 0 || typeof record.lastOpId !== 'string'
    || typeof record.lastDeviceId !== 'string' || !Number.isInteger(record.lastLocalSeq) || !validBase || !validMemo)
    throw new ExternalAiError('validation', 'V2 NodeのschemaまたはownerUidが不正です。');
  return record;
}

const operationType = (operation: string): SyncOperationType => ({
  create_memo: 'create', update_memo: 'update', complete_memo: 'complete', delete_memo: 'softDelete', restore_memo: 'restore',
} as Record<string, SyncOperationType>)[operation] ?? 'update';

export class FirestoreTaskMemoNodeRepository implements TaskMemoNodeRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private async assertGate(uid: string, get: (ref: FirebaseFirestore.DocumentReference) => Promise<FirebaseFirestore.DocumentSnapshot>) {
    const global = await get(this.db.doc('syncControl/current'));
    const user = await get(this.db.doc(`users/${uid}/syncMetadataV2/compatibility`));
    const globalData = global.data(); const gate = user.data();
    if (globalData?.schemaVersion !== 1 || globalData.writesEnabled !== true
      || gate?.schemaVersion !== 1 || gate.minimumSyncProtocol !== 2 || gate.v1WritesAllowed !== false || gate.v2Enabled !== true)
      throw new ExternalAiError('conflict', 'V2 compatibility gateが有効ではありません。');
  }

  async read(uid: string): Promise<TaskMemoReadSnapshot> {
    validateUid(uid);
    await this.assertGate(uid, (ref) => ref.get());
    const snapshot = await this.db.collection(`users/${uid}/nodesV2`).get();
    const records = snapshot.docs.map((document) => validateRecord(uid, document.id, document.data()));
    return { nodes: records.map((record) => decodeNode(record.value)), revisions: Object.fromEntries(records.map((record) => [record.value.id, record.revision])) };
  }

  async transact<T>(uid: string, mutate: (snapshot: TaskMemoReadSnapshot) => { nodes: Node[]; result: T }, context: ExternalAiWriteContext) {
    validateUid(uid);
    if (!context.requestId || !/^[0-9a-f-]{16,64}$/i.test(context.requestId)) throw new ExternalAiError('validation', 'writeには有効なrequestIdが必要です。');
    if (!context.producerId) throw new ExternalAiError('auth', 'AI producer identityがありません。');
    const requestId = context.requestId;
    const producerId = context.producerId;
    const requestKey = safeId(`${producerId}:${requestId}`);
    const requestRef = this.db.doc(`users/${uid}/externalAiRequestsV2/${requestKey}`);
    return this.db.runTransaction(async (transaction) => {
      await this.assertGate(uid, (ref) => transaction.get(ref));
      const existingRequest = await transaction.get(requestRef);
      if (existingRequest.exists) return existingRequest.data()!.result as T;
      const collection = this.db.collection(`users/${uid}/nodesV2`);
      const source = await transaction.get(collection);
      const records = new Map(source.docs.map((document) => [document.id, validateRecord(uid, document.id, document.data())]));
      const before: TaskMemoReadSnapshot = { nodes: [...records.values()].map((record) => decodeNode(record.value)), revisions: Object.fromEntries([...records].map(([id, record]) => [id, record.revision])) };
      const changed = mutate(before);
      const previous = new Map(before.nodes.map((node) => [node.id, fingerprint(node)]));
      const changedNodes = changed.nodes.filter((node) => previous.get(node.id) !== fingerprint(node));
      const operations: SyncOperation[] = [];
      for (const node of changedNodes) {
        const current = records.get(node.id);
        if (current && context.expectedRevision !== current.revision) throw new ExternalAiError('conflict', `Nodeはrevision ${current.revision}へ更新済みです。再読込してください。`);
        if (!current && operationType(context.operation) !== 'create') throw new ExternalAiError('not_found', '対象Nodeが見つかりません。');
        const encoded = encodeNode(node);
        if (current?.value.purgedAt && !encoded.purgedAt) throw new ExternalAiError('conflict', '完全削除済みNodeは復元できません。');
        const identity = `${producerId}:${requestId}:${node.id}`;
        const operation: SyncOperation = {
          opId: `external-ai:${safeId(identity)}`, deviceId: `external-ai:${safeId(producerId).slice(0, 24)}`,
          localSeq: sequence(identity), targetNodeId: node.id, targetType: 'node', type: operationType(context.operation),
          baseRevision: current?.revision ?? 0, payload: { node: encoded }, createdAt: node.updatedAt.toISOString(),
          status: 'pending', attemptCount: 0, nextRetryAt: null, lastError: null,
        };
        const acknowledgement = applyRevisionOperation(current, operation);
        const operationRef = this.db.doc(`users/${uid}/syncOperationsV2/${operation.opId}`);
        const priorOperation = await transaction.get(operationRef);
        if (priorOperation.exists && fingerprint(priorOperation.data()!.operation) !== fingerprint(operation)) throw new ExternalAiError('conflict', 'idempotency keyが異なるoperation payloadへ再利用されました。');
        if (!priorOperation.exists) {
          if (acknowledgement.result === 'applied') transaction.set(collection.doc(node.id), { ownerUid: uid, schemaVersion: 2, record: acknowledgement.record, serverUpdatedAt: FieldValue.serverTimestamp() });
          transaction.set(operationRef, { ownerUid: uid, schemaVersion: 2, producerType: 'externalAI', operation, acknowledgement, serverReceivedAt: FieldValue.serverTimestamp() });
        }
        operations.push(operation);
      }
      transaction.set(requestRef, { ownerUid: uid, schemaVersion: 2, producerType: 'externalAI', requestId, operation: context.operation, operationIds: operations.map((item) => item.opId), result: changed.result, completedAt: Timestamp.now() });
      if (changedNodes.length) transaction.set(this.db.collection(`users/${uid}/externalAiAuditLogs`).doc(), { ownerUid: uid, operation: context.operation, requestId, operationIds: operations.map((item) => item.opId), changedNodeIds: changedNodes.map((node) => node.id), occurredAt: Timestamp.now(), source: 'externalAI-v2' });
      return changed.result;
    });
  }
}
