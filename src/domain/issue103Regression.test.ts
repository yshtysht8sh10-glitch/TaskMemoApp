import { expect, it, vi } from 'vitest';
import type { MemoNode } from '../models/node';
import { allDeadlineGroupIds, deadlineGroupForDueAt, deadlineGroups, deadlineDisplayGroups, deadlineCreateContext, deadlineGroupDefinitions, moveMemoInDeadlineList, hiddenDeadlineSummary } from './deadlineView';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTaskMemoApplicationJournal } from '../sync/indexedDbApplicationStorage';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import { InMemoryRevisionServer } from '../sync/revisionModel';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
const now = new Date(2026, 9, 27, 8);
const memo = (id: string, dueAt: Date): MemoNode => ({ id, type: 'memo', memoType: 'task', parentId: null, sortKey: 'a0', title: id, body: '', duePreset: 'custom', dueAt, createdAt: now, updatedAt: now, deletedAt: null, status: 'active', completedAt: null });

it('classifies next calendar month/year without overlapping the remaining year or later', () => {
  expect(deadlineGroupForDueAt(new Date(2026, 10, 30, 23, 59), now)).toBe('nextMonth');
  expect(deadlineGroupForDueAt(new Date(2026, 11, 1), now)).toBe('thisYear');
  expect(deadlineGroupForDueAt(new Date(2027, 11, 31, 23, 59), now)).toBe('nextYear');
  expect(deadlineGroupForDueAt(new Date(2028, 0, 1), now)).toBe('later');
});

it('keeps December nextMonth separate, skips shorter OFF fallbacks, and displays each memo once', () => {
  const december = new Date(2026, 11, 15, 8);
  const nodes = [memo('jan', new Date(2027, 0, 20)), memo('feb', new Date(2027, 1, 1)), memo('later', new Date(2028, 0, 1))];
  expect(deadlineGroupForDueAt(nodes[0].dueAt, december)).toBe('nextMonth');
  const visible = new Set(allDeadlineGroupIds().filter(id => id !== 'nextMonth'));
  const groups = deadlineGroups(nodes, december, visible);
  expect(groups.find(g => g.key === 'nextYear')?.memos.map(n => n.id)).toEqual(['jan', 'feb']);
  const displayed = deadlineDisplayGroups(groups, december);
  expect(displayed.flatMap(g => g.memos).map(n => n.id).sort()).toEqual(['feb', 'jan', 'later']);
});

it.each([
  [new Date(2028, 0, 31), 'nextMonth', new Date(2028, 1, 29, 23, 59)],
  [now, 'nextYear', new Date(2027, 11, 31, 23, 59)],
  [now, 'later', new Date(2028, 0, 1, 23, 59)],
] as const)('uses approved local-time confirmation candidates %s %s', (date, key, expected) => {
  const definition = deadlineGroupDefinitions('today').find(g => g.id === key)!;
  expect(deadlineCreateContext(definition, date, 'today')).toMatchObject({ initialDueAt: expected, dueEditable: true });
});

it('requires confirmation before changing a deadline, and preserves source on cancel/no-op', () => {
  const nodes = [memo('m', new Date(2026, 11, 15))], original = structuredClone(nodes);
  expect(moveMemoInDeadlineList(nodes, 'm', 'nextMonth', undefined, now)).toBe(nodes);
  const changed = moveMemoInDeadlineList(nodes, 'm', 'nextMonth', undefined, now, 'today', new Date(2026, 10, 30, 23, 59));
  expect(changed.find(n => n.id === 'm')).toMatchObject({ dueAt: new Date(2026, 10, 30, 23, 59) });
  expect(nodes).toEqual(original);
});

it('reorders a hidden nextMonth memo inside the displayed fallback without rewriting its dueAt', () => {
  const nodes = [memo('nov', new Date(2026, 10, 20)), memo('dec', new Date(2026, 11, 20))];
  const visible = new Set(allDeadlineGroupIds().filter(id => id !== 'nextMonth'));
  const moved = moveMemoInDeadlineList(nodes, 'nov', 'thisYear', undefined, now, 'today', undefined, visible);
  expect(deadlineGroups(moved, now, visible).find(g => g.key === 'thisYear')?.memos.map(n => n.id)).toEqual(['dec', 'nov']);
  expect((moved.find(n => n.id === 'nov') as MemoNode).dueAt).toEqual(nodes[0].dueAt);
});

