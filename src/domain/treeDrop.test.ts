import { describe, expect, it } from 'vitest';
import type { Node } from '../models/node';
import { compareNodes, moveNode } from './nodeOperations';
import { dropCandidateFor, resolveDropCandidate } from './treeDrop';

const now = new Date(0);
const category = (id: string, parentId: string | null, sortKey: string): Node => ({ id, type: 'category', parentId, sortKey, title: id, createdAt: now, updatedAt: now, deletedAt: null });
const memo = (id: string, parentId: string | null, sortKey: string): Node => ({ id, type: 'memo', parentId, sortKey, title: id, body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, createdAt: now, updatedAt: now, deletedAt: null });

describe('tree drop candidate', () => {
  it.each(['a', null])('子が1件の親%sの末尾へ移動する', (parentId) => {
    const current = [category('a', null, 'a0'), category('b', null, 'a1'), memo('last', parentId, 'a2'), memo('x', 'b', 'a0')];
    const candidate = dropCandidateFor(current, 'x', current[2], 'after')!;
    const moved = moveNode(current, 'x', candidate.parentId, candidate.beforeId);
    expect(moved.find((node) => node.id === 'x')?.parentId).toBe(parentId);
    expect(moved.filter((node) => node.parentId === parentId).sort(compareNodes).at(-1)?.id).toBe('x');
  });
  it.each(['task', 'idea'] as const)('最後のMemo下端へdropすると%sをCategory末尾へ移動する', (memoType) => {
    const current = [category('a', null, 'a0'), memo('a1', 'a', 'a0'), memo('a2', 'a', 'a1'), category('b', null, 'a1'), memo('b1', 'b', 'a0'), { ...memo('x', 'b', 'a1'), memoType }];
    const candidate = dropCandidateFor(current, 'x', current[2], 'after')!;
    const moved = moveNode(current, 'x', candidate.parentId, candidate.beforeId, new Date(1));
    expect(moved.filter((node) => node.parentId === 'a').sort(compareNodes).map((node) => node.id)).toEqual(['a1', 'a2', 'x']);
    expect(moved.find((node) => node.id === 'x')?.sortKey).toBe('a2');
    expect(moved.find((node) => node.id === 'b1')).toEqual(current[4]);
  });
  it('同一Categoryの先頭Memoを最後のMemo下端へ移動する', () => {
    const current = [category('a', null, 'a0'), memo('a1', 'a', 'a0'), memo('a2', 'a', 'a1')];
    const candidate = dropCandidateFor(current, 'a1', current[2], 'after')!;
    const moved = moveNode(current, 'a1', candidate.parentId, candidate.beforeId);
    expect(moved.filter((node) => node.parentId === 'a').sort(compareNodes).map((node) => node.id)).toEqual(['a2', 'a1']);
  });
  const nodes = () => [category('parent', null, 'a0'), memo('first', 'parent', 'a0'), category('moving', 'parent', 'a1'), memo('last', 'parent', 'a2'), category('other', null, 'a1'), memo('other-first', 'other', 'a0')];

  it('現在の親Categoryへのinside dropを配下先頭への並べ替えにする', () => {
    const current = nodes(); const candidate = dropCandidateFor(current, 'moving', current[0]);
    expect(candidate).toMatchObject({ parentId: 'parent', beforeId: 'first', kind: 'inside' });
    const moved = moveNode(current, 'moving', candidate!.parentId, candidate!.beforeId, new Date(1));
    expect(moved).not.toBe(current);
    expect(moved.filter((node) => node.parentId === 'parent').sort(compareNodes).map((node) => node.id)).toEqual(['moving', 'first', 'last']);
  });

  it('別Categoryへのinside dropでも挿入位置を失わない', () => {
    const current = nodes(); const target = current.find((node) => node.id === 'other')!; const candidate = dropCandidateFor(current, 'moving', target)!;
    expect(candidate.beforeId).toBe('other-first');
    const moved = moveNode(current, 'moving', candidate.parentId, candidate.beforeId, new Date(1));
    expect(moved.find((node) => node.id === 'moving')).toMatchObject({ parentId: 'other' });
  });

  it('実際に先頭のNodeを同じ先頭位置へdropした場合だけno-opにする', () => {
    const current = nodes(); const parent = current[0]; const candidate = dropCandidateFor(current, 'first', parent)!;
    expect(moveNode(current, 'first', candidate.parentId, candidate.beforeId)).toBe(current);
  });

  it('兄弟rowへのdropはその兄弟の直前へ移動する', () => {
    const current = nodes(); const target = current.find((node) => node.id === 'first')!;
    expect(dropCandidateFor(current, 'last', target)).toMatchObject({ parentId: 'parent', beforeId: 'first', kind: 'before' });
  });

  it('確定配列でCategoryの直前ならinsideではなくCategoryの兄弟としてcommitする', () => {
    const current = nodes(); const parent = current[0]; const hover = dropCandidateFor(current, 'moving', parent)!;
    const rows = [current.find((node) => node.id === 'moving')!, parent, ...current.filter((node) => !['moving', 'parent'].includes(node.id))].map((node) => ({ node }));
    const candidate = resolveDropCandidate(current, 'moving', hover, rows)!;
    expect(candidate).toMatchObject({ parentId: null, beforeId: 'parent', targetId: 'parent', kind: 'before' });
    const moved = moveNode(current, 'moving', candidate.parentId, candidate.beforeId, new Date(1));
    expect(moved.find((node) => node.id === 'moving')).toMatchObject({ parentId: null });
  });

  it('Category直後のgapだけをinsideとして維持する', () => {
    const current = nodes(); const other = current.find((node) => node.id === 'other')!; const moving = current.find((node) => node.id === 'moving')!; const hover = dropCandidateFor(current, 'moving', other)!;
    expect(resolveDropCandidate(current, 'moving', hover, [{ node: other }, { node: moving }])).toMatchObject({ parentId: 'other', kind: 'inside' });
  });

  it('展開中Category末尾のgapへMemoをdropすると次Categoryではなく末尾へ追加する', () => {
    const current = [
      category('category-a', null, 'a0'),
      memo('a1', 'category-a', 'a0'),
      memo('a2', 'category-a', 'a1'),
      category('category-b', null, 'a1'),
      memo('b1', 'category-b', 'a0'),
      memo('moving', null, 'a2'),
    ];
    const categoryB = current.find((node) => node.id === 'category-b')!;
    const moving = current.find((node) => node.id === 'moving')!;
    const hover = dropCandidateFor(current, moving.id, categoryB)!;
    const candidate = resolveDropCandidate(current, moving.id, hover, [
      { node: current[0] },
      { node: current[1] },
      { node: current[2] },
      { node: moving },
      { node: categoryB },
      { node: current[4] },
    ])!;
    const moved = moveNode(current, moving.id, candidate.parentId, candidate.beforeId, new Date(1));

    expect(moved.find((node) => node.id === moving.id)?.parentId).toBe('category-a');
    expect(moved.filter((node) => node.parentId === 'category-a').sort(compareNodes).map((node) => node.id)).toEqual(['a1', 'a2', 'moving']);
    expect(moved.filter((node) => node.parentId === 'category-b').sort(compareNodes).map((node) => node.id)).toEqual(['b1']);
  });
});
