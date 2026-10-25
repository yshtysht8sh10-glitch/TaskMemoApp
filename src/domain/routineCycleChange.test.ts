import { expect, it } from 'vitest';
import type { CategoryNode, MemoNode, Node, RoutineOutcome } from '../models/node';
import { updateNode } from './nodeOperations';
import { deadlineGroups } from './deadlineView';
import { toggleRoutineCompletion } from './routine';
import { nodeFromV2Value, nodeToV2Value } from '../sync/nodeV2Codec';

const now = new Date(2026, 9, 25, 10);
const root: CategoryNode = { id: 'root', type: 'category', categoryKind: 'routineRoot', title: 'Routine',
  parentId: null, sortKey: 'a0', createdAt: now, updatedAt: now, deletedAt: null };
const todayIds = (nodes: Node[], date = now) => deadlineGroups(nodes, date).flatMap(g => g.memos)
  .filter(m => !m.routineOccurrenceKey).map(m => m.id);

it.each(['pending', 'completed', 'skipped'] as const)(
  'monthly → daily preserves %s outcomes for past/current/future starts (#101)', state => {
    for (const startsOn of ['2026-10-24', '2026-10-25', '2026-10-26']) {
      // Outcomes may predate an intervening cycle change. Never reinterpret them.
      const outcome: RoutineOutcome = { state, version: 2, changedAt: now.toISOString() };
      const memo: MemoNode = { ...root, id: 'memo', type: 'memo', parentId: root.id, body: '',
        dueAt: null, duePreset: 'none', status: 'active', completedAt: null,
        repeatRule: { frequency: 'month', interval: 1, startsOn },
        routineHistory: { '2026-10-23': now.toISOString(), '2026-10-25': state === 'completed' ? now.toISOString() : null },
        routineOutcomes: { '2026-10-25': outcome },
        routineDueOverrides: { '2026-10-25': new Date(2026, 9, 25, 15).toISOString() },
      };
      const changed = updateNode([root, memo], memo.id, {
        repeatRule: { ...memo.repeatRule!, frequency: 'day' },
      }, now);
      const saved = changed[1] as MemoNode;
      expect(saved.routineHistory).toEqual(memo.routineHistory);
      expect(saved.routineOutcomes).toEqual(memo.routineOutcomes);
      expect(saved.routineDueOverrides).toEqual(memo.routineDueOverrides);
      expect(todayIds(changed)).toEqual(state === 'pending' && startsOn <= '2026-10-25' ? ['memo'] : []);
      const reloaded = changed.map(n => nodeFromV2Value(JSON.parse(JSON.stringify(nodeToV2Value(n)))));
      expect(todayIds(reloaded)).toEqual(todayIds(changed));
      expect(todayIds(reloaded, new Date(2026, 9, 26, 10))).toEqual(['memo']);
      if (state === 'pending' && startsOn <= '2026-10-25') {
        const completed = toggleRoutineCompletion(changed, 'memo', now);
        expect(todayIds(completed)).toEqual([]);
        expect(todayIds(toggleRoutineCompletion(completed, 'memo', now))).toEqual(['memo']);
      }
    }
  },
);
