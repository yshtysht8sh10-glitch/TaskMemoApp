import { describe, expect, it } from 'vitest';
import type { Node } from '../models/node';
import { canMoveNode, compareNodes, compareSortKeys, completeMemo, createNode, duplicateMemo, hardDeleteNode, moveNode, restoreMemo, restoreNode, softDeleteNode, tryMoveNode, visibleNodes } from './nodeOperations';

const now = new Date('2026-09-12T00:00:00Z');
const base = (id: string, type: 'category' | 'memo', parentId: string | null, sortKey: string): Node => type === 'category'
  ? { id, type, parentId, sortKey, title: id, createdAt: now, updatedAt: now, deletedAt: null }
  : { id, type, parentId, sortKey, title: id, body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, createdAt: now, updatedAt: now, deletedAt: null };
const tree = () => [base('a', 'category', null, 'a0'), base('b', 'category', 'a', 'a0'), base('m1', 'memo', 'b', 'a0'), base('m2', 'memo', null, 'a1')];

describe('node operations', () => {
  it('sortKey順に作成し、同一階層を移動する', () => { const created = createNode(tree(), 'memo', { title: 'new', parentId: null }, now, 'new'); const moved = moveNode(created, 'new', null, 'm2'); expect(moved.filter((n) => n.parentId === null).sort(compareNodes).map((n) => n.id)).toEqual(['a', 'new', 'm2']); });
  it('新規Memoはdraftのstatusにかかわらず未完了で作成する', () => { const created = createNode(tree(), 'memo', { title: 'new', parentId: null, status: 'completed' }, now, 'new').find((node) => node.id === 'new'); expect(created).toMatchObject({ status: 'active', completedAt: null }); });
  it('Memoを同じ親の直後へ独立した未完了Memoとして複製する', () => { const source = { ...base('source', 'memo', 'b', 'a0'), body: '本文', duePreset: 'tomorrow' as const, dueAt: new Date('2026-09-13T14:59:00Z'), status: 'completed' as const, completedAt: now }; const after = base('after', 'memo', 'b', 'a1'); const duplicated = duplicateMemo([base('b', 'category', null, 'a0'), source, after], 'source', now, 'copy'); const copy = duplicated.find((node) => node.id === 'copy'); expect(copy).toMatchObject({ parentId: 'b', title: 'source', body: '本文', duePreset: 'tomorrow', dueAt: source.dueAt, status: 'active', completedAt: null, createdAt: now, updatedAt: now }); if (copy?.type !== 'memo') throw new Error('memo expected'); expect(copy.dueAt).not.toBe(source.dueAt); expect(duplicated.filter((node) => node.parentId === 'b').sort(compareNodes).map((node) => node.id)).toEqual(['source', 'copy', 'after']); });
  it('fractional keyをlocale非依存のコード単位順で比較する', () => { expect(compareSortKeys('Zz', 'a0')).toBeLessThan(0); });
  it('別Categoryへ移動する', () => { const result = moveNode(tree(), 'm2', 'b'); expect(result.find((n) => n.id === 'm2')?.parentId).toBe('b'); });
  it('Categoryの循環移動を拒否する', () => expect(() => moveNode(tree(), 'a', 'b')).toThrow(/移動/));
  it('完了で通常一覧から消え、未完了へ戻せる', () => { const done = completeMemo(tree(), 'm2', now); expect(visibleNodes(done).some((n) => n.id === 'm2')).toBe(false); expect(restoreMemo(done, 'm2').find((n) => n.id === 'm2')).toMatchObject({ status: 'active', completedAt: null }); });
  it('完了とUndoで元のCategory・sortKeyを保持する', () => { const original = tree().find((node) => node.id === 'm1')!; const restored = restoreMemo(completeMemo(tree(), 'm1', now), 'm1', new Date(now.getTime() + 1000)).find((node) => node.id === 'm1'); expect(restored).toMatchObject({ parentId: original.parentId, sortKey: original.sortKey, status: 'active', completedAt: null }); });
  it('Memoを論理削除して復元する', () => { const deleted = softDeleteNode(tree(), 'm2', false, now); expect(deleted.find((n) => n.id === 'm2')?.deletedAt).toEqual(now); expect(restoreNode(deleted, 'm2').find((n) => n.id === 'm2')?.deletedAt).toBeNull(); });
  it('Categoryのみ削除すると子が親へ昇格する', () => { const result = softDeleteNode(tree(), 'b', false, now); expect(result.find((n) => n.id === 'm1')).toMatchObject({ parentId: 'a' }); expect(result.find((n) => n.id === 'b')?.deletedAt).toEqual(now); });
  it('Categoryを子ごと削除し、サブツリーで復元する', () => { const deleted = softDeleteNode(tree(), 'a', true, now); expect(deleted.filter((n) => ['a', 'b', 'm1'].includes(n.id)).every((n) => n.deletedAt)).toBe(true); const restored = restoreNode(deleted, 'a'); expect(restored.filter((n) => ['a', 'b', 'm1'].includes(n.id)).every((n) => n.deletedAt === null)).toBe(true); });
  it('Categoryを完全削除すると子孫も残さない', () => expect(hardDeleteNode(tree(), 'a').map((n) => n.id)).toEqual(['m2']));
});

