import { describe, expect, it } from 'vitest';
import { generateNKeysBetween } from 'fractional-indexing';
import fixture from '../../docs/fixtures/text-format-production.json';
import type { Node } from '../models/node';
import { serializeText } from '../textFormat/session';
import { canonical, type TextPlan } from '../textFormat/syntax';
import { nodeFromV2Value, nodeToV2Value } from './nodeV2Codec';
import type { ApplicationJournalPersistence } from './applicationStore';
import type { VersionedNode } from './types';
import { TaskMemoV2ApplicationStore } from './taskMemoApplicationStore';
import { assertSafeNodeTransition, assertSafeTextTransition } from './destructiveSyncGuard';
import { InMemoryRevisionServer, applyRevisionOperation } from './revisionModel';

const now = '2026-10-02T03:00:00.000Z';
const options = { scope: 'test-account', view: 'tree' as const, timeZone: 'Asia/Tokyo' };
const category: Node = { id: 'cat', type: 'category', title: '仕事', parentId: null, sortKey: 'a0', createdAt: new Date(now), updatedAt: new Date(now), deletedAt: null };
const memo: Node = { ...category, id: 'memo', type: 'memo', parentId: 'cat', title: 'A', body: 'body', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, deadlineSortKey: 'a0', routineHistory: { '2026-09-30': now, '2026-09-29': null }, routineDueOverrides: { '2026-09-30': now }, repeatRule: null };
class AtomicMemory implements ApplicationJournalPersistence {
  committed: string | null = null; journal: string | null = null; fail = false;
  loadCommitted = async () => this.committed;
  loadJournal = async () => this.journal;
  writeJournal = async (value: string) => { this.journal = value; };
  writeCommitted = async (value: string) => { this.committed = value; };
  clearJournal = async () => { this.journal = null; };
  writeAtomic = async (expected: string | null, value: string) => {
    if (this.fail) throw new Error('atomic aborted');
    if (this.committed !== expected || this.journal) throw new Error('CAS conflict');
    this.committed = value;
  };
}
const open = async (nodes: Node[] = [category, memo], persistence = new AtomicMemory()) => ({ persistence, store: await TaskMemoV2ApplicationStore.open(persistence, nodes, { deviceId: 'test-device', now: () => new Date(now) }) });
const confirm = (plan: TextPlan) => ({ fingerprint: plan.fingerprint, deletedIds: [...plan.deletedIds] });
const snapshot = (store: TaskMemoV2ApplicationStore, p: AtomicMemory) => canonical({ nodes: store.nodes, history: store.historyDepths, outbox: store.outbox, committed: p.committed, journal: p.journal });

