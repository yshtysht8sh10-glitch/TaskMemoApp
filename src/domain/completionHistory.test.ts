import { describe, expect, it } from 'vitest';
import type { Node } from '@/models/node';
import { completionHistoryGroups } from './completionHistory';

const memo = (id: string, createdAt: Date, completedAt: Date): Node => ({ id, type: 'memo', parentId: null, sortKey: id, title: id, body: '', dueAt: null, duePreset: 'none', status: 'completed', completedAt, createdAt, updatedAt: completedAt, deletedAt: null });

describe('completion history', () => {
  const nodes = [memo('old-created', new Date(2026, 8, 1, 10), new Date(2026, 8, 14, 9)), memo('new-created', new Date(2026, 8, 2, 10), new Date(2026, 8, 13, 9))];
  it('完了日で新しい日からグループ化する', () => expect(completionHistoryGroups(nodes, 'completedAt').map((group) => [group.label, group.memos.map((item) => item.id)])).toEqual([['2026年9月14日', ['old-created']], ['2026年9月13日', ['new-created']]]));
  it('作成日へ切り替えて同じグループ構造で並べる', () => expect(completionHistoryGroups(nodes, 'createdAt').map((group) => group.memos[0].id)).toEqual(['new-created', 'old-created']));
});