describe('move validation', () => {
  const richTree = () => [
    base('a', 'category', null, 'a0'), base('b', 'category', 'a', 'a0'),
    base('c', 'category', 'b', 'a0'), base('d', 'category', null, 'a1'),
    base('m1', 'memo', 'a', 'a1'), base('m2', 'memo', 'a', 'a2'),
  ];

  it.each([
    ['Memoを同じ親内で並び替え', 'm2', 'a', 'm1'],
    ['Categoryを同じ親内で並び替え', 'b', 'a', 'm1'],
    ['Memoを別Categoryへ移動', 'm1', 'd', undefined],
    ['Categoryを別Categoryへ移動', 'b', 'd', undefined],
    ['Nodeを親へ昇格', 'c', 'a', undefined],
    ['Nodeを祖先へ昇格', 'c', null, undefined],
    ['Nodeをルートへ移動', 'm1', null, undefined],
  ])('%sを許可する', (_label, id, parentId, beforeId) => {
    const result = moveNode(richTree(), id!, parentId, beforeId);
    expect(result.find((node) => node.id === id)?.parentId).toBe(parentId);
  });

  it.each([
    ['自分自身', 'a', 'a'], ['直下の子', 'a', 'b'], ['孫', 'a', 'c'],
    ['Memo', 'a', 'm1'], ['存在しないNode', 'a', 'missing'],
  ])('%sを親にする移動を拒否する', (_label, id, parentId) => {
    expect(canMoveNode(richTree(), id, parentId)).toBe(false);
  });

  it('deleted Categoryへの移動を拒否する', () => {
    const nodes = richTree().map((node) => node.id === 'd' ? { ...node, deletedAt: now } : node) as Node[];
    expect(canMoveNode(nodes, 'm1', 'd')).toBe(false);
  });

  it('既存cycleを有限時間で拒否する', () => {
    const nodes = [base('a', 'category', 'b', 'a0'), base('b', 'category', 'a', 'a0'), base('m', 'memo', null, 'a0')];
    expect(canMoveNode(nodes, 'm', 'a')).toBe(false);
  });

  it('不正dropはstateを一切変更せず、その後の通常操作を妨げない', () => {
    const original = richTree();
    const rejected = tryMoveNode(original, 'a', 'c');
    expect(rejected).toBe(original);
    expect(moveNode(rejected, 'm1', 'd').find((node) => node.id === 'm1')?.parentId).toBe('d');
  });

  it('不正なbeforeIdでもstateを壊さない', () => {
    const original = richTree();
    expect(tryMoveNode(original, 'm1', 'a', 'missing')).toBe(original);
  });
});
