import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { MemoNode, Node } from '../../src/models/node.js';
import { updateNode } from '../../src/domain/nodeOperations.js';
import { TaskMemoApplicationService } from '../../src/external-ai/taskMemoApplicationService.js';
import { TaskMemoV2ApplicationStore } from '../../src/sync/taskMemoApplicationStore.js';
import type { ApplicationJournalPersistence } from '../../src/sync/applicationStore.js';
import type { VersionedNode } from '../../src/sync/types.js';
import { FirestoreTaskMemoNodeRepository } from './firestoreNodeRepository.js';

const enabled = process.env.TASKMEMO_FUNCTIONS_EMULATOR_E2E === '1';
const uid = 'ai-owner';
const requestId = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const at = (second: number) => new Date(`2026-09-19T00:00:${String(second).padStart(2, '0')}.000Z`);
const memo = (id = 'memo-a'): MemoNode => ({ id, type: 'memo', memoType: 'task', parentId: null, sortKey: 'a0', title: 'A', body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, repeatRule: null, routineHistory: {}, createdAt: at(0), updatedAt: at(0), deletedAt: null, purgedAt: null });
const category = (): Node => ({ id: 'category-a', type: 'category', parentId: null, sortKey: 'b0', title: 'Category', createdAt: at(0), updatedAt: at(0), deletedAt: null });
const value = (node: Node) => JSON.parse(JSON.stringify(node)) as Record<string, unknown>;
const record = (node: Node, revision = 1, opId = 'seed:1'): VersionedNode => ({ value: value(node) as VersionedNode['value'], revision, lastOpId: opId, lastDeviceId: 'seed', lastLocalSeq: 1, operationType: 'import' });
class MemoryPersistence implements ApplicationJournalPersistence { committed: string | null = null; journal: string | null = null; loadCommitted = async () => this.committed; loadJournal = async () => this.journal; writeJournal = async (v: string) => { this.journal = v; }; writeCommitted = async (v: string) => { this.committed = v; }; clearJournal = async () => { this.journal = null; }; }

