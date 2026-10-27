import { expect, it, vi } from 'vitest';
import { memoDeadlineChoices, chooseMemoDeadline, memoDeadlineDraft } from './memoDeadline';
import { deadlineGroupForDueAt, deadlineGroupDefinitions, deadlineCreateContext, allDeadlineGroupIds } from '../domain/deadlineView';
import { formatDateTimeInput } from './dueDates';
import { IndexedDbTaskMemoApplicationJournal } from '../sync/indexedDbApplicationStorage';
import { IDBFactory } from 'fake-indexeddb';
import { TaskMemoV2ApplicationStore } from '../sync/taskMemoApplicationStore';
import { InMemoryRevisionServer } from '../sync/revisionModel';
import { updateNode } from '../domain/nodeOperations';
import { parseNodeBackup, serializeNodeBackup } from '../services/nodeBackup';
import type { MemoNode } from '../models/node';
import type { TodayGranularity } from '../domain/deadlineView';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));

it('offers next week/month/year in the Memo deadline choices', () => {
  expect(memoDeadlineChoices(new Set(allDeadlineGroupIds()), 'today', new Date(2026,9,27,8)).map(item => item.key)).toEqual(expect.arrayContaining(['nextWeek','nextMonth','nextYear']));
});

it.each([
  ['today', ['today'], [23]],
  ['amPm', ['am', 'pm'], [12, 23]],
  ['threePart', ['morning', 'day', 'evening'], [10, 17, 23]],
  ['dayNight', ['daytime', 'night'], [19, 23]],
] as const)('uses only the active %s granularity and its ON groups', (granularity, keys, hours) => {
  const now = new Date(2026, 9, 11, 8), visible = new Set(allDeadlineGroupIds());
  const todayKeys = new Set(['today','am','pm','morning','day','evening','daytime','night']);
  expect(memoDeadlineChoices(visible, granularity, now).map(c => c.key).filter(k => todayKeys.has(k))).toEqual(keys);
  keys.forEach((key, i) => {
    const chosen = chooseMemoDeadline(key, now, granularity);
    const expected = new Date(2026, 9, 11, hours[i], hours[i] === 23 ? 59 : 0);
    expect(chosen).toEqual({ preset: 'custom', custom: formatDateTimeInput(expected) });
    visible.delete(key);
    expect(memoDeadlineChoices(visible, granularity, now).some(c => c.key === key)).toBe(false);
  });
});

it.each(['today','amPm','threePart','dayNight'] as TodayGranularity[])('applies every group toggle in %s, always retaining custom', granularity => {
  const now = new Date(2026, 9, 11, 8), all = allDeadlineGroupIds();
  for (const key of all) {
    const choices = memoDeadlineChoices(new Set(all.filter(k => k !== key)), granularity, now);
    expect(choices.map(c => c.key)).not.toContain(key);
    expect(choices.at(-1)).toEqual({ key: 'custom', label: '日時指定' });
    expect(new Set(choices.map(c => c.key)).size).toBe(choices.length);
  }
  expect(memoDeadlineChoices(new Set(), granularity, now)).toEqual([{ key: 'custom', label: '日時指定' }]);
});

it('adds short-horizon/later only when ON, omits expired intervals and uses merged list labels', () => {
  const now = new Date(2026, 9, 11, 8), all = new Set(allDeadlineGroupIds());
  expect(memoDeadlineChoices(all, 'today', now).map(c => c.key)).toEqual(expect.arrayContaining(['twoThreeDays', 'later', 'none']));
  expect(memoDeadlineChoices(all, 'today', now).map(c => c.key)).not.toContain('overdue');
  expect(chooseMemoDeadline('twoThreeDays', now).custom).toBe('2026/10/14 23:59');
  expect(chooseMemoDeadline('later', now).custom).toBe('2028/01/01 23:59');
  const friday = new Date(2026, 9, 16, 8), choices = memoDeadlineChoices(all, 'today', friday);
  expect(choices.map(c => c.key)).not.toContain('twoThreeDays');
  expect(choices.map(c => c.key)).not.toContain('thisWeek');
  expect(choices.find(c => c.key === 'tomorrow')?.label).toBe('明日・今週（10/17）');
  expect(chooseMemoDeadline('tomorrow', friday).custom).toBe('2026/10/17 23:59');
});

it('does not rewrite legacy hidden presets or prevent manual dates in disabled groups', () => {
  const dueAt = new Date(2026, 9, 11, 17, 0, 12, 345), original = { duePreset: 'afternoon' as const, dueAt };
  const visible = new Set(['am' as const]), now = new Date(2026, 9, 11, 8);
  expect(memoDeadlineChoices(visible, 'amPm', now).map(c => c.key)).toEqual(['am','custom']);
  expect(memoDeadlineDraft('afternoon', formatDateTimeInput(dueAt), undefined, now, original)).toEqual(original);
  expect(memoDeadlineDraft('custom', '2030/08/14 15:12', undefined, now, original)).toEqual({ duePreset: 'custom', dueAt: new Date(2030,7,14,15,12) });
});