describe('Text editing Application boundary', () => {
  it.each(['tree', 'list'] as const)('[TW-LOCAL-001] local core without Firebase supports %s save/restart/History/Undo/Redo and preserves failed/discarded edits', async view => {
    let { store, persistence } = await open();
    const before = snapshot(store, persistence);
    const discarded = store.beginTextEdit({ ...options, view, systemRegions: view === 'tree' });
    const discardPlan = store.prepareTextEdit(discarded, serializeText(discarded).replace('| A |', '| discarded |'));
    expect(discardPlan.errors).toEqual([]);
    store.discardTextEdit(discarded);
    expect(snapshot(store, persistence)).toBe(before);
    const session = store.beginTextEdit({ ...options, view, systemRegions: view === 'tree' });
    const text = serializeText(session), invalid = store.prepareTextEdit(session, text.replace('期限なし', '10/'));
    expect(invalid.errors.length).toBeGreaterThan(0);
    await expect(store.commitTextEdit(invalid)).rejects.toThrow();
    expect(snapshot(store, persistence)).toBe(before);
    const plan = store.prepareTextEdit(session, text.replace('| A |', '| local edit |'));
    await store.commitTextEdit(plan);
    expect(store.nodes.find(n => n.id === memo.id)?.title).toBe('local edit');
    expect(store.historyDepths).toEqual({ past: 1, future: 0 });
    expect(store.outbox).toHaveLength(1); expect(store.outbox[0].baseRevision).toBe(0);
    store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
    expect(store.nodes.find(n => n.id === memo.id)?.title).toBe('local edit');
    expect(store.outbox).toHaveLength(1); expect(store.historyDepths.past).toBe(1);
    await store.undo(); expect(store.nodes.find(n => n.id === memo.id)?.title).toBe('A');
    await store.redo(); expect(store.nodes.find(n => n.id === memo.id)?.title).toBe('local edit');
    expect(store.outbox.map(op => op.baseRevision)).toEqual([0, 1, 2]);
  });
  it('[TW-SCOPE-001] account-scoped open does not implicitly adopt another local scope or its pending Outbox', async () => {
    const local = await open();
    const session = local.store.beginTextEdit(options);
    await local.store.commitTextEdit(local.store.prepareTextEdit(session, serializeText(session).replace('| A |', '| guest edit |')));
    const accountPersistence = new AtomicMemory();
    const account = await TaskMemoV2ApplicationStore.open(accountPersistence, [], { deviceId: 'account' });
    expect(account.nodes).toEqual([]); expect(account.outbox).toEqual([]);
    const restoredLocal = await TaskMemoV2ApplicationStore.open(local.persistence, [], { deviceId: 'ignored' });
    expect(restoredLocal.nodes.find(n => n.id === memo.id)?.title).toBe('guest edit'); expect(restoredLocal.outbox).toHaveLength(1);
  });
  it('sending a revision-zero local baseline to an existing account is not lossless adoption', async () => {
    const { store } = await open();
    const session = store.beginTextEdit(options);
    await store.commitTextEdit(store.prepareTextEdit(session, serializeText(session).replace('| A |', '| guest edit |')));
    const remote: VersionedNode = { ...store.versionedNode(memo.id)!, value: { ...store.versionedNode(memo.id)!.value, title: 'account edit' }, revision: 20, lastDeviceId: 'remote', lastOpId: 'remote:20', lastLocalSeq: 20 };
    const acknowledgement = applyRevisionOperation(remote, store.outbox[0]);
    expect(acknowledgement.result).toBe('superseded');
    await store.acknowledge(acknowledgement.opId, acknowledgement.record);
    expect(store.nodes.find(n => n.id === memo.id)?.title).toBe('account edit'); expect(store.outbox).toEqual([]);
    expect(await store.undo()).toEqual([]);
    expect(store.nodes.find(n => n.id === memo.id)?.title).toBe('account edit');
  });
  it('[TW-SYS-005] UI reserved-region save keeps the backing root untouched and Undo/Redo groups Routineization', async () => {
    const root: Node = { ...category, id: 'routine-root', title: 'Routine', sortKey: 'a1', categoryKind: 'routineRoot' };
    const routine: Node = { ...memo, id: 'routine', parentId: root.id, title: 'Daily', sortKey: 'a1', repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-09-01' } };
    const { store, persistence } = await open([category, memo, root, routine]);
    const baselineRoot = canonical(store.versionedNode(root.id));
    const session = store.beginTextEdit({ ...options, systemRegions: true });
    const text = '@root\n  @n1 | Category | 仕事\n@routine\n  @n2 | Task | A | | 未完了 | body | daily\n  @n3 | Task | Daily | | 未完了 | body | day interval=1 startsOn=2026-09-01';
    const plan = store.prepareTextEdit(session, text);
    expect(plan.errors).toEqual([]);
    await store.commitTextEdit(plan, plan.requiresConfirmation ? confirm(plan) : undefined);
    expect(store.historyDepths).toEqual({ past: 1, future: 0 });
    expect(canonical(store.versionedNode(root.id))).toBe(baselineRoot);
    expect(store.nodes.find(n => n.id === 'memo')).toMatchObject({ parentId: root.id, routineHistory: memo.routineHistory, routineDueOverrides: memo.routineDueOverrides });
    expect(store.outbox.some(op => op.targetNodeId === root.id)).toBe(false);
    await store.undo();
    expect(store.nodes.find(n => n.id === 'memo')).toMatchObject({ parentId: 'cat', repeatRule: null, routineHistory: memo.routineHistory });
    await store.redo();
    const restored = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
    expect(restored.nodes.find(n => n.id === 'memo')).toMatchObject({ parentId: root.id, repeatRule: { frequency: 'day', startsOn: '2026-10-02' } });
    expect(restored.historyDepths).toEqual({ past: 1, future: 0 });
  });
  it('[TW-HIST-001] commits mixed changes as one History entry and per-Node Outbox operations', async () => {
    const { store, persistence } = await open([category, memo, { ...memo, id: 'b', sortKey: 'a1', title: 'B' }]);
    const session = store.beginTextEdit(options);
    const lines = serializeText(session).split('\n');
    const text = [lines[0].replace('仕事', '改名'), lines[1].replace('未完了', '完了')].join('\n');
    const plan = store.prepareTextEdit(session, text);
    const ops = await store.commitTextEdit(plan, confirm(plan));
    expect(ops.map(op => op.type)).toEqual(['update', 'complete', 'softDelete']);
    expect(store.historyDepths).toEqual({ past: 1, future: 0 });
    expect(store.outbox).toHaveLength(3); expect(persistence.journal).toBeNull();
    expect(store.versionedNode('memo')!.revision).toBe(1);
    expect(ops.find(op => op.targetNodeId === 'memo')?.payload.node).toMatchObject({ id: 'memo', deadlineSortKey: 'a0', routineHistory: memo.routineHistory, routineDueOverrides: memo.routineDueOverrides });
  });
  it('[TW-HIST-002] Undo/Redo replays the whole text save and persists across restart', async () => {
    let { store, persistence } = await open();
    const session = store.beginTextEdit(options);
    const text = serializeText(session).replace('仕事', 'Category edit').replace('| A |', '| Memo edit |');
    const plan = store.prepareTextEdit(session, text);
    await store.commitTextEdit(plan, confirm(plan));
    store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
    expect(store.historyDepths).toEqual({ past: 1, future: 0 }); expect(store.outbox).toHaveLength(2);
    const undo = await store.undo(); expect(undo).toHaveLength(2);
    expect(store.nodes.map(n => n.title)).toEqual(['仕事', 'A']);
    const redo = await store.redo(); expect(redo).toHaveLength(2);
    expect(store.nodes.map(n => n.title)).toEqual(['Category edit', 'Memo edit']);
    expect(store.versionedNode('memo')!.revision).toBe(3);
  });
  it('[TW-HIST-003] Undo of creation soft deletes the same ID; Redo restores it', async () => {
    const { store } = await open(); const session = store.beginTextEdit(options);
    const plan = store.prepareTextEdit(session, serializeText(session) + '\n  Task | new');
    const [op] = await store.commitTextEdit(plan, confirm(plan));
    const id = op.targetNodeId; expect(op.type).toBe('create');
    await store.undo(); expect(store.versionedNode(id)!.value.deletedAt).toBeTruthy();
    await store.redo(); expect(store.versionedNode(id)!.value.deletedAt).toBeNull(); expect(store.versionedNode(id)!.revision).toBe(3);
  });
  it('[TW-HIST-004] Undo of Routine completion restores occurrence metadata, not definition status', async () => {
    const { store } = await open([{ ...category, categoryKind: 'routineRoot' }, memo]);
    const session = store.beginTextEdit(options), plan = store.prepareTextEdit(session, serializeText(session).replace('未完了', '完了'));
    await store.commitTextEdit(plan, confirm(plan)); expect(store.versionedNode('memo')!.value.status).toBe('active');
    await store.undo(); expect(store.versionedNode('memo')!.value.routineHistory).toEqual(memo.routineHistory);
    await store.redo(); expect(store.versionedNode('memo')!.value.routineHistory).toMatchObject({ '2026-10-02': now });
  });
  it('[TW-GUARD-002] requires exact reviewed deletion IDs/fingerprint and keeps the ordinary guard', async () => {
    const keys = generateNKeysBetween(null, null, 60);
    const nodes = keys.map((sortKey, i) => ({ ...category, id: `c${i}`, sortKey }));
    const { store, persistence } = await open(nodes), session = store.beginTextEdit(options);
    const plan = store.prepareTextEdit(session, ''); const before = snapshot(store, persistence);
    await expect(store.commitTextEdit(plan)).rejects.toThrow('確認'); expect(snapshot(store, persistence)).toBe(before);
    await expect(store.commitTextEdit(plan, { fingerprint: plan.fingerprint, deletedIds: ['c0'] })).rejects.toThrow('確認');
    const deleted = nodes.map(n => ({ ...n, deletedAt: new Date(now) }));
    expect(() => assertSafeNodeTransition(nodes, deleted, 'update')).toThrow('急減');
    expect(() => assertSafeTextTransition(nodes, deleted, ['c0'])).toThrow('一致');
    const operations = await store.commitTextEdit(plan, confirm(plan));
    expect(operations).toHaveLength(60); expect(store.historyDepths.past).toBe(1);
  });
  it('[TW-ATOMIC-001] never commits any partial edits when syntax/semantic errors exist', async () => {
    const { store, persistence } = await open(); const session = store.beginTextEdit(options);
    const plan = store.prepareTextEdit(session, serializeText(session).replace('仕事', 'change') + '\nTask | invalid | 月末あたり');
    const before = snapshot(store, persistence);
    await expect(store.commitTextEdit(plan)).rejects.toThrow(); expect(snapshot(store, persistence)).toBe(before);
  });
  it('[TW-CON-002] revalidates a remote change inside the serialized commit boundary', async () => {
    const { store, persistence } = await open(); const session = store.beginTextEdit(options);
    const plan = store.prepareTextEdit(session, serializeText(session).replace('| A |', '| local |'));
    const remote = { ...store.versionedNode('memo')!, value: { ...store.versionedNode('memo')!.value, title: 'remote' }, revision: 8, lastOpId: 'remote:8' };
    const receive = store.receive(remote);
    const save = store.commitTextEdit(plan, confirm(plan));
    await receive; const before = snapshot(store, persistence);
    await expect(save).rejects.toThrow('編集開始'); expect(snapshot(store, persistence)).toBe(before);
  });
  it('[TW-CON-003] rejects modified plans, baselines, confirmations and discarded sessions', async () => {
    const { store, persistence } = await open(); const session = store.beginTextEdit(options);
    const plan = store.prepareTextEdit(session, serializeText(session).replace('| A |', '| changed |'));
    const before = snapshot(store, persistence);
    const altered = JSON.parse(JSON.stringify(plan)) as TextPlan; altered.changes[0].after.title = 'injected';
    await expect(store.commitTextEdit(altered, confirm(altered))).rejects.toThrow('plan');
    plan.session.baseline[0].revision++;
    await expect(store.commitTextEdit(plan, confirm(plan))).rejects.toThrow('session');
    expect(snapshot(store, persistence)).toBe(before);
    store.discardTextEdit(session); expect(() => store.prepareTextEdit(session, '')).toThrow('session');
  });
  it('[TW-DUE-005] does not recalculate relative deadlines at commit or after restart', async () => {
    let clock = now; const p = new AtomicMemory();
    let store = await TaskMemoV2ApplicationStore.open(p, [category, memo], { deviceId: 'clock', now: () => new Date(clock) });
    const session = store.beginTextEdit(options), plan = store.prepareTextEdit(session, serializeText(session).replace('期限なし', '今日'));
    clock = '2026-10-05T03:00:00.000Z'; await store.commitTextEdit(plan, confirm(plan));
    expect(store.versionedNode('memo')!.value.dueAt).toBe('2026-10-02T14:59:00.000Z');
    store = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'ignored' });
    expect(store.versionedNode('memo')!.value.dueAt).toBe('2026-10-02T14:59:00.000Z');
  });
  it('[TW-ATOMIC-002] atomic save failure leaves Domain/History/Outbox/storage unchanged even after restart', async () => {
    const { store, persistence } = await open(); const session = store.beginTextEdit(options);
    const plan = store.prepareTextEdit(session, serializeText(session).replace('仕事', 'change').replace('| A |', '| edit |'));
    persistence.fail = true; const before = snapshot(store, persistence);
    await expect(store.commitTextEdit(plan, confirm(plan))).rejects.toThrow('aborted');
    expect(snapshot(store, persistence)).toBe(before);
    const reopened = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
    expect(snapshot(reopened, persistence)).toBe(before);
    persistence.fail = false; expect(await store.commitTextEdit(plan, confirm(plan))).toHaveLength(2);
  });
  it('[TW-ATOMIC-003] refuses storage without atomic capability and stale persisted envelopes', async () => {
    const { store, persistence } = await open(); const session = store.beginTextEdit(options);
    const plan = store.prepareTextEdit(session, serializeText(session).replace('| A |', '| edit |'));
    const stale = JSON.parse(persistence.committed!); stale.nextLocalSeq++;
    persistence.committed = JSON.stringify(stale); const before = snapshot(store, persistence);
    await expect(store.commitTextEdit(plan, confirm(plan))).rejects.toThrow('保存先'); expect(snapshot(store, persistence)).toBe(before);
  });
  it('[TW-ATOMIC-004] requires atomic storage capability instead of falling back to a replayable WAL', async () => {
    const { store, persistence } = await open();
    Object.defineProperty(persistence, 'writeAtomic', { value: undefined });
    const session = store.beginTextEdit(options), plan = store.prepareTextEdit(session, serializeText(session).replace('| A |', '| edit |'));
    const before = snapshot(store, persistence);
    await expect(store.commitTextEdit(plan)).rejects.toThrow('storage'); expect(snapshot(store, persistence)).toBe(before);
  });
  it('[TW-META-001] preserves deleted/purged/unknown fields and untouched raw field absence', async () => {
    const { persistence } = await open([category, memo, { ...memo, id: 'deleted', deletedAt: new Date(now) }, { ...memo, id: 'purged', deletedAt: new Date(now), purgedAt: new Date(now) }]);
    const raw = JSON.parse(persistence.committed!); raw.domain.memo.value.unknown = { nested: ['keep', null] }; delete raw.domain.cat.value.deletionBatchId;
    persistence.committed = JSON.stringify(raw);
    const reopened = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored', now: () => new Date(now) });
    const oldDeleted = canonical(reopened.versionedNode('deleted')), oldPurged = canonical(reopened.versionedNode('purged')), oldCat = canonical(reopened.versionedNode('cat'));
    const session = reopened.beginTextEdit(options), plan = reopened.prepareTextEdit(session, serializeText(session).replace('| A |', '| changed |'));
    await reopened.commitTextEdit(plan, confirm(plan));
    expect(canonical(reopened.versionedNode('deleted'))).toBe(oldDeleted); expect(canonical(reopened.versionedNode('purged'))).toBe(oldPurged); expect(canonical(reopened.versionedNode('cat'))).toBe(oldCat);
    expect(reopened.versionedNode('memo')!.value.unknown).toEqual({ nested: ['keep', null] });
  });
  it('[TW-SYNC-001] Outbox converges through the existing revision server and acknowledgements', async () => {
    const { store } = await open(); const session = store.beginTextEdit(options);
    const plan = store.prepareTextEdit(session, serializeText(session).replace('| A |', '| changed |'));
    const ops = await store.commitTextEdit(plan, confirm(plan)), server = new InMemoryRevisionServer();
    for (const op of ops) { const ack = server.apply(op); await store.acknowledge(ack.opId, ack.record); }
    expect(store.outbox).toHaveLength(0); expect(server.get('memo')!.value.title).toBe('changed');
    await store.undo(); expect(store.outbox[0].type).toBe('undo');
  });
  it('[TW-HIST-005] blocks the whole text Undo when one target changes remotely', async () => {
    const { store } = await open(); const session = store.beginTextEdit(options);
    const plan = store.prepareTextEdit(session, serializeText(session).replace('仕事', 'C').replace('| A |', '| B |'));
    await store.commitTextEdit(plan, confirm(plan));
    const record = store.versionedNode('memo')!; await store.receive({ ...record, revision: record.revision + 2, lastOpId: 'remote:99', lastDeviceId: 'remote', value: { ...record.value, title: 'remote' } });
    expect(await store.undo()).toEqual([]); expect(store.nodes[0].title).toBe('C'); expect(store.historyDepths.past).toBe(1);
  });
  it.each([{ view: 'tree' as const, systemRegions: false }, { view: 'list' as const, systemRegions: false }, { view: 'tree' as const, systemRegions: true }])('[TW-FIX-004] production fixture $view regions=$systemRegions no-edit creates no History/Outbox/write', async ({ view, systemRegions }) => {
    const { persistence } = await open((fixture.records as VersionedNode[]).map(r => nodeFromV2Value(r.value)));
    const raw = JSON.parse(persistence.committed!);
    raw.domain = Object.fromEntries(fixture.records.map(r => [r.value.id, r]));
    persistence.committed = JSON.stringify(raw);
    const current = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored', now: () => new Date(now) });
    const session = current.beginTextEdit({ ...options, view, systemRegions }), before = snapshot(current, persistence);
    const plan = current.prepareTextEdit(session, serializeText(session));
    expect(plan.errors).toEqual([]); expect(plan.changes).toEqual([]);
    expect(await current.commitTextEdit(plan)).toEqual([]); expect(snapshot(current, persistence)).toBe(before);
    expect(current.nodes.map(nodeToV2Value)).toHaveLength(176);
  });
});
