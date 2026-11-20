import { describe, expect, it } from 'vitest';
import type { CategoryNode, MemoNode, Node } from '../models/node';
import { searchTasks } from './taskSearch';

const now = new Date(2026, 10, 21, 12);
const task = (id: string, patch: Partial<MemoNode> = {}): MemoNode => ({
  id, type: 'memo', title: '集合写真', parentId: null, sortKey: 'a0',
  createdAt: now, updatedAt: now, deletedAt: null, body: '', dueAt: null,
  duePreset: 'none', status: 'active', completedAt: null, ...patch,
});
const folder = (id: string, title: string, parentId: string | null = null): CategoryNode => ({
  id, type: 'category', title, parentId, sortKey: 'a0', createdAt: now, updatedAt: now, deletedAt: null,
});

describe('read-only task search #132', () => {
  it('matches partial Japanese titles across folders, retaining distinct IDs and deadlines', () => {
    const dueAt = new Date(2026, 10, 22, 9);
    const nodes = [folder('a', '仕事'), folder('b', '家族'), task('1', { parentId: 'a', dueAt }), task('2', { parentId: 'b' })];
    const results = searchTasks(nodes, '写真', now);
    expect(results.map(r => [r.key, r.folder, r.dueAt])).toEqual([['1', '仕事', dueAt], ['2', '家族', null]]);
    expect(results[0].memo).toBe(nodes[2]);
  });
  it('normalizes query whitespace and case without changing titles', () => {
    expect(searchTasks([task('1', { title: 'Expo SDK' })], ' expo ', now)).toHaveLength(1);
  });
  it.each(['', '   ', '該当なし'])('returns no rows for %j', query => {
    expect(searchTasks([task('1')], query, now)).toEqual([]);
  });
  it('excludes Idea, completed, deleted, purged and deleted-ancestor tasks', () => {
    const nodes: Node[] = [folder('gone', '削除済み'), task('ok'), task('idea', { memoType: 'idea' }),
      task('done', { status: 'completed' }), task('deleted', { deletedAt: now }),
      task('purged', { purgedAt: now }), task('child', { parentId: 'gone' })];
    nodes[0].deletedAt = now;
    expect(searchTasks(nodes, '写真', now).map(r => r.key)).toEqual(['ok']);
  });
  it('uses existing Routine eligibility, keeps original dates and opens the source definition', () => {
    const root = { ...folder('r', 'Routine'), categoryKind: 'routineRoot' as const };
    const memo = task('routine', { parentId: 'r', dueAt: new Date(2026, 10, 20, 9),
      repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-11-20' } });
    const nodes = [root, memo];
    const before = JSON.stringify(nodes);
    const results = searchTasks(nodes, '写真', now);
    expect(results.map(r => r.occurrenceKey).sort()).toEqual(['2026-11-20', '2026-11-21']);
    expect(results.every(r => r.memo === memo)).toBe(true);
    expect(new Set(results.map(r => r.key)).size).toBe(2);
    expect(results.find(r => r.occurrenceKey === '2026-11-21')?.dueAt).toEqual(new Date(2026, 10, 21, 9));
    expect(JSON.stringify(nodes)).toBe(before);
  });
  it('does not include completed/skipped Routine days or generate future occurrences', () => {
    const root = { ...folder('r', 'Routine'), categoryKind: 'routineRoot' as const };
    const memo = task('r1', { parentId: 'r', repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-11-20' },
      routineHistory: { '2026-11-20': now.toISOString(), '2026-11-21': now.toISOString() } });
    expect(searchTasks([root, memo], '写真', now)).toEqual([]);
    expect(searchTasks([root, task('future', { parentId: 'r', repeatRule: { frequency: 'month', interval: 1, startsOn: '2026-12-01' } })], '写真', now)).toEqual([]);
  });
  it('supports nested folders and damaged cyclic ancestry without hanging', () => {
    expect(searchTasks([folder('a', '親'), folder('b', '子', 'a'), task('1', { parentId: 'b' })], '写真', now)[0].folder).toBe('親 > 子');
    expect(searchTasks([folder('a', '循環', 'a'), task('1', { parentId: 'a' })], '写真', now)).toHaveLength(1);
  });
  it('keeps 5000 same-name tasks distinct and never mutates the input', () => {
    const nodes = Array.from({ length: 5000 }, (_, i) => task(`task-${i}`));
    const before = JSON.stringify(nodes);
    expect(searchTasks(nodes, '写真', now)).toHaveLength(5000);
    expect(JSON.stringify(nodes)).toBe(before);
  });
});
