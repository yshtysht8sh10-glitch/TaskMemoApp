import { describe, expect, it } from 'vitest';
import type { Node } from '../models/node';
import { compareNodes, moveNode } from './nodeOperations';
import { dropCandidateFor, resolveDropCandidate } from './treeDrop';

const now = new Date(0);
const category = (id: string, parentId: string | null, sortKey: string): Node => ({ id, type: 'category', parentId, sortKey, title: id, createdAt: now, updatedAt: now, deletedAt: null });
const memo = (id: string, parentId: string | null, sortKey: string): Node => ({ id, type: 'memo', parentId, sortKey, title: id, body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, createdAt: now, updatedAt: now, deletedAt: null });

describe('tree drop candidate', () => {
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
});
