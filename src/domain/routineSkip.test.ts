import { describe, expect, it, vi } from 'vitest';
import type { MemoNode, Node } from '../models/node';
import { deadlineGroups } from './deadlineView';
import { completionHistoryGroups } from './completionHistory';
import { skipRoutineOccurrence, clearRoutineSkip, completeRoutineOccurrence } from './routine';
import { routineListTarget, removeFromDeadlineList, completeFromDeadlineList } from './routineListActions';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import { InMemoryRevisionServer } from '../sync/revisionModel';
import { IndexedDbTaskMemoApplicationJournal } from '../sync/indexedDbApplicationStorage';
import { IDBFactory } from 'fake-indexeddb';
import { parseNodeBackup, serializeNodeBackup } from '../services/nodeBackup';
import { mergeNodesByUpdatedAt } from '../services/firebaseNodeCodec';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));

export const today = new Date(2026, 9, 17, 10);
const tomorrow = new Date(2026, 9, 18, 10);
const yesterday = new Date(2026, 9, 16, 10);
export const seed = (): Node[] => [{ id: 'r', type: 'category', categoryKind: 'routineRoot', parentId: null, sortKey: 'a0', title: 'ルーティーン', createdAt: today, updatedAt: today, deletedAt: null }, {
  id: 'running:daily', type: 'memo', memoType: 'task', parentId: 'r', sortKey: 'a0', title: 'ランニング', body: '30分', dueAt: today, duePreset: 'custom', status: 'active', completedAt: null, repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-15' }, routineHistory: { '2026-10-15': yesterday.toISOString() }, createdAt: today, updatedAt: today, deletedAt: null,
}];
const memo = (nodes: Node[]) => nodes.find(n => n.id === 'running:daily') as MemoNode;
const rows = (nodes: Node[], at = today) => deadlineGroups(nodes, at).flatMap(g => g.memos);
const history = (nodes: Node[]) => completionHistoryGroups(nodes, 'completedAt').flatMap(g => g.items);
const memory = () => {
  let committed: string | null = null, journal: string | null = null;
  return { loadCommitted: async () => committed, loadJournal: async () => journal, writeCommitted: async (v: string) => { committed = v; }, writeJournal: async (v: string) => { journal = v; }, clearJournal: async () => { journal = null; } };
};

