import { expect, it } from 'vitest';
import type { CategoryNode, MemoNode } from '../models/node';
import { completeRoutineDefinition, resumeRoutineDefinition } from './routineLifecycle';
import { routineOccurrenceDueAt, missedRoutineOccurrences, skipRoutineOccurrence } from './routine';
import { deadlineGroups } from './deadlineView';
import { flattenVisibleNodes } from './treeView';
import { completionHistoryGroups } from './completionHistory';
import { serializeNodeBackup, parseNodeBackup } from '../services/nodeBackup';
import { commitNodeHistory, createNodeHistory, undoNodeHistory, redoNodeHistory } from './nodeHistory';
import { updateNode } from './nodeOperations';

const start = new Date(2026, 9, 1, 9);
const root: CategoryNode = { id: 'r', type: 'category', categoryKind: 'routineRoot', parentId: null, sortKey: 'a0', title: 'Routine', createdAt: start, updatedAt: start, deletedAt: null };
const memo: MemoNode = { id: 'm', type: 'memo', memoType: 'task', parentId: 'r', sortKey: 'a0', title: 'daily', body: '', createdAt: start, updatedAt: start, deletedAt: null, status: 'active', completedAt: null, dueAt: start, duePreset: 'custom', repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-01' }, routineHistory: { '2026-10-01': start.toISOString() }, routineOutcomes: { '2026-10-02': { state: 'skipped', changedAt: start.toISOString(), version: 1 } } };

it('retains pending occurrences and history while stopping generation and hiding only the definition', () => {
  const stopped = completeRoutineDefinition([root, memo], 'm', new Date(2026, 9, 4, 8));
  const definition = stopped[1] as MemoNode;
  expect(routineOccurrenceDueAt(stopped, definition, new Date(2026, 9, 5))).toBeNull();
  expect(missedRoutineOccurrences(stopped, definition, new Date(2026, 9, 6)).map(n => n.routineOccurrenceKey)).toEqual(['2026-10-03', '2026-10-04']);
  expect(deadlineGroups(stopped, new Date(2026, 9, 6)).flatMap(g => g.memos)).toHaveLength(2);
  expect(flattenVisibleNodes(stopped, new Set(['r']), false).some(n => n.node.id === 'm')).toBe(false);
  expect(flattenVisibleNodes(stopped, new Set(['r']), true).some(n => n.node.id === 'm')).toBe(true);
  expect(completionHistoryGroups(stopped, 'completedAt').flatMap(g => g.items)).toHaveLength(2);
  expect(definition.routineHistory).toEqual(memo.routineHistory);
  expect(definition.routineOutcomes).toEqual(memo.routineOutcomes);
  expect(() => skipRoutineOccurrence(stopped, 'm', new Date(2026, 9, 3))).not.toThrow();
});

it('does not backfill stopped dates or the already-overdue resume day, and supports repeated completion', () => {
  let nodes = completeRoutineDefinition([root, memo], 'm', new Date(2026, 9, 4, 8));
  nodes = resumeRoutineDefinition(nodes, 'm', new Date(2026, 9, 7, 10));
  expect(routineOccurrenceDueAt(nodes, nodes[1] as MemoNode, new Date(2026, 9, 7))).toBeNull();
  expect(routineOccurrenceDueAt(nodes, nodes[1] as MemoNode, new Date(2026, 9, 8))).not.toBeNull();
  expect(missedRoutineOccurrences(nodes, nodes[1] as MemoNode, new Date(2026, 9, 8)).map(n => n.routineOccurrenceKey)).toEqual(['2026-10-03', '2026-10-04']);
  nodes = completeRoutineDefinition(nodes, 'm', new Date(2026, 9, 8, 8));
  nodes = resumeRoutineDefinition(nodes, 'm', new Date(2026, 9, 10, 8));
  expect(routineOccurrenceDueAt(nodes, nodes[1] as MemoNode, new Date(2026, 9, 10))).not.toBeNull();
  expect((nodes[1] as MemoNode).repeatRule).toEqual(memo.repeatRule);
});

it.each(['day', 'week', 'month', 'year'] as const)('preserves %s cycles, tree position, deadlines and results through backup and Undo/Redo', frequency => {
  const m = { ...memo, repeatRule: { ...memo.repeatRule!, frequency } };
  const nodes = [root, m];
  const history = commitNodeHistory(createNodeHistory(nodes), 'finish', n => completeRoutineDefinition(n, 'm', new Date(2026, 9, 4, 8)));
  const restored = parseNodeBackup(serializeNodeBackup(history.nodes));
  expect(restored).toEqual(history.nodes);
  const next = frequency === 'day' || frequency === 'week' ? new Date(2026, 9, 8) : frequency === 'month' ? new Date(2026, 10, 1) : new Date(2027, 9, 1);
  expect(routineOccurrenceDueAt(history.nodes, history.nodes[1] as MemoNode, next)).toBeNull();
  const resumed = resumeRoutineDefinition(restored, 'm', new Date(2026, 9, 7, 10));
  expect(routineOccurrenceDueAt(resumed, resumed[1] as MemoNode, next)).not.toBeNull();
  const undone = undoNodeHistory(history);
  expect(undone.nodes[1]).toMatchObject({ routineLifecycle: { periods: [] }, parentId: m.parentId, sortKey: m.sortKey, routineHistory: m.routineHistory, routineOutcomes: m.routineOutcomes, dueAt: m.dueAt, repeatRule: m.repeatRule });
  const redone = redoNodeHistory(undone);
  expect((redone.nodes[1] as MemoNode).routineLifecycle?.periods).toEqual((history.nodes[1] as MemoNode).routineLifecycle?.periods);
});

it('does not change unrelated Memo or category and rejects malformed backup lifecycle', () => {
  const ordinary = { ...memo, id: 'ordinary', parentId: null, repeatRule: null };
  const nodes = completeRoutineDefinition([root, memo, ordinary], 'm', new Date(2026, 9, 4, 8));
  expect(nodes[0]).toBe(root); expect(nodes[2]).toBe(ordinary);
  const backup = JSON.parse(serializeNodeBackup(nodes));
  backup.nodes[1].routineLifecycle.periods[0].resumedAt = 'invalid';
  expect(() => parseNodeBackup(JSON.stringify(backup))).toThrow(/Routine完了期間/);
});

it('preserves retained dates and exact due times after a period/start-date edit and a new per-date deadline override', () => {
  let nodes = completeRoutineDefinition([root, memo], 'm', new Date(2026, 9, 4, 8));
  nodes = updateNode(nodes, 'm', { repeatRule: { frequency: 'month', interval: 1, startsOn: '2026-10-20' }, dueAt: new Date(2026, 9, 20, 18) });
  expect(missedRoutineOccurrences(nodes, nodes[1] as MemoNode, new Date(2026, 9, 10)).map(n => [n.routineOccurrenceKey, n.dueAt?.getHours()])).toEqual([['2026-10-03', 9], ['2026-10-04', 9]]);
  const changed = nodes.map(n => n.id === 'm' ? { ...n, routineDueOverrides: { '2026-10-03': new Date(2026, 9, 11, 12).toISOString() } } : n);
  expect(routineOccurrenceDueAt(changed, changed[1] as MemoNode, new Date(2026, 9, 3))).toEqual(new Date(2026, 9, 11, 12));
});

it('keeps one existing task on same-day complete/resume and uses the default end-of-day deadline', () => {
  const m = { ...memo, dueAt: null };
  let nodes = completeRoutineDefinition([root, m], 'm', new Date(2026, 9, 4, 8));
  nodes = resumeRoutineDefinition(nodes, 'm', new Date(2026, 9, 4, 10));
  expect(routineOccurrenceDueAt(nodes, nodes[1] as MemoNode, new Date(2026, 9, 4))).toEqual(new Date(2026, 9, 4, 23, 59, 59, 999));
  expect(deadlineGroups(nodes, new Date(2026, 9, 4, 10)).flatMap(g => g.memos).filter(n => n.id === 'm')).toHaveLength(1);
});
