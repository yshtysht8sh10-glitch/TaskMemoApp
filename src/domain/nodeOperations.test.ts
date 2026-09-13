import { describe, expect, it } from 'vitest';
import type { Node } from '../models/node';
import { completeMemo, createNode, hardDeleteNode, moveNode, restoreMemo, restoreNode, softDeleteNode, visibleNodes } from './nodeOperations';

const now = new Date('2026-09-12T00:00:00Z');
const base = (id: string, type: 'category' | 'memo', parentId: string | null, sortKey: string): Node => type === 'category'
  ? { id, type, parentId, sortKey, title: id, createdAt: now, updatedAt: now, deletedAt: null }
  : { id, type, parentId, sortKey, title: id, body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, createdAt: now, updatedAt: now, deletedAt: null };
const tree = () => [base('a', 'category', null, 'a0'), base('b', 'category', 'a', 'a0'), base('m1', 'memo', 'b', 'a0'), base('m2', 'memo', null, 'a1')];

describe('node operations', () => {
  it('sortKey順に作成し、同一階層を移動する', () => { const created = createNode(tree(), 'memo', { title: 'new', parentId: null }, now, 'new'); const moved = moveNode(created, 'new', null, 'm2'); expect(moved.filter((n) => n.parentId === null).sort((x, y) => x.sortKey.localeCompare(y.sortKey)).map((n) => n.id)).toEqual(['a', 'new', 'm2']); });
  it('別Categoryへ移動する', () => { const result = moveNode(tree(), 'm2', 'b'); expect(result.find((n) => n.id === 'm2')?.parentId).toBe('b'); });
  it('Categoryの循環移動を拒否する', () => expect(() => moveNode(tree(), 'a', 'b')).toThrow(/子孫/));
  it('完了で通常一覧から消え、未完了へ戻せる', () => { const done = completeMemo(tree(), 'm2', now); expect(visibleNodes(done).some((n) => n.id === 'm2')).toBe(false); expect(restoreMemo(done, 'm2').find((n) => n.id === 'm2')).toMatchObject({ status: 'active', completedAt: null }); });
  it('Memoを論理削除して復元する', () => { const deleted = softDeleteNode(tree(), 'm2', false, now); expect(deleted.find((n) => n.id === 'm2')?.deletedAt).toEqual(now); expect(restoreNode(deleted, 'm2').find((n) => n.id === 'm2')?.deletedAt).toBeNull(); });
  it('Categoryのみ削除すると子が親へ昇格する', () => { const result = softDeleteNode(tree(), 'b', false, now); expect(result.find((n) => n.id === 'm1')).toMatchObject({ parentId: 'a' }); expect(result.find((n) => n.id === 'b')?.deletedAt).toEqual(now); });
  it('Categoryを子ごと削除し、サブツリーで復元する', () => { const deleted = softDeleteNode(tree(), 'a', true, now); expect(deleted.filter((n) => ['a', 'b', 'm1'].includes(n.id)).every((n) => n.deletedAt)).toBe(true); const restored = restoreNode(deleted, 'a'); expect(restored.filter((n) => ['a', 'b', 'm1'].includes(n.id)).every((n) => n.deletedAt === null)).toBe(true); });
  it('Categoryを完全削除すると子孫も残さない', () => expect(hardDeleteNode(tree(), 'a').map((n) => n.id)).toEqual(['m2']));
});