it.each([new Date(2026, 9, 31, 23, 59), new Date(2026, 11, 31, 23, 59), new Date(2028, 0, 31, 23, 59), new Date(2028, 1, 29, 23, 59)])('never duplicates or rewrites dates for all ON/OFF combinations at %s', date => {
  const nodes = Array.from({ length: 850 }, (_, day) => memo(String(day), new Date(date.getFullYear(), date.getMonth(), date.getDate() + day, 23, 59, 59, 999)));
  const original = structuredClone(nodes);
  const toggles = ['nextMonth', 'thisYear', 'nextYear', 'later'];
  for (let mask = 0; mask < 16; mask++) {
    const visible = new Set(allDeadlineGroupIds().filter(id => !toggles.includes(id) || !!(mask & (1 << toggles.indexOf(id)))));
    const raw = deadlineGroups(nodes, date, visible), display = deadlineDisplayGroups(raw, date);
    const shown = display.flatMap(g => g.memos);
    expect(new Set(shown.map(n => n.id)).size).toBe(shown.length);
    expect(shown.length + hiddenDeadlineSummary(nodes, date, visible).total).toBe(nodes.length);
  }
  expect(nodes).toEqual(original);
});

it('classifies exactly at local month/year midnight and keeps nearer week buckets primary', () => {
  const date = new Date(2026, 9, 27, 8), midnight = new Date(2026, 11, 1);
  expect(deadlineGroupForDueAt(new Date(midnight.getTime() - 1), date)).toBe('nextMonth');
  expect(deadlineGroupForDueAt(midnight, date)).toBe('thisYear');
  const year = new Date(2028, 0, 1);
  expect(deadlineGroupForDueAt(new Date(year.getTime() - 1), date)).toBe('nextYear');
  expect(deadlineGroupForDueAt(year, date)).toBe('later');
  expect(deadlineGroupForDueAt(new Date(2027, 0, 2, 12), new Date(2026, 11, 27, 8))).toBe('thisWeek');
});

it.each(['nextMonth', 'nextYear'] as const)('persists confirmed %s drops through IndexedDB, sync and Undo/Redo', async group => {
  const factory = new IDBFactory(), p = await IndexedDbTaskMemoApplicationJournal.open(`103-${group}`, factory);
  const source = [{ ...memo('m', new Date(2026, 11, 20)), routineHistory: { '2026-10-01': now.toISOString() } }];
  let a = await TaskMemoV2ApplicationStore.open(p, source, { deviceId: 'a' });
  const b = await TaskMemoV2ApplicationStore.open(await IndexedDbTaskMemoApplicationJournal.open(`103-peer-${group}`, factory), source, { deviceId: 'b' });
  const server = new InMemoryRevisionServer();
  const flush = async () => { for (const op of a.outbox) { const ack = server.apply(op); await a.acknowledge(op.opId, ack.record); await b.receive(ack.record!); } };
  const due = deadlineCreateContext(deadlineGroupDefinitions('today').find(g => g.id === group)!, now)!.initialDueAt!;
  await a.command('drop', 'update', nodes => moveMemoInDeadlineList(nodes, 'm', group, undefined, now, 'today', due)); await flush();
  expect((b.nodes[0] as MemoNode).dueAt).toEqual(due);
  a = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'ignored' });
  expect((a.nodes[0] as MemoNode).dueAt).toEqual(due);
  await a.undo(new Date(now.getTime() + 1)); await flush(); expect((b.nodes[0] as MemoNode).dueAt).toEqual(source[0].dueAt);
  await a.redo(new Date(now.getTime() + 2)); await flush(); expect((b.nodes[0] as MemoNode).dueAt).toEqual(due);
  expect((b.nodes[0] as MemoNode).routineHistory).toEqual(source[0].routineHistory);
});

it('uses the occurrence date rather than the Routine template date and does not change its history', () => {
  const root = { id: 'r', type: 'category' as const, categoryKind: 'routineRoot' as const, parentId: null, sortKey: 'a0', title: 'r', createdAt: now, updatedAt: now, deletedAt: null };
  const routine = { ...memo('r-memo', new Date(2027, 10, 1, 10)), parentId: 'r', repeatRule: { frequency: 'day' as const, interval: 1, startsOn: '2026-10-27' }, routineHistory: { '2026-10-26': now.toISOString() } };
  const nodes = [root, routine], original = structuredClone(nodes);
  expect(deadlineGroups(nodes, now).find(g => g.key === 'am')?.memos.map(n => n.id)).toEqual(['r-memo']);
  const due = new Date(2026, 10, 30, 23, 59);
  expect(moveMemoInDeadlineList(nodes, routine.id, 'nextMonth', undefined, now, 'amPm', due)).toBe(nodes);
  expect(nodes).toEqual(original);
});
