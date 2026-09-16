import { describe, expect, it } from 'vitest';
import type { Node } from '@/models/node';
import { categoryPath, deadlineCreateContext, deadlineDraftForCreateContext, deadlineGroupDefinitions, deadlineGroupForDueAt, deadlineGroups, moveMemoInDeadlineList, updateMemoDeadline } from './deadlineView';

const now = new Date(2026, 8, 13, 8);
const base = (id: string, dueAt: Date | null, parentId: string | null = null): Node => ({ id, type: 'memo', parentId, sortKey: id, title: id, body: '', dueAt, duePreset: dueAt ? 'custom' : 'none', status: 'active', completedAt: null, createdAt: now, updatedAt: now, deletedAt: null });

describe('deadline view', () => {
  it('今日を細分化した見出しに今日と区切り時刻を表示する', () => {
    expect(deadlineGroupDefinitions('dayNight').filter((group) => ['daytime', 'night'].includes(group.id)).map((group) => group.label)).toEqual(['今日-昼間（～19:00）', '今日-夜（～24:00）']);
    expect(deadlineGroupDefinitions('amPm').filter((group) => ['am', 'pm'].includes(group.id)).map((group) => group.label)).toEqual(['今日-午前（～12:00）', '今日-午後（～24:00）']);
    expect(deadlineGroupDefinitions('threePart').filter((group) => ['morning', 'day', 'evening'].includes(group.id)).map((group) => group.label)).toEqual(['今日-朝（～10:00）', '今日-昼（～17:00）', '今日-夜（～24:00）']);
  });
  it.each([
    ['today', 9, 'today'], ['dayNight', 18, 'daytime'], ['dayNight', 20, 'night'],
    ['amPm', 12, 'am'], ['amPm', 12.01, 'pm'], ['threePart', 10, 'morning'],
    ['threePart', 10.01, 'day'], ['threePart', 17, 'day'], ['threePart', 17.01, 'evening'],
  ] as const)('%s粒度で今日%時を%sに分類する', (granularity, decimalHour, expected) => { const hour = Math.floor(decimalHour); const minute = Math.round((decimalHour - hour) * 60); expect(deadlineGroupForDueAt(new Date(2026, 8, 13, hour, minute), now, granularity)).toBe(expected); });
  it('今日以外を2〜3日・今週・来週を含むフラットな時間軸へ分類する', () => { expect(deadlineGroupForDueAt(new Date(2026, 8, 14, 12), now)).toBe('tomorrow'); expect(deadlineGroupForDueAt(new Date(2026, 8, 15, 12), now)).toBe('twoThreeDays'); expect(deadlineGroupForDueAt(new Date(2026, 8, 20, 12), now)).toBe('nextWeek'); });
  it('duePresetではなくdueAtだけで分類する', () => { const memo = { ...base('memo', new Date(2026, 8, 13, 20)), duePreset: 'morning' as const }; expect(deadlineGroups([memo], now, undefined, 'threePart').find((group) => group.memos.length)?.key).toBe('evening'); });
  it('粒度変更でNodeの期限情報を変更しない', () => { const memo = base('memo', new Date(2026, 8, 13, 18)); const original = { ...memo }; deadlineGroups([memo], now, undefined, 'today'); deadlineGroups([memo], now, undefined, 'threePart'); expect(memo).toEqual(original); });
  it('完了・削除Memoを除外し期限昇順にする', () => { const active = base('later', new Date(2026, 8, 13, 18)); const earlier = base('earlier', new Date(2026, 8, 13, 12)); const completed = { ...base('done', now), status: 'completed' as const, completedAt: now }; const deleted = { ...base('deleted', now), deletedAt: now }; expect(deadlineGroups([active, earlier, completed, deleted], now).flatMap((group) => group.memos).map((memo) => memo.id)).toEqual(['earlier', 'later']); });
  it('OFFの期限bucketに属するMemoを別bucketへ移さず非表示にする', () => { const memo = base('memo', new Date(2026, 8, 13, 11)); const original = memo.type === 'memo' ? memo.dueAt : null; const groups = deadlineGroups([memo], now, new Set(['pm']), 'amPm'); expect(groups.flatMap((group) => group.memos)).toEqual([]); expect(memo.type === 'memo' && memo.dueAt).toBe(original); });
  it('毎週Routineの次回発生日を通常の期限bucketへ分類し表示設定に従う', () => { const weekly = { id: 'weekly', type: 'category', categoryKind: 'routineWeekly', routineWeekday: 2, parentId: null, sortKey: 'a', title: '毎週', createdAt: now, updatedAt: now, deletedAt: null } as const; const task = base('routine', new Date(2030, 0, 1), 'weekly'); const monday = new Date(2026, 8, 14, 8); expect(deadlineGroups([weekly, task], monday, new Set(['tomorrow']), 'today').find((group) => group.key === 'tomorrow')?.memos.map((memo) => memo.id)).toEqual(['routine']); expect(deadlineGroups([weekly, task], monday, new Set(['thisWeek']), 'today').flatMap((group) => group.memos)).toEqual([]); expect(task.type === 'memo' && task.dueAt).toEqual(new Date(2030, 0, 1)); });
  it('各グループのクイック追加とdropが同じ定義を使う', () => { const definition = deadlineGroupDefinitions('threePart').find((group) => group.id === 'morning')!; const context = deadlineCreateContext(definition, now, 'threePart')!; expect(deadlineGroupForDueAt(context.initialDueAt, now, 'threePart')).toBe('morning'); const moved = updateMemoDeadline([base('memo', null)], 'memo', 'morning', now, 'threePart'); expect(moved[0].type === 'memo' && moved[0].dueAt).toEqual(context.initialDueAt); });
  it('それ以降の追加だけ期限編集を要求し同じbucketで検証する', () => { const definition = deadlineGroupDefinitions('today').find((group) => group.id === 'later')!; const context = deadlineCreateContext(definition, now, 'today')!; expect(deadlineDraftForCreateContext(context, new Date(2027, 0, 2), now).duePreset).toBe('custom'); expect(() => deadlineDraftForCreateContext(context, new Date(2026, 11, 31), now)).toThrow(/それ以降/); });
  it('グループ間移動で期限と順序を更新する', () => { const a = base('a', new Date(2026, 8, 13, 11)); const b = base('b', new Date(2026, 8, 14, 18)); const moved = moveMemoInDeadlineList([a, b], 'b', 'am', 'a', now, 'amPm'); expect(deadlineGroups(moved, now, undefined, 'amPm').find((group) => group.key === 'am')?.memos.map((memo) => memo.id)).toEqual(['b', 'a']); });
  it('所属Categoryパスをcycle安全に構築する', () => { const root: Node = { id: 'a', type: 'category', parentId: null, sortKey: 'a', title: '個人', createdAt: now, updatedAt: now, deletedAt: null }; expect(categoryPath([{ ...root, parentId: 'a' }], 'a')).toBe('… > 個人'); });
});
