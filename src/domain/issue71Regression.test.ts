import { expect, it } from 'vitest';
import type { CategoryNode, MemoNode } from '../models/node';
import { deadlineGroups, hiddenDeadlineSummary } from './deadlineView';
import { localDateKey, toggleRoutineCompletion } from './routine';
import { parseNodeBackup, serializeNodeBackup } from '../services/nodeBackup';

const start = new Date(2026, 9, 3, 9);
const root: CategoryNode = { id: 'r', type: 'category', categoryKind: 'routineRoot', parentId: null, sortKey: 'a0', title: 'routine', createdAt: start, updatedAt: start, deletedAt: null };
const task: MemoNode = { id: 'm', type: 'memo', parentId: 'r', sortKey: 'a0', title: 'daily', body: '', dueAt: start, duePreset: 'custom', repeatRule: { frequency: 'day', interval: 1, startsOn: '2026-10-03' }, status: 'active', completedAt: null, createdAt: start, updatedAt: start, deletedAt: null };
it.each([1, 4])('[71-PAST] unfinished occurrences survive %s days and restart without new persisted Nodes', elapsed => {
  const nodes = parseNodeBackup(serializeNodeBackup([root, task], start));
  const now = new Date(2026, 9, 3 + elapsed, 8);
  const before = structuredClone(nodes);
  const groups = deadlineGroups(nodes, now, undefined, 'today');
  expect(groups.find(g => g.key === 'overdue')?.memos.map(m => m.routineOccurrenceKey)).toEqual(Array.from({ length: elapsed }, (_, i) => localDateKey(new Date(2026, 9, 3+i))));
  expect(groups.find(g => g.key === 'today')?.memos.map(m => m.id)).toEqual(['m']);
  expect(hiddenDeadlineSummary(nodes, now, new Set(['today']), 'today').total).toBe(elapsed);
  expect(nodes).toEqual(before);
});
it('[71-HISTORY] completion excludes only its occurrence; null history and overrides remain unfinished', () => {
  const overridden = { ...task, routineHistory: { '2026-10-03': null }, routineDueOverrides: { '2026-10-03': new Date(2026, 9, 3, 12).toISOString() } };
  const now = new Date(2026, 9, 5, 8);
  const nodes = toggleRoutineCompletion([root, overridden], 'm', new Date(2026, 9, 4), now);
  const past = deadlineGroups(nodes, now).find(g => g.key === 'overdue')!.memos;
  expect(past.map(m => m.routineOccurrenceKey)).toEqual(['2026-10-03']);
  expect(past[0].dueAt).toEqual(new Date(2026, 9, 3, 12));
  expect(past[0].routineSourceId).toBe('m');
  expect(nodes[1]).toMatchObject({ status: 'active', completedAt: null });
});
it('[71-BOUNDARY] local midnight creates one old virtual occurrence alongside the new current occurrence', () => {
  const before = new Date(2026, 9, 3, 23, 59, 59, 999);
  const after = new Date(2026, 9, 4, 0);
  expect(deadlineGroups([root, task], before).flatMap(g => g.memos).map(m => m.id)).toEqual(['m']);
  expect(deadlineGroups([root, task], after).flatMap(g => g.memos).map(m => m.id)).toEqual(['routine-overdue:m:2026-10-03', 'm']);
});
it('[71-TOMBSTONE] purged routine source never generates occurrences or hidden count', () => {
  const nodes = [root, { ...task, purgedAt: start }];
  const now = new Date(2026, 9, 5, 8);
  expect(deadlineGroups(nodes, now).flatMap(g => g.memos)).toEqual([]);
  expect(hiddenDeadlineSummary(nodes, now, new Set()).total).toBe(0);
});
it('[71-OVERRIDE-FUTURE] a postponed old occurrence retains its occurrence key and uses the actual #60 deadline bucket', () => {
  const postponed = { ...task, routineDueOverrides: { '2026-10-03': new Date(2026, 9, 6, 12).toISOString() } };
  const now = new Date(2026, 9, 3, 8);
  const nextDay = new Date(2026, 9, 4, 8);
  const groups = deadlineGroups([root, postponed], nextDay, new Set(['today', 'thisWeek', 'nextWeek']), 'today');
  const occurrence = groups.find(g => g.key === 'nextWeek')!.memos[0];
  expect(occurrence).toMatchObject({ routineSourceId: 'm', routineOccurrenceKey: '2026-10-03', dueAt: new Date(2026, 9, 6, 12) });
  expect(groups.find(g => g.key === 'overdue')).toBeUndefined();
  expect(postponed.routineHistory).toBeUndefined();
  expect(postponed.status).toBe('active');
  expect(deadlineGroups([root, postponed], now).flatMap(g => g.memos).map(m => m.id)).toEqual(['m']);
});
