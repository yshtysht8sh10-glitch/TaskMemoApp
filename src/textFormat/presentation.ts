import type { MemoNode, Node } from '../models/node';
import type { VisibleTreeRow } from '../domain/treeView';
import { categoryPath } from '../domain/deadlineView';
import { routineCategoryForMemo, routineOccurrenceDueAt, localDateKey } from '../domain/routine';
import { parseText } from './parser';
import { serializeText } from './session';
import { TEXT_TYPES, COMPLETION_VALUES, RELATIVE_DUE_VALUES, ROUTINE_ALIASES, type TextSession } from './syntax';

export type ListTextGroup = { key: string; label: string; memos: MemoNode[] };
export type TextViewRow = { title: string; depth: number; details: Partial<Record<TextDetail, string>> };
export const TEXT_DETAIL_LABELS = { due: '締め切り', body: '自由入力（本文）', type: 'Task / Idea', completion: '完了状態', category: 'カテゴリ', routine: 'Routine' } as const;
export type TextDetail = keyof typeof TEXT_DETAIL_LABELS;
export type TextViewSnapshot = { view: 'tree' | 'list'; rows: TextViewRow[] };

/** All deadline Routine rows are derived occurrences, including today's source-ID row. */
export function listEditProjection(nodes: Node[], groups: ListTextGroup[]) {
  const orderedIds: string[] = [], listGroups: Record<string, string> = {};
  let excluded = 0;
  for (const group of groups) for (const memo of group.memos) {
    if (memo.routineOccurrenceKey || memo.routineSourceId || routineCategoryForMemo(nodes, memo)) { excluded++; continue; }
    if (orderedIds.includes(memo.id)) throw new Error('一覧に同じ実Nodeが重複しています。');
    orderedIds.push(memo.id); listGroups[memo.id] = group.key;
  }
  return { orderedIds, listGroups, excluded };
}
function details(nodes: Node[], node: Node, now: Date, occurrence = false): TextViewRow['details'] {
  if (node.type === 'category') return { category: node.title };
  const routine = routineCategoryForMemo(nodes, node);
  const due = occurrence && routine && !node.routineOccurrenceKey ? routineOccurrenceDueAt(nodes, node, now) : node.dueAt;
  const completed = routine ? Boolean(node.routineHistory?.[node.routineOccurrenceKey ?? localDateKey(now)]) : node.status === 'completed';
  const rule = node.repeatRule;
  const labels = { day: '日', week: '週', month: '月', year: '年' };
  return { due: due ? `${due.getFullYear()}/${due.getMonth() + 1}/${due.getDate()} ${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}` : '期限なし', body: node.body,
    type: node.memoType === 'idea' ? 'Idea' : 'Task', completion: completed ? '完了' : '未完了', category: categoryPath(nodes, node.parentId) || '無所属',
    routine: routine ? rule ? `${rule.interval}${labels[rule.frequency]}ごと（開始 ${rule.startsOn}）${node.routineOccurrenceKey ? `・${node.routineOccurrenceKey}の未完了分` : ''}` : '設定なし' : 'なし' };
}
export function listTextSnapshot(nodes: Node[], groups: ListTextGroup[], now: Date): TextViewSnapshot {
  return { view: 'list', rows: groups.filter(g => g.memos.length).flatMap(group => [{ title: group.label, depth: 0, details: {} }, ...group.memos.map(node => ({ title: node.title, depth: 1, details: details(nodes, node, now, true) }))]) };
}
export function treeTextSnapshot(nodes: Node[], rows: VisibleTreeRow[], now: Date): TextViewSnapshot {
  return { view: 'tree', rows: rows.map(row => ({ title: row.node.type === 'category' && row.node.categoryKind === 'routineRoot' ? 'Routine' : row.node.title, depth: row.depth, details: details(nodes, row.node, now) })) };
}
export function renderTextView(snapshot: TextViewSnapshot, enabled: readonly TextDetail[], labels = false): string {
  return snapshot.rows.flatMap(row => {
    const indent = '  '.repeat(row.depth);
    return [indent + row.title, ...enabled.filter(key => row.details[key] !== undefined && row.details[key] !== '').flatMap(key => (row.details[key] ?? '').split(/\r?\n/).map((line, i) => `${indent}  ${i ? '  ' : '- '}${i === 0 && labels ? TEXT_DETAIL_LABELS[key] + ': ' : ''}${line}`))];
  }).join('\n');
}
export function textHighlights(session: TextSession, text: string) {
  const doc = parseText(text, session.view);
  const baseline = parseText(serializeText(session), session.view);
  const parentRef = (document: typeof doc, row: typeof doc.rows[number]) => row.parentRow === null ? row.region ?? 'root' : document.rows[row.parentRow].ref ?? 'new-category';
  const seen = new Set(doc.rows.flatMap(r => r.ref ? [r.ref] : []));
  return { doc, deleted: Object.keys(session.refs).filter(ref => !seen.has(ref)), rows: doc.rows.map((row, index) => ({ row, isNew: !row.ref,
    structureChanged: Boolean(row.ref && baseline.rows.some((original, originalIndex) => original.ref === row.ref && (originalIndex !== index || parentRef(baseline, original) !== parentRef(doc, row)))),
    changed: row.cells.map((cell, index) => Boolean(row.ref && session.baselineCells[row.ref] && cell.value !== (index === 0 ? row.ref : session.baselineCells[row.ref][index] ?? ''))) })) };
}
export function textChangeLabels(fields: readonly string[]): string[] {
  const labels: Record<string, string> = { title: 'タイトル', body: '本文', parentId: '所属', sortKey: 'ツリー順', deadlineSortKey: '一覧順', dueAt: '締め切り', duePreset: '期限の指定', status: '完了', completedAt: '完了', memoType: 'Task / Idea', repeatRule: 'Routine設定', routineHistory: 'Routine完了', deletedAt: '削除' };
  return [...new Set(fields.flatMap(field => Object.hasOwn(labels, field) ? [labels[field]] : []))];
}
/** Completion inserts exact values, never guesses a date or natural language. */
export function textCellCandidates(index: number): readonly string[] {
  return index === 1 ? TEXT_TYPES : index === 3 ? RELATIVE_DUE_VALUES : index === 4 ? COMPLETION_VALUES : index === 6 ? ['なし', ...Object.keys(ROUTINE_ALIASES)] : [];
}
export function closeTextChoices(dirty: boolean, errors: boolean): ('continue' | 'save' | 'discard' | 'close')[] {
  return !dirty ? ['close'] : errors ? ['continue', 'discard'] : ['continue', 'save', 'discard'];
}
