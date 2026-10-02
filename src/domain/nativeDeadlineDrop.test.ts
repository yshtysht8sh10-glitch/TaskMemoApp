import { describe, expect, it } from 'vitest';
import type { MemoNode } from '@/models/node';
import { deadlineDisplayGroups, deadlineGroups, moveMemoInDeadlineList } from './deadlineView';
import { beforeIdForInsertion } from './insertionPosition';
import { nativeDeadlineGroupForPlaceholder, nativeDeadlineInsertion } from './nativeDeadlineDrop';

const now = new Date(2026, 8, 16, 8);
const memo = (id: string, dueAt: Date | null): MemoNode => ({
  id, type: 'memo', parentId: null, sortKey: 'a0', title: id, body: '',
  dueAt, duePreset: dueAt ? 'custom' : 'none', status: 'active',
  completedAt: null, createdAt: now, updatedAt: now, deletedAt: null,
});
const source = [memo('moving', new Date(2026, 8, 16, 11)),
  memo('first', new Date(2026, 8, 17, 10)), memo('last', new Date(2026, 8, 17, 18))];
const groups = deadlineGroups(source, now);
const active = { id: 'moving', sourceGroup: 'am' as const };

describe('Native deadline drop policy', () => {
  it('見出し・memo・入力行と隣接bucket境界を元の表示行のgroupKeyで判定する', () => {
    const rows = [
      { kind: 'heading', groupKey: 'am' as const },
      { kind: 'memo', groupKey: 'am' as const },
      { kind: 'heading', groupKey: 'tomorrow' as const },
      { kind: 'memo', groupKey: 'tomorrow' as const },
      { kind: 'quickAdd', groupKey: 'tomorrow' as const },
      { kind: 'heading', groupKey: 'none' as const },
    ];
    expect(rows.map((_, index) => nativeDeadlineGroupForPlaceholder(rows, index, groups)))
      .toEqual(['am', 'am', 'tomorrow', 'tomorrow', 'tomorrow', 'none']);
    expect(nativeDeadlineGroupForPlaceholder(rows, -1, groups)).toBeNull();
    expect(nativeDeadlineGroupForPlaceholder(rows, rows.length, groups)).toBeNull();
  });

  it('期限切れ・日時入力が必要なbucket・非表示bucketを移動先にしない', () => {
    for (const groupKey of ['overdue', 'later', 'daytime'] as const) {
      expect(nativeDeadlineGroupForPlaceholder([{ groupKey }], 0, groups)).toBeNull();
    }
  });

  it('表示上統合されたbucketでもmemo行の元bucketを使う', () => {
    const sunday = new Date(2026, 8, 13, 8);
    const original = deadlineGroups([], sunday);
    const displayed = deadlineDisplayGroups(original, sunday);
    expect(displayed.some((group) => group.key === 'thisWeek')).toBe(false);
    expect(nativeDeadlineGroupForPlaceholder([{ groupKey: 'thisWeek' }], 0, original)).toBe('thisWeek');
  });

  it('同一bucket・移動元なし・候補なしでは挿入を生成しない', () => {
    expect(nativeDeadlineInsertion(active, 'am')).toBeNull();
    expect(nativeDeadlineInsertion(null, 'tomorrow')).toBeNull();
    expect(nativeDeadlineInsertion(active, null)).toBeNull();
  });

  it.each(['first', 'last', 'heading'])('別bucketの%s付近へdropしても共通appendで末尾に置く', (row) => {
    const rows = [{ id: row, groupKey: 'tomorrow' as const }];
    const groupKey = nativeDeadlineGroupForPlaceholder(rows, 0, groups);
    const insertion = nativeDeadlineInsertion(active, groupKey)!;
    expect(insertion).toEqual({ id: 'moving', groupKey: 'tomorrow', position: { kind: 'append' } });
    const beforeId = beforeIdForInsertion(groups.find((group) => group.key === groupKey)!.memos.map((item) => item.id), insertion.id, insertion.position);
    expect(beforeId).toBeUndefined();
    const moved = moveMemoInDeadlineList(source, insertion.id, insertion.groupKey, beforeId, now);
    const ordered = deadlineGroups(moved, now).find((group) => group.key === 'tomorrow')!.memos;
    expect(ordered.map((item) => item.id)).toEqual(['first', 'last', 'moving']);
    expect(ordered.every((item) => item.deadlineSortKey)).toBe(true);
    expect(ordered[2].deadlineSortKey! > ordered[1].deadlineSortKey!).toBe(true);
    expect(ordered[2].duePreset).toBe('tomorrow');
    expect(ordered[2].parentId).toBe(source[0].parentId);
    expect(ordered[2].sortKey).toBe(source[0].sortKey);
  });

  it('空の期限なしbucketへappendすると期限がなくなる', () => {
    const insertion = nativeDeadlineInsertion(active, 'none')!;
    const moved = moveMemoInDeadlineList(source, insertion.id, insertion.groupKey,
      beforeIdForInsertion([], insertion.id, insertion.position), now);
    const target = deadlineGroups(moved, now).find((group) => group.key === 'none')!.memos;
    expect(target.map((item) => item.id)).toEqual(['moving']);
    expect(target[0].dueAt).toBeNull();
    expect(target[0].deadlineSortKey).toBeTruthy();
  });
});
