import type { MemoNode, Node } from '../models/node';
import { missedRoutineOccurrences, parseLocalDateKey, routineHistoryDays } from '../domain/routine';

/** Read-only editor projection; recurrence generation and stored results stay unchanged. */
export function routineHistoryRows(nodes: Node[], memo: MemoNode, now = new Date(), count = 7) {
  const days = new Map(routineHistoryDays(memo, now, Infinity).map(day => [day.key, day]));
  if (memo.status === 'active' && memo.memoType !== 'idea') {
    // Use the exact same overdue occurrences as the deadline list, not a new rule expansion.
    for (const occurrence of missedRoutineOccurrences(nodes, memo, now)) {
      const key = occurrence.routineOccurrenceKey!, date = parseLocalDateKey(key);
      if (date && !days.has(key)) days.set(key, { key, date, completed: false, outcome: 'pending' });
    }
  }
  return [...days.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, Math.max(0, count));
}
