import { describe, expect, it } from 'vitest';
import type { Node } from '../models/node';
import { flattenVisibleNodes, UNASSIGNED_GROUP_ID, visibleAncestorGuides, visibleDescendantNodeCount, visibleUnassignedMemoCount } from './treeView';

const now = new Date('2026-09-13T00:00:00Z');
const category = (id: string, parentId: string | null, sortKey: string): Node => ({ id, type: 'category', parentId, sortKey, title: id, createdAt: now, updatedAt: now, deletedAt: null });
const memo = (id: string, parentId: string | null, sortKey: string): Node => ({ id, type: 'memo', parentId, sortKey, title: id, body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, createdAt: now, updatedAt: now, deletedAt: null });

describe('tree row layout metadata', () => {
  it('同depthのCategoryとMemoへ同じdepthを割り当てる', () => { const rows = flattenVisibleNodes([category('a', null, 'a0'), category('b', 'a', 'a0'), memo('m', 'a', 'a1')], new Set(['a'])); expect(rows.filter((row) => row.node.id === 'b' || row.node.id === 'm').map((row) => row.depth)).toEqual([1, 1]); });
  it('途中の兄弟を├、最後を└にする情報を付ける', () => { const rows = flattenVisibleNodes([category('a', null, 'a0'), category('b', 'a', 'a0'), memo('m', 'a', 'a1')], new Set(['a'])); expect(rows.find((row) => row.node.id === 'b')?.hasNextSibling).toBe(true); expect(rows.find((row) => row.node.id === 'm')?.hasNextSibling).toBe(false); });
  it('祖先に後続兄弟がある場合は子孫まで継続線を渡す', () => { const rows = flattenVisibleNodes([category('a', null, 'a0'), category('z', null, 'a1'), category('b', 'a', 'a0'), memo('m', 'b', 'a0')], new Set(['a', 'b'])); expect(rows.find((row) => row.node.id === 'm')?.ancestorContinuation).toEqual([true, false]); });
  it('CategoryとMemoが混在しても各祖先の継続線を末尾の子まで保持する', () => { const rows = flattenVisibleNodes([category('a', null, 'a0'), category('z', null, 'a1'), memo('first', 'a', 'a0'), category('b', 'a', 'a1'), memo('deep', 'b', 'a0'), memo('last', 'a', 'a2')], new Set(['a', 'b'])); expect(rows.find((row) => row.node.id === 'first')).toMatchObject({ ancestorContinuation: [true], hasNextSibling: true }); expect(rows.find((row) => row.node.id === 'deep')).toMatchObject({ ancestorContinuation: [true, true], hasNextSibling: false }); expect(rows.find((row) => row.node.id === 'last')).toMatchObject({ ancestorContinuation: [true], hasNextSibling: false }); });
  it('ルートが末尾でも後続兄弟を持つ親Categoryの継続線を最初のガイド列へ描く', () => { expect(visibleAncestorGuides(2, [false, true], 5)).toEqual([true]); expect(visibleAncestorGuides(3, [false, true, false], 5)).toEqual([true, false]); });
  it('最大表示depthを超えた場合も可視範囲の祖先線を一段ずらさない', () => { expect(visibleAncestorGuides(7, [false, false, true, false, true, true, false], 5)).toEqual([false, true, true, false]); });
  it('開閉で子を除外しても兄弟情報を維持する', () => { const nodes = [category('a', null, 'a0'), category('b', 'a', 'a0'), memo('m', 'a', 'a1')]; expect(flattenVisibleNodes(nodes, new Set()).map((row) => row.node.id)).toEqual([UNASSIGNED_GROUP_ID, 'a']); expect(flattenVisibleNodes(nodes, new Set(['a'])).map((row) => row.node.id)).toEqual([UNASSIGNED_GROUP_ID, 'a', 'b', 'm']); });
  it('完了済みroot Memoも元のsortKey位置で無所属配下に置く', () => { const active = memo('active', null, 'a1'); const done = { ...memo('done', null, 'a0'), status: 'completed' as const, completedAt: now }; expect(flattenVisibleNodes([active, done], new Set([UNASSIGNED_GROUP_ID])).map((row) => row.node.id)).toEqual([UNASSIGNED_GROUP_ID, 'done', 'active']); });
  it('完了済みMemoも元のCategoryとsortKey位置に置き、削除済みMemoだけを除外する', () => { const done = { ...memo('done', 'a', 'a0'), status: 'completed' as const, completedAt: now }; const active = memo('active', 'a', 'a1'); const deleted = { ...memo('deleted', 'a', 'a2'), deletedAt: now }; expect(flattenVisibleNodes([category('a', null, 'a0'), active, deleted, done], new Set(['a'])).map((row) => row.node.id)).toEqual([UNASSIGNED_GROUP_ID, 'a', 'done', 'active']); });
  it('完了Memo表示をOFF→ON→OFFしても元の階層・順序とNodeデータを変えない', () => {
    const a = memo('a', 'category', 'a0');
    const b = { ...memo('b', 'category', 'a1'), status: 'completed' as const, completedAt: now };
    const c = memo('c', 'category', 'a2');
    const idea = { ...memo('idea', 'category', 'a3'), memoType: 'idea' as const };
    const routine = { ...memo('routine', 'category', 'a4'), repeatRule: { frequency: 'day' as const, interval: 1, startsOn: '2026-09-13' } };
    const nodes = [category('category', null, 'a0'), a, b, c, idea, routine];
    const snapshot = structuredClone(nodes);
    const ids = (showCompleted: boolean) => flattenVisibleNodes(nodes, new Set(['category']), showCompleted).map((row) => row.node.id);

    expect(ids(false)).toEqual([UNASSIGNED_GROUP_ID, 'category', 'a', 'c', 'idea', 'routine']);
    expect(ids(true)).toEqual([UNASSIGNED_GROUP_ID, 'category', 'a', 'b', 'c', 'idea', 'routine']);
    expect(ids(false)).toEqual([UNASSIGNED_GROUP_ID, 'category', 'a', 'c', 'idea', 'routine']);
    expect(nodes).toEqual(snapshot);
  });
  it('折りたたみ表示用に全子孫Nodeを数え、削除済みNodeを除外する', () => { const deleted = { ...memo('deleted', 'b', 'a1'), deletedAt: now }; const nodes = [category('a', null, 'a0'), category('b', 'a', 'a0'), memo('deep', 'b', 'a0'), deleted]; expect(visibleDescendantNodeCount(nodes, 'a')).toBe(2); expect(visibleDescendantNodeCount(nodes, 'b')).toBe(1); });
  it('無所属件数にはroot Memoだけを含める', () => { expect(visibleUnassignedMemoCount([category('a', null, 'a0'), memo('root', null, 'a1'), memo('child', 'a', 'a0')])).toBe(1); });
});
