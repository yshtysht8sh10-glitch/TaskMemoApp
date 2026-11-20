import { expect, it } from 'vitest';
import type { MemoNode } from '../models/node';
import { formatDueLabel } from './formatDueLabel';

const memo = (dueAt: Date | null, duePreset: MemoNode['duePreset']): MemoNode => ({
  id: 'm', type: 'memo', title: 'Task', body: '', parentId: null, sortKey: 'a0',
  createdAt: new Date(2026, 9, 12), updatedAt: new Date(2026, 9, 12), deletedAt: null,
  dueAt, duePreset, status: 'active', completedAt: null,
});

it.each(['today', 'tomorrow', 'morning', 'afternoon', 'thisWeek', 'thisMonth', 'thisYear', 'custom'] as const)(
  '%s displays the actual stored deadline to the minute, including 23:59', preset => {
    const value = memo(new Date(2026, 9, 31, 23, 59, 59, 999), preset);
    const before = JSON.stringify(value);
    expect(formatDueLabel(value)).toBe('2026/10/31 23:59まで');
    expect(JSON.stringify(value)).toBe(before);
  });
it('distinguishes deadlines within the same bucket without recalculating from today', () => {
  expect(formatDueLabel(memo(new Date(2025, 0, 1, 9, 5), 'tomorrow'))).toBe('2025/1/1 09:05まで');
  expect(formatDueLabel(memo(new Date(2025, 0, 1, 20, 0), 'tomorrow'))).toBe('2025/1/1 20:00まで');
});
it('keeps genuine no-deadline tasks empty and does not render invalid dates', () => {
  expect(formatDueLabel(memo(null, 'none'))).toBeNull();
  expect(formatDueLabel(memo(null, 'today'))).toBeNull();
  expect(formatDueLabel(memo(new Date(NaN), 'custom'))).toBeNull();
});
