import { describe, expect, it } from 'vitest';
import type { CategoryNode, MemoNode, Node } from '../models/node';
import { canMoveSelectedNodes, completableSelectedMemoIds, deleteSelectedNodes, moveSelectedNodes, normalizeSelectedNodeIds, selectedNodeState } from './nodeSelection';

const date = new Date(2026, 8, 17, 12);
const category = (id: string, parentId: string | null, sortKey: string): CategoryNode => ({ id, type: 'category', parentId, sortKey, title: id, createdAt: date, updatedAt: date, deletedAt: null });
const memo = (id: string, parentId: string | null, sortKey: string): MemoNode => ({ id, type: 'memo', parentId, sortKey, title: id, body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, createdAt: date, updatedAt: date, deletedAt: null });
const tree = (): Node[] => [category('a', null, 'a'), category('b', 'a', 'a'), memo('m1', 'b', 'a'), category('c', null, 'b'), memo('m2', null, 'c')];

describe('Node選択の正規化', () => {
  it('親Category選択時は選択された子孫を二重対象にしない', () => { expect(normalizeSelectedNodeIds(tree(), ['a', 'b', 'm1', 'm2'])).toEqual(['a', 'm2']); expect(selectedNodeState(tree(), new Set(['a']), 'm1')).toBe('contained'); });
  it('CategoryとMemoを混在したまま同じ移動先へ移動する', () => { const moved = moveSelectedNodes(tree(), ['b', 'm2'], 'c', date); expect(moved.find((node) => node.id === 'b')?.parentId).toBe('c'); expect(moved.find((node) => node.id === 'm1')?.parentId).toBe('b'); expect(moved.find((node) => node.id === 'm2')?.parentId).toBe('c'); });
  it('選択Category自身と子孫への移動を禁止する', () => { expect(canMoveSelectedNodes(tree(), ['a'], 'a')).toBe(false); expect(canMoveSelectedNodes(tree(), ['a'], 'b')).toBe(false); });
  it('Category配下を含む未完了Memoだけを完了対象にする', () => { expect(completableSelectedMemoIds(tree(), ['a', 'm2'], date)).toEqual(['m1', 'm2']); });
  it('Categoryは既存cascade削除、Memoは単体削除を利用する', () => { const deleted = deleteSelectedNodes(tree(), ['a', 'm1', 'm2'], date); expect(deleted.filter((node) => ['a', 'b', 'm1', 'm2'].includes(node.id)).every((node) => node.deletedAt?.getTime() === date.getTime())).toBe(true); expect(deleted.find((node) => node.id === 'c')?.deletedAt).toBeNull(); });
});
