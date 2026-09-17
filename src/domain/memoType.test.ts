import { describe, expect, it } from 'vitest';
import type { MemoNode, Node } from '@/models/node';
import { completionHistoryGroups } from './completionHistory';
import { deadlineGroups } from './deadlineView';
import { convertMemoType, isIdea, memoTypeOf } from './memoType';
import { moveNode } from './nodeOperations';

const now = new Date('2026-09-17T03:00:00.000Z');
const category: Node = { id: 'c', type: 'category', parentId: null, sortKey: 'a0', title: '候補', createdAt: now, updatedAt: now, deletedAt: null };
const memo = (overrides: Partial<MemoNode> = {}): MemoNode => ({ id: 'm', type: 'memo', memoType: 'task', parentId: null, sortKey: 'a1', title: '場所', body: '共通本文', dueAt: new Date('2026-09-18T03:00:00.000Z'), duePreset: 'custom', status: 'completed', completedAt: now, repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-09-17' }, routineHistory: { '2026-09-17': now.toISOString() }, deadlineSortKey: 'a0', createdAt: now, updatedAt: now, deletedAt: null, ...overrides });

describe('Task / Idea', () => {
  it('memoTypeのない旧MemoをTaskとして扱う', () => expect(memoTypeOf(memo({ memoType: undefined }))).toBe('task'));
  it('Ideaを期限一覧・完了一覧へ表示しない', () => { const idea = memo({ memoType: 'idea' }); expect(deadlineGroups([idea], now).flatMap((group) => group.memos)).toEqual([]); expect(completionHistoryGroups([idea], 'completedAt')).toEqual([]); });
  it('TaskからIdeaへの変換でTask固有情報を除去し共通情報を維持する', () => { const converted = convertMemoType([memo()], 'm', 'idea', now)[0] as MemoNode; expect(isIdea(converted)).toBe(true); expect(converted).toMatchObject({ title: '場所', body: '共通本文', parentId: null, sortKey: 'a1', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, repeatRule: null }); expect(converted.routineHistory).toBeUndefined(); expect(converted.deadlineSortKey).toBeUndefined(); });
  it('Ideaから期限なしTaskへ変換し共通情報を維持する', () => { const converted = convertMemoType([memo({ memoType: 'idea', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, repeatRule: null })], 'm', 'task', now)[0] as MemoNode; expect(memoTypeOf(converted)).toBe('task'); expect(converted).toMatchObject({ title: '場所', body: '共通本文', parentId: null, sortKey: 'a1', dueAt: null, duePreset: 'none' }); });
  it('ドラッグ相当の移動後もIdea種別を維持する', () => { const moved = moveNode([category, memo({ memoType: 'idea', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, repeatRule: null })], 'm', 'c', undefined, now).find((node) => node.id === 'm') as MemoNode; expect(moved.parentId).toBe('c'); expect(isIdea(moved)).toBe(true); });
});