it.each([
  [new Date(2026, 9, 11, 8), 'nextWeek', new Date(2026, 9, 24, 23, 59)],
  [new Date(2026, 9, 17, 23, 59), 'nextWeek', new Date(2026, 9, 24, 23, 59)],
  [new Date(2026, 9, 18, 0), 'nextWeek', new Date(2026, 9, 31, 23, 59)],
  [new Date(2026, 11, 31, 23, 59), 'nextWeek', new Date(2027, 0, 9, 23, 59)],
  [new Date(2028, 0, 31, 23, 59), 'nextMonth', new Date(2028, 1, 29, 23, 59)],
  [new Date(2027, 0, 31, 23, 59), 'nextMonth', new Date(2027, 1, 28, 23, 59)],
  [new Date(2026, 11, 31, 23, 59), 'nextMonth', new Date(2027, 0, 31, 23, 59)],
  [new Date(2028, 1, 29, 23, 59), 'nextYear', new Date(2029, 11, 31, 23, 59)],
] as const)('calculates a local %s %s deadline and saves an absolute custom date', (now, choice, expected) => {
  const selected = chooseMemoDeadline(choice, now);
  expect(selected).toEqual({ preset: 'custom', custom: formatDateTimeInput(expected) });
  const draft = memoDeadlineDraft(selected.preset, selected.custom!, undefined, now);
  expect(draft).toEqual({ duePreset: 'custom', dueAt: expected });
  expect(deadlineGroupForDueAt(draft.dueAt, now)).toBe(choice);
  expect(now.getSeconds()).toBe(0);
});

it('opening an existing relative deadline, or editing only its body, preserves the exact saved date', () => {
  const dueAt = new Date(2026, 9, 31, 23, 59, 59, 999);
  const original = { duePreset: 'thisWeek' as const, dueAt };
  expect(memoDeadlineDraft('thisWeek', formatDateTimeInput(dueAt), undefined, new Date(2026, 10, 10), original)).toEqual(original);
});

it('preserves custom seconds, rejects invalid input and respects fixed quick-add contexts', () => {
  const now = new Date(2026, 9, 27, 8), dueAt = new Date(2026, 10, 30, 23, 59, 12, 345);
  expect(memoDeadlineDraft('custom', formatDateTimeInput(dueAt), undefined, now, { duePreset: 'custom', dueAt }).dueAt).toBe(dueAt);
  expect(() => memoDeadlineDraft('custom', 'invalid', undefined, now)).toThrow('日時');
  expect(memoDeadlineDraft('none', '', undefined, now)).toEqual({ duePreset: 'none', dueAt: null });
  const context = deadlineCreateContext(deadlineGroupDefinitions('today').find(g => g.id === 'thisWeek')!, now, 'today')!;
  expect(memoDeadlineDraft('thisWeek', 'invalid', context, now)).toEqual({ duePreset: 'thisWeek', dueAt: context.initialDueAt });
});

it('editable quick-add contexts use the input value rather than the current time', () => {
  const now = new Date(2026, 9, 27, 8);
  const context = deadlineCreateContext(deadlineGroupDefinitions('today').find(g => g.id === 'nextMonth')!, now, 'today')!;
  expect(memoDeadlineDraft('custom', '2026/11/30 23:59', context, now)).toEqual({ duePreset: 'custom', dueAt: new Date(2026, 10, 30, 23, 59) });
  expect(() => memoDeadlineDraft('custom', '2026/12/01 23:59', context, now)).toThrow('来月');
});

it.each(['nextWeek', 'nextMonth', 'nextYear'] as const)('keeps selected %s dates across IndexedDB restart, V2 sync and Undo/Redo', async choice => {
  const now = new Date(2026, 9, 27, 8), factory = new IDBFactory();
  const p = await IndexedDbTaskMemoApplicationJournal.open(`103-editor-${choice}`, factory);
  const memo: MemoNode = { id: 'm', type: 'memo', memoType: 'task', title: 'original', body: 'keep', parentId: null, sortKey: 'a0', dueAt: new Date(2026, 9, 31, 23, 59, 59, 999), duePreset: 'thisWeek', createdAt: now, updatedAt: now, deletedAt: null, status: 'active', completedAt: null };
  let a = await TaskMemoV2ApplicationStore.open(p, [memo], { deviceId: 'a' });
  const b = await TaskMemoV2ApplicationStore.open(await IndexedDbTaskMemoApplicationJournal.open(`103-editor-peer-${choice}`, factory), [memo], { deviceId: 'b' });
  const server = new InMemoryRevisionServer();
  const flush = async () => { for (const op of a.outbox) { const ack = server.apply(op); await a.acknowledge(op.opId, ack.record); await b.receive(ack.record!); } };
  const chosen = chooseMemoDeadline(choice, now), draft = memoDeadlineDraft(chosen.preset, chosen.custom!, undefined, now, memo);
  await a.command('editor deadline', 'update', nodes => updateNode(nodes, memo.id, draft, now)); await flush();
  expect((b.nodes[0] as MemoNode).dueAt).toEqual(draft.dueAt);
  a = await TaskMemoV2ApplicationStore.open(p, [], { deviceId: 'ignored' });
  expect((a.nodes[0] as MemoNode).dueAt).toEqual(draft.dueAt);
  expect(parseNodeBackup(serializeNodeBackup(a.nodes, now))[0]).toMatchObject(draft);
  const stored = a.nodes[0] as MemoNode;
  const depths = a.historyDepths, pending = a.outbox.length;
  expect(memoDeadlineDraft(stored.duePreset, formatDateTimeInput(stored.dueAt!), undefined, new Date(2028, 0, 1), stored)).toEqual(draft);
  expect(a.historyDepths).toEqual(depths); expect(a.outbox).toHaveLength(pending);
  await a.undo(new Date(now.getTime() + 1)); await flush(); expect((b.nodes[0] as MemoNode).dueAt).toEqual(memo.dueAt);
  await a.redo(new Date(now.getTime() + 2)); await flush(); expect((b.nodes[0] as MemoNode).dueAt).toEqual(draft.dueAt);
  expect(a.nodes[0]).toMatchObject({ title: memo.title, body: memo.body, parentId: memo.parentId, sortKey: memo.sortKey });
});