describe('Routine occurrence skip', () => {
  it('skips today running without deleting its definition and shows tomorrow running normally', () => {
    const before = seed(), after = skipRoutineOccurrence(before, 'running:daily', today, today);
    expect(rows(after).map(m => m.id)).not.toContain('running:daily');
    expect(rows(after, tomorrow).map(m => m.id)).toContain('running:daily');
    expect(rows(after, tomorrow).some(m => m.routineOccurrenceKey === '2026-10-17')).toBe(false);
    const { updatedAt: _a, routineOutcomes: _b, ...unchanged } = memo(after);
    const { updatedAt: _old, ...original } = memo(before);
    expect(unchanged).toEqual(original);
    expect(memo(after).deletedAt).toBeNull();
  });
  it('resolves overdue IDs containing colons, skips only that date and preserves history', () => {
    const source = seed(), row = rows(source).find(m => m.routineOccurrenceKey === '2026-10-16')!;
    expect(routineListTarget(source, row, today)).toEqual({ memoId: 'running:daily', dateKey: '2026-10-16' });
    const after = removeFromDeadlineList(source, row, today);
    expect(rows(after).map(m => m.id)).toEqual(['running:daily']);
    expect(history(after).map(i => [i.occurrenceDate?.getDate(), i.outcome ?? 'completed'])).toContainEqual([16, 'skipped']);
    expect(memo(after).routineHistory).toEqual(memo(source).routineHistory);
  });
  it('cancels skip and restores the original overdue occurrence', () => {
    const skipped = skipRoutineOccurrence(seed(), 'running:daily', yesterday, today);
    const after = clearRoutineSkip(skipped, 'running:daily', yesterday, today);
    expect(rows(after).some(m => m.routineOccurrenceKey === '2026-10-16')).toBe(true);
    expect(history(after).some(i => i.outcome === 'skipped')).toBe(false);
  });
  it('overdue menu complete uses occurrence date, and completion replaces a skip atomically', () => {
    const source = seed(), row = rows(source).find(m => m.routineOccurrenceKey === '2026-10-16')!;
    const after = completeFromDeadlineList(source, row, today);
    expect(memo(after).routineHistory?.['2026-10-16']).toBeTruthy();
    expect(memo(after).routineHistory?.['2026-10-17']).toBeUndefined();
    const skipped = skipRoutineOccurrence(source, 'running:daily', today, today);
    const done = completeRoutineOccurrence(skipped, 'running:daily', today, today);
    expect(history(done).filter(i => i.occurrenceDate?.getDate() === 17).map(i => i.outcome)).toEqual(['completed']);
  });
  it('keeps normal Task deletion unchanged and rejects stale/invalid routine targets', () => {
    const task = { ...memo(seed()), id: 'task', parentId: null, repeatRule: null };
    expect(removeFromDeadlineList([task], task, today)[0].deletedAt).toEqual(today);
    expect(() => skipRoutineOccurrence(seed(), 'missing', today, today)).toThrow();
    expect(() => routineListTarget(seed(), { ...memo(seed()), routineSourceId: 'running:daily', routineOccurrenceKey: 'bad' }, today)).toThrow();
  });
  it('persists skip, Undo/Redo and history through isolated IndexedDB restart', async () => {
    const factory = new IDBFactory();
    const persistence = await IndexedDbTaskMemoApplicationJournal.open('routine-skip-test', factory);
    let store = await TaskMemoV2ApplicationStore.open(persistence, seed(), { deviceId: 'skip-a', now: () => today });
    await store.command('今回だけスキップ', 'update', n => skipRoutineOccurrence(n, 'running:daily', today, today));
    expect(store.outbox.every(op => op.type !== 'softDelete' && !(op.payload.node as { deletedAt?: unknown })?.deletedAt)).toBe(true);
    store = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: 'ignored' });
    expect(history(store.nodes).some(i => i.outcome === 'skipped')).toBe(true);
    await store.undo(); expect(rows(store.nodes).map(m => m.id)).toContain('running:daily');
    await store.redo(); expect(rows(store.nodes).map(m => m.id)).not.toContain('running:daily');
    expect(memo(store.nodes).routineHistory).toEqual(memo(seed()).routineHistory);
    expect(memo(store.nodes).deletedAt).toBeNull();
  });
  it('merges concurrent different dates and same-day complete/skip deterministically through revision sync', async () => {
    const server = new InMemoryRevisionServer();
    const a = await TaskMemoV2ApplicationStore.open(memory(), seed(), { deviceId: 'A', now: () => today });
    const b = await TaskMemoV2ApplicationStore.open(memory(), seed(), { deviceId: 'B', now: () => today });
    const [oa] = await a.command('スキップ', 'update', n => skipRoutineOccurrence(n, 'running:daily', today, today));
    const [ob] = await b.command('スキップ', 'update', n => skipRoutineOccurrence(n, 'running:daily', yesterday, today));
    const aa = server.apply(oa); await a.acknowledge(oa.opId, aa.record);
    const ab = server.apply(ob); await b.acknowledge(ob.opId, ab.record);
    await a.receive(server.get('running:daily')!);
    expect(history(a.nodes).filter(i => i.outcome === 'skipped')).toHaveLength(2);
    expect(history(b.nodes).filter(i => i.outcome === 'skipped')).toHaveLength(2);
    await a.undo(); // a remote change invalidates undo rather than rolling back another date
    expect(history(a.nodes).filter(i => i.outcome === 'skipped')).toHaveLength(2);
    const [oc] = await a.command('完了', 'complete', n => completeRoutineOccurrence(n, 'running:daily', yesterday, today));
    await a.acknowledge(oc.opId, server.apply(oc).record);
    expect(history(a.nodes).filter(i => i.occurrenceDate?.getDate() === 16).map(i => i.outcome)).toEqual(['completed']);
    expect(history(a.nodes).some(i => i.occurrenceDate?.getDate() === 17 && i.outcome === 'skipped')).toBe(true);
  });
  it('converges concurrent same-date states in either arrival order and ignores stale skip after cancellation', async () => {
    const stores = await Promise.all(['C', 'D'].map(deviceId => TaskMemoV2ApplicationStore.open(memory(), seed(), { deviceId, now: () => today })));
    const [skip] = await stores[0].command('スキップ', 'update', n => skipRoutineOccurrence(n, 'running:daily', today, today));
    const [done] = await stores[1].command('完了', 'complete', n => completeRoutineOccurrence(n, 'running:daily', today, today));
    const servers = [new InMemoryRevisionServer(), new InMemoryRevisionServer()];
    servers[0].apply(skip); servers[0].apply(done);
    servers[1].apply(done); servers[1].apply(skip);
    expect(servers[0].get('running:daily')!.value.routineOutcomes).toEqual(servers[1].get('running:daily')!.value.routineOutcomes);
    const cancelled = clearRoutineSkip(skipRoutineOccurrence(seed(), 'running:daily', today, today), 'running:daily', today, today);
    const stale = skipRoutineOccurrence(seed(), 'running:daily', today, today);
    expect(history(mergeNodesByUpdatedAt(cancelled, stale)).some(i => i.outcome === 'skipped')).toBe(false);
    expect(parseNodeBackup(serializeNodeBackup(cancelled))).toEqual(cancelled);
    const invalid = seed().map(n => n.type !== 'memo' ? n : { ...n, routineOutcomes: { '2026-10-17': { state: 'skipped' as const, version: -1, changedAt: today.toISOString() } } });
    expect(() => parseNodeBackup(serializeNodeBackup(invalid))).toThrow(/実施状態/);
  });
  it('an earlier same-node undo fails closed after skip undo and cannot resurrect skip on sync', async () => {
    const store = await TaskMemoV2ApplicationStore.open(memory(), seed(), { deviceId: 'undo-chain', now: () => today });
    const server = new InMemoryRevisionServer();
    const flush = async () => { for (const op of store.outbox) await store.acknowledge(op.opId, server.apply(op).record); };
    await store.command('タイトル変更', 'update', n => n.map(m => m.id === 'running:daily' ? { ...m, title: '走る' } : m)); await flush();
    await store.command('スキップ', 'update', n => skipRoutineOccurrence(n, 'running:daily', today, today)); await flush();
    await store.undo(); await flush();
    expect(await store.undo()).toEqual([]); await flush();
    expect(memo(store.nodes).title).toBe('走る');
    expect(history(store.nodes).some(i => i.outcome === 'skipped')).toBe(false);
    expect((server.get('running:daily')!.value.routineOutcomes as MemoNode['routineOutcomes'])?.['2026-10-17']?.state).toBe('pending');
  });
  it('list bulk removal emits routine updates and ordinary Task softDelete separately', async () => {
    const source = seed(), normal = { ...memo(source), id: 'task', parentId: null, repeatRule: null };
    const store = await TaskMemoV2ApplicationStore.open(memory(), [...source, normal], { deviceId: 'bulk', now: () => today });
    const ops = await store.command('選択Taskを削除', 'softDelete', nodes => [memo(nodes), normal].reduce((next, m) => removeFromDeadlineList(next, m, today), nodes));
    expect(ops.find(op => op.targetNodeId === 'running:daily')?.type).toBe('update');
    expect(ops.find(op => op.targetNodeId === 'task')?.type).toBe('softDelete');
    expect(memo(store.nodes).deletedAt).toBeNull();
  });
});