describe.runIf(enabled)('External AI V2 Firestore repository', () => {
  const app = initializeApp({ projectId: 'demo-taskmemo-v2' }, 'external-ai-v2-tests');
  const db: Firestore = getFirestore(app);
  const repository = new FirestoreTaskMemoNodeRepository(db);
  const service = new TaskMemoApplicationService(repository, () => at(5));
  const user = { uid, producerId: 'external-ai:test-client' };

  beforeAll(() => { db.settings({ host: '127.0.0.1:8180', ssl: false, ignoreUndefinedProperties: true }); });
  beforeEach(async () => {
    await db.recursiveDelete(db.doc(`users/${uid}`));
    await db.doc('syncControl/current').set({ schemaVersion: 1, writesEnabled: true });
    await db.doc(`users/${uid}/syncMetadataV2/compatibility`).set({ schemaVersion: 1, minimumSyncProtocol: 2, v1WritesAllowed: false, v2Enabled: true });
  });
  afterAll(async () => { await deleteApp(app); });

  const seed = async (node: Node, revision = 1, opId = 'seed:1', ownerUid = uid) => db.doc(`users/${uid}/nodesV2/${node.id}`).set({ ownerUid, schemaVersion: 2, record: record(node, revision, opId) });

  it('reads V2 Memo/Category wrappers and filters deleted/purged resources in the AI read model', async () => {
    await seed(memo()); await seed(category()); await seed({ ...memo('deleted'), deletedAt: at(1) }); await seed({ ...memo('purged'), deletedAt: at(1), purgedAt: at(2) });
    expect((await service.listMemos(user)).map((item) => item.id)).toEqual(['memo-a']);
    expect((await service.listMemos(user, { includeDeleted: true })).map((item) => item.id).sort()).toEqual(['deleted', 'memo-a']);
    expect(await service.listCategories(user)).toEqual([{ id: 'category-a', title: 'Category', parentId: null, sortKey: 'b0', revision: 1 }]);
  });

  it('creates one V2 winner and operation/request receipts when the same AI request is retried', async () => {
    const input = { requestId: requestId(1), title: 'AI create' };
    const first = await service.createMemo(user, input); const second = await service.createMemo(user, input);
    expect(second).toEqual(first);
    const nodes = await db.collection(`users/${uid}/nodesV2`).get();
    const operations = await db.collection(`users/${uid}/syncOperationsV2`).get();
    const requests = await db.collection(`users/${uid}/externalAiRequestsV2`).get();
    expect(nodes.size).toBe(1); expect(nodes.docs[0].data().record.revision).toBe(1);
    expect(operations.size).toBe(1); expect(operations.docs[0].data()).toMatchObject({ ownerUid: uid, schemaVersion: 2, producerType: 'externalAI', acknowledgement: { result: 'applied' } });
    expect(requests.size).toBe(1);
  });

  it('rejects a stale AI update after another producer advanced the revision', async () => {
    await seed(memo(), 2, 'device:2');
    await expect(service.updateMemo(user, { requestId: requestId(2), expectedRevision: 1, memoId: 'memo-a', newTitle: 'stale' })).rejects.toMatchObject({ code: 'conflict' });
    expect((await service.getMemo(user, { memoId: 'memo-a' })).title).toBe('A');
  });

  it('writes soft-delete and restore operations but exposes no purge capability', async () => {
    await seed(memo());
    const deleted = await service.deleteMemo(user, { requestId: requestId(4), expectedRevision: 1, memoId: 'memo-a' });
    expect(deleted.deletedAt).toBeTruthy();
    const restored = await service.restoreMemo(user, { requestId: requestId(5), expectedRevision: 2, memoId: 'memo-a' });
    expect(restored.deletedAt).toBeNull();
    const operations = await db.collection(`users/${uid}/syncOperationsV2`).get();
    expect(operations.docs.map((item) => item.data().operation.type).sort()).toEqual(['restore', 'softDelete']);
    expect(operations.docs.some((item) => item.data().operation.type === 'purge')).toBe(false);
  });

  it('fails closed for owner mismatch, another UID, and protocol mismatch', async () => {
    await seed(memo(), 1, 'seed:1', 'another-user');
    await expect(repository.read(uid)).rejects.toMatchObject({ code: 'validation' });
    await expect(repository.read('another-user')).rejects.toMatchObject({ code: 'conflict' });
    await db.doc(`users/${uid}/syncMetadataV2/compatibility`).set({ schemaVersion: 1, minimumSyncProtocol: 1, v1WritesAllowed: true, v2Enabled: false });
    await expect(repository.read(uid)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('flows an AI operation into a V2 client and blocks same-resource local Undo without adding remote History', async () => {
    await seed(memo());
    const store = await TaskMemoV2ApplicationStore.open(new MemoryPersistence(), [memo()], { deviceId: 'device-a', now: () => at(9) });
    await store.command('local edit', 'update', (nodes) => updateNode(nodes, 'memo-a', { title: 'local' }, at(1)));
    const local = store.versionedNode('memo-a')!;
    await db.doc(`users/${uid}/nodesV2/memo-a`).set({ ownerUid: uid, schemaVersion: 2, record: local });
    await service.updateMemo(user, { requestId: requestId(3), expectedRevision: local.revision, memoId: 'memo-a', newTitle: 'AI' });
    const incoming = (await db.doc(`users/${uid}/nodesV2/memo-a`).get()).data()!.record as VersionedNode;
    const depth = store.historyDepths;
    await store.receive(incoming);
    expect(store.nodes[0].title).toBe('AI'); expect(store.historyDepths).toEqual(depth);
    expect(await store.undo(at(6))).toEqual([]); expect(store.nodes[0].title).toBe('AI'); expect(store.historyDepths).toEqual(depth);
  });
});
