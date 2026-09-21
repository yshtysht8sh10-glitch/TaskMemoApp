import { describe, expect, it } from 'vitest';
import type { Node } from '@/models/node';
import { categoryPath, deadlineBeforeIdForDrop, deadlineCreateContext, deadlineDisplayGroups, deadlineDraftForCreateContext, deadlineGroupDefinitions, deadlineGroupForDueAt, deadlineGroups, moveMemoInDeadlineList, updateMemoDeadline } from './deadlineView';

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
  it('通常時は明日・今週・来週の実際の期間を見出しへ表示する', () => {
    const monday = new Date(2026, 8, 14, 8);
    const labels = new Map(deadlineDisplayGroups(deadlineGroups([], monday), monday).map((group) => [group.key, group.label]));
    expect(labels.get('tomorrow')).toBe('明日（9/15）');
    expect(labels.get('thisWeek')).toBe('今週（〜9/20）');
    expect(labels.get('nextWeek')).toBe('来週（9/21〜9/27）');
  });
  it('明日が今週最終日の土曜は明日と今週を表示上だけ統合する', () => {
    const saturday = new Date(2026, 8, 19, 8);
    const tomorrowMemo = { ...base('tomorrow-memo', new Date(2026, 8, 20, 12)), duePreset: 'tomorrow' as const };
    const thisWeekMemo = { ...base('week-memo', new Date(2026, 8, 20, 23, 59)), duePreset: 'thisWeek' as const };
    const raw = deadlineGroups([tomorrowMemo, thisWeekMemo], saturday);
    const displayed = deadlineDisplayGroups(raw, saturday);
    expect(displayed.find((group) => group.key === 'tomorrow')).toMatchObject({
      label: '明日・今週（9/20）',
      memos: [{ id: 'tomorrow-memo' }, { id: 'week-memo' }],
    });
    expect(displayed.some((group) => group.key === 'thisWeek')).toBe(false);
    expect(raw.find((group) => group.key === 'tomorrow')?.memos.map((memo) => memo.id)).toEqual(['tomorrow-memo']);
    expect(raw.find((group) => group.key === 'thisWeek')?.memos.map((memo) => memo.id)).toEqual(['week-memo']);
  });
  it('月跨ぎと年跨ぎの来週範囲を省略せず表示する', () => {
    const monthBoundary = new Date(2026, 8, 24, 8);
    const yearBoundary = new Date(2026, 11, 27, 8);
    const labelFor = (current: Date) => deadlineDisplayGroups(deadlineGroups([], current), current).find((group) => group.key === 'nextWeek')?.label;
    expect(labelFor(monthBoundary)).toBe('来週（9/28〜10/4）');
    expect(labelFor(yearBoundary)).toBe('来週（2026/12/28〜2027/1/3）');
  });
  it('duePresetではなくdueAtだけで分類する', () => { const memo = { ...base('memo', new Date(2026, 8, 13, 20)), duePreset: 'morning' as const }; expect(deadlineGroups([memo], now, undefined, 'threePart').find((group) => group.memos.length)?.key).toBe('evening'); });
  it('粒度変更でNodeの期限情報を変更しない', () => { const memo = base('memo', new Date(2026, 8, 13, 18)); const original = { ...memo }; deadlineGroups([memo], now, undefined, 'today'); deadlineGroups([memo], now, undefined, 'threePart'); expect(memo).toEqual(original); });
  it('完了・削除Memoを除外し期限昇順にする', () => { const active = base('later', new Date(2026, 8, 13, 18)); const earlier = base('earlier', new Date(2026, 8, 13, 12)); const completed = { ...base('done', now), status: 'completed' as const, completedAt: now }; const deleted = { ...base('deleted', now), deletedAt: now }; expect(deadlineGroups([active, earlier, completed, deleted], now).flatMap((group) => group.memos).map((memo) => memo.id)).toEqual(['earlier', 'later']); });
  it('OFFの期限bucketに属するMemoを別bucketへ移さず非表示にする', () => { const memo = base('memo', new Date(2026, 8, 13, 11)); const original = memo.type === 'memo' ? memo.dueAt : null; const groups = deadlineGroups([memo], now, new Set(['pm']), 'amPm'); expect(groups.flatMap((group) => group.memos)).toEqual([]); expect(memo.type === 'memo' && memo.dueAt).toBe(original); });
  it('Routineは発生日当日だけ今日系bucketへ入り未来bucketへ先出ししない', () => { const routine = { id: 'routine-root', type: 'category', categoryKind: 'routineRoot', parentId: null, sortKey: 'a', title: 'ルーティーン', createdAt: now, updatedAt: now, deletedAt: null } as const; const task = { ...base('routine', new Date(2030, 0, 1), 'routine-root'), repeatRule: { frequency: 'week' as const, interval: 1, startsOn: '2026-09-15' } }; const monday = new Date(2026, 8, 14, 8); const tuesday = new Date(2026, 8, 15, 8); expect(deadlineGroups([routine, task], monday).flatMap((group) => group.memos)).toEqual([]); expect(deadlineGroups([routine, task], tuesday, new Set(['today']), 'today').find((group) => group.key === 'today')?.memos.map((memo) => memo.id)).toEqual(['routine']); expect(deadlineGroups([routine, task], tuesday, new Set(['tomorrow']), 'today').flatMap((group) => group.memos)).toEqual([]); expect(task.type === 'memo' && task.dueAt).toEqual(new Date(2030, 0, 1)); });
  it.each([['today', 'today'], ['dayNight', 'night'], ['amPm', 'pm'], ['threePart', 'evening']] as const)('Routine当日分は%sの共通今日系判定で%sへ入る', (granularity, expected) => { const routine = { id: 'r', type: 'category', categoryKind: 'routineRoot', parentId: null, sortKey: 'a', title: 'ルーティーン', createdAt: now, updatedAt: now, deletedAt: null } as const; const task = { ...base('m', null, 'r'), repeatRule: { frequency: 'day' as const, interval: 1, startsOn: '2026-09-13' } }; expect(deadlineGroups([routine, task], now, undefined, granularity).find((group) => group.memos.length)?.key).toBe(expected); });
  it('各グループのクイック追加とdropが同じ定義を使う', () => { const definition = deadlineGroupDefinitions('threePart').find((group) => group.id === 'morning')!; const context = deadlineCreateContext(definition, now, 'threePart')!; expect(deadlineGroupForDueAt(context.initialDueAt, now, 'threePart')).toBe('morning'); const moved = updateMemoDeadline([base('memo', null)], 'memo', 'morning', now, 'threePart'); expect(moved[0].type === 'memo' && moved[0].dueAt).toEqual(context.initialDueAt); });
  it.each([
    new Date(2026, 8, 14, 8),
    new Date(2026, 8, 17, 8),
    new Date(2026, 8, 19, 8),
    new Date(2026, 8, 20, 8),
    new Date(2026, 11, 31, 8),
  ])('今週から追加したMemoを曜日や年末にかかわらず今週へ表示する (%s)', (current) => {
    const definition = deadlineGroupDefinitions('amPm').find((group) => group.id === 'thisWeek')!;
    const context = deadlineCreateContext(definition, current, 'amPm')!;
    const draft = deadlineDraftForCreateContext(context, undefined, current);
    const created = { ...base('created', draft.dueAt), duePreset: draft.duePreset };
    const groups = deadlineGroups([created], current, undefined, 'amPm');

    expect(created.type === 'memo' && created.duePreset).toBe('thisWeek');
    expect(groups.find((group) => group.key === 'thisWeek')?.memos.map((memo) => memo.id)).toEqual(['created']);
  });
  it('それ以降の追加だけ期限編集を要求し同じbucketで検証する', () => { const definition = deadlineGroupDefinitions('today').find((group) => group.id === 'later')!; const context = deadlineCreateContext(definition, now, 'today')!; expect(deadlineDraftForCreateContext(context, new Date(2027, 0, 2), now).duePreset).toBe('custom'); expect(() => deadlineDraftForCreateContext(context, new Date(2026, 11, 31), now)).toThrow(/それ以降/); });
  it('グループ間移動で期限と順序を更新する', () => { const a = base('a', new Date(2026, 8, 13, 11)); const b = base('b', new Date(2026, 8, 14, 18)); const moved = moveMemoInDeadlineList([a, b], 'b', 'am', 'a', now, 'amPm'); expect(deadlineGroups(moved, now, undefined, 'amPm').find((group) => group.key === 'am')?.memos.map((memo) => memo.id)).toEqual(['b', 'a']); });
  it('期限グループ最後のMemo下端へのdropをグループ末尾として解決する', () => {
    const a = base('a', new Date(2026, 11, 31, 12));
    const toeic = base('toeic', new Date(2026, 11, 31, 12));
    const moving = base('moving', new Date(2026, 8, 30, 12));
    const groups = deadlineGroups([a, toeic, moving], now, undefined, 'amPm');
    const beforeId = deadlineBeforeIdForDrop(groups, 'thisYear', 'moving', 'toeic', 'after');
    const moved = moveMemoInDeadlineList([a, toeic, moving], 'moving', 'thisYear', beforeId, now, 'amPm');
    expect(deadlineGroups(moved, now, undefined, 'amPm').find((group) => group.key === 'thisYear')?.memos.map((memo) => memo.id)).toEqual(['a', 'toeic', 'moving']);
  });
  it('所属Categoryパスをcycle安全に構築する', () => { const root: Node = { id: 'a', type: 'category', parentId: null, sortKey: 'a', title: '個人', createdAt: now, updatedAt: now, deletedAt: null }; expect(categoryPath([{ ...root, parentId: 'a' }], 'a')).toBe('… > 個人'); });
});
