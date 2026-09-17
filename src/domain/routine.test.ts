import { describe, expect, it } from 'vitest';
import type { CategoryNode, MemoNode, Node, RepeatRule } from '@/models/node';
import { completeMemo, ensureRoutineCategories, moveNode, restoreMemo } from './nodeOperations';
import { isRoutineDueOn, localDateKey, repeatRuleLabel, routineCategoryForMemo, routineHistoryDays, routineOccurrenceDueAt } from './routine';

const now = new Date(2026, 8, 16, 10);
const root = (): CategoryNode => ({ id: 'routine', type: 'category', categoryKind: 'routineRoot', parentId: null, sortKey: 'a', title: 'ルーティーン', createdAt: now, updatedAt: now, deletedAt: null });
const memo = (rule: RepeatRule | null, parentId = 'routine'): MemoNode => ({ id: 'm', type: 'memo', parentId, sortKey: 'm', title: 'm', body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, repeatRule: rule, createdAt: now, updatedAt: now, deletedAt: null });

describe('routine', () => {
  it('日付境界の直前には発生せず、開始日の0時以降に発生する', () => {
    const task = memo({ frequency: 'day', interval: 1, startsOn: '2026-09-17' });
    const nodes = [root(), task];
    expect(routineOccurrenceDueAt(nodes, task, new Date(2026, 8, 16, 23, 59, 59, 999))).toBeNull();
    expect(routineOccurrenceDueAt(nodes, task, new Date(2026, 8, 17, 0, 0, 0, 0))).toEqual(new Date(2026, 8, 17, 23, 59, 59, 999));
  });
  it('特殊Categoryはルーティーンだけを重複なく作成する', () => { const created = ensureRoutineCategories([], now); expect(created.map((node) => node.type === 'category' && node.categoryKind)).toEqual(['routineRoot']); expect(ensureRoutineCategories(created, now)).toBe(created); });
  it('既存データには固定IDのルーティーンだけを一度補う', () => { const seeded = ensureRoutineCategories([], now); expect(seeded.map((node) => node.id)).toEqual(['system-routine']); expect(ensureRoutineCategories(seeded, now)).toBe(seeded); });
  it('過去に削除されたルーティーンも常設Categoryとして復元する', () => { const seeded = ensureRoutineCategories([], now); const deleted = seeded.map((node) => ({ ...node, deletedAt: now, purgedAt: now })); expect(ensureRoutineCategories(deleted, new Date(now.getTime() + 1))[0]).toMatchObject({ title: 'ルーティーン', parentId: null, deletedAt: null, purgedAt: null }); });
  it('直下MemoだけをRoutineと判定し、未設定ruleは発生させない', () => { const nested: CategoryNode = { ...root(), id: 'nested', categoryKind: undefined, parentId: 'routine' }; const nodes: Node[] = [root(), nested, memo(null), { ...memo({ frequency: 'day', interval: 1, startsOn: '2026-09-16' }, 'nested'), id: 'nested-m' }]; expect(routineCategoryForMemo(nodes, nodes[2] as MemoNode)).toBeTruthy(); expect(routineCategoryForMemo(nodes, nodes[3] as MemoNode)).toBeNull(); expect(routineOccurrenceDueAt(nodes, nodes[2] as MemoNode, now)).toBeNull(); });
  it.each([
    ['毎日', { frequency: 'day', interval: 1, startsOn: '2026-09-16' }, new Date(2026, 8, 16), new Date(2026, 8, 15)],
    ['2日おき', { frequency: 'day', interval: 2, startsOn: '2026-09-15' }, new Date(2026, 8, 17), new Date(2026, 8, 16)],
    ['隔週', { frequency: 'week', interval: 2, startsOn: '2026-09-14' }, new Date(2026, 8, 28), new Date(2026, 8, 21)],
    ['毎月', { frequency: 'month', interval: 1, startsOn: '2026-01-31' }, new Date(2026, 3, 30), new Date(2026, 3, 29)],
    ['毎年', { frequency: 'year', interval: 1, startsOn: '2024-02-29' }, new Date(2026, 1, 28), new Date(2026, 2, 1)],
  ] as const)('%sは発生日当日だけOccurrenceを返す', (_label, rule, dueDate, otherDate) => { const task = memo(rule); const nodes = [root(), task]; expect(routineOccurrenceDueAt(nodes, task, dueDate)).toEqual(new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate(), 23, 59, 59, 999)); expect(routineOccurrenceDueAt(nodes, task, otherDate)).toBeNull(); expect(isRoutineDueOn(nodes, task, dueDate)).toBe(true); });
  it('当回完了後は未来分を先出しせず、取消で同じ当回が復活する', () => { const source: Node[] = [root(), memo({ frequency: 'day', interval: 1, startsOn: '2026-09-16' })]; const done = completeMemo(source, 'm', now); const doneMemo = done[1] as MemoNode; expect(done).toHaveLength(source.length); expect(doneMemo.routineHistory?.[localDateKey(now)]).toBeTruthy(); expect(doneMemo.status).toBe('active'); expect(routineOccurrenceDueAt(done, doneMemo, now)).toBeNull(); expect(routineOccurrenceDueAt(done, doneMemo, new Date(2026, 8, 17, 10))).toEqual(new Date(2026, 8, 17, 23, 59, 59, 999)); const restored = restoreMemo(done, 'm', now); expect(routineOccurrenceDueAt(restored, restored[1] as MemoNode, now)).toEqual(new Date(2026, 8, 16, 23, 59, 59, 999)); expect((restored[1] as MemoNode).routineHistory).toEqual({ '2026-09-16': null }); });
  it('過去の完了履歴を保持したまま次の発生日を当日だけ表示する', () => { const yesterday = new Date(2026, 8, 15, 10); const task = { ...memo({ frequency: 'day', interval: 1, startsOn: '2026-09-15' }), routineHistory: { [localDateKey(yesterday)]: yesterday.toISOString() } }; const nodes = [root(), task]; expect(routineOccurrenceDueAt(nodes, task, now)).toEqual(new Date(2026, 8, 16, 23, 59, 59, 999)); expect(routineHistoryDays(task, now, 2).map((day) => day.completed)).toEqual([false, true]); });
  it('通常Categoryから移動しただけではruleを設定せず履歴を保持する', () => { const normal: CategoryNode = { ...root(), id: 'normal', categoryKind: undefined }; const source = [root(), normal, { ...memo({ frequency: 'day', interval: 1, startsOn: '2026-09-16' }, 'normal'), routineHistory: { [localDateKey(now)]: now.toISOString() } }]; const moved = moveNode(source, 'm', 'routine'); expect(moved[2]).toMatchObject({ repeatRule: null, routineHistory: (source[2] as MemoNode).routineHistory }); });
  it('旧周期Categoryをruleへ移行してtombstone化する', () => { const daily: CategoryNode = { ...root(), id: 'daily', categoryKind: 'routineDaily', parentId: 'routine' }; const migrated = ensureRoutineCategories([root(), daily, memo(null, 'daily')], now); expect(migrated.find((node) => node.id === 'daily')).toMatchObject({ purgedAt: now }); expect(migrated.find((node) => node.id === 'm')).toMatchObject({ parentId: 'routine', repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-09-16' } }); });
  it('表示名は固定値ではなくfrequencyとintervalから作る', () => { expect(repeatRuleLabel({ frequency: 'week', interval: 2, startsOn: '2026-09-16' })).toBe('2週間おき'); });
});
