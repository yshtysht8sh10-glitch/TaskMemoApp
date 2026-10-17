import type { MemoNode, Node } from '../models/node';
import { completeMemo, softDeleteNode } from './nodeOperations';
import { completeRoutineOccurrence, localDateKey, parseLocalDateKey, routineCategoryForMemo, skipRoutineOccurrence } from './routine';

export function routineListTarget(nodes: Node[], memo: MemoNode, now: Date) {
  const memoId = memo.routineSourceId ?? memo.id;
  const source = nodes.find((n): n is MemoNode => n.id === memoId && n.type === 'memo' && !n.deletedAt && !n.purgedAt);
  if (!source) throw new Error('対象のMemoが見つかりません。');
  if (!routineCategoryForMemo(nodes, source)) {
    if (memo.routineOccurrenceKey || memo.routineSourceId) throw new Error('ルーティーンの所属が変わっています。');
    return { memoId, dateKey: null };
  }
  const dateKey = memo.routineOccurrenceKey ?? localDateKey(now);
  if (!parseLocalDateKey(dateKey)) throw new Error('対象日が不正です。');
  return { memoId, dateKey };
}

/** List deletion is occurrence-only for routines; never forwards a routine to softDeleteNode. */
export function removeFromDeadlineList(nodes: Node[], memo: MemoNode, now: Date) {
  const target = routineListTarget(nodes, memo, now);
  return target.dateKey ? skipRoutineOccurrence(nodes, target.memoId, parseLocalDateKey(target.dateKey)!, now)
    : softDeleteNode(nodes, target.memoId, false, now);
}
export function completeFromDeadlineList(nodes: Node[], memo: MemoNode, now: Date) {
  const target = routineListTarget(nodes, memo, now);
  return target.dateKey ? completeRoutineOccurrence(nodes, target.memoId, parseLocalDateKey(target.dateKey)!, now)
    : completeMemo(nodes, target.memoId, now);
}
