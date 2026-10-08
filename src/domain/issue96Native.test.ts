import { expect, it } from 'vitest';
import { nativeDeadlineGroupForPlaceholder, nativeDeadlineInsertion } from './nativeDeadlineDrop';
import { deadlineGroups } from './deadlineView';

it('Native can reorder an overdue projection using the post-drop rows', () => {
  const rows = [
    { id: 'heading', kind: 'heading', groupKey: 'overdue' as const },
    { id: 'routine-overdue:r:2026-10-03', kind: 'memo', groupKey: 'overdue' as const },
    { id: 'task', kind: 'memo', groupKey: 'overdue' as const },
  ];
  const active = { id: rows[1].id, sourceGroup: 'overdue' as const };
  expect(nativeDeadlineGroupForPlaceholder(rows, 2, deadlineGroups([]), active.sourceGroup)).toBe('overdue');
  expect(nativeDeadlineInsertion(active, 'overdue', [rows[0], rows[2], rows[1]])).toEqual({ id: active.id, groupKey: 'overdue', position: { kind: 'append' } });
  expect(nativeDeadlineInsertion(active, 'overdue', rows)).toEqual({ id: active.id, groupKey: 'overdue', position: { kind: 'before', nodeId: 'task' } });
  expect(nativeDeadlineGroupForPlaceholder(rows, 2, deadlineGroups([]), 'am')).toBeNull();
});
