import type { DuePreset, MemoNode, Node } from '@/models/node';
import { compareSortKeys } from './nodeOperations';
import { dueDateForPreset } from '../utils/dueDates';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

export type DeadlineGroupKey = 'overdue' | 'morning' | 'afternoon' | 'today' | 'tomorrow' | 'thisWeek' | 'thisMonth' | 'thisYear' | 'later' | 'none';
export type DeadlineCreateContext = { label: string; initialDuePreset: DuePreset; initialDueAt: Date | null; dueEditable: boolean; targetGroup: DeadlineGroupKey };
type DeadlineCreateRule = { kind: 'fixed'; preset: DuePreset } | { kind: 'editable'; preset: 'custom' };
export type DeadlineGroupDefinition = { id: DeadlineGroupKey; label: string; create: DeadlineCreateRule | null; fallbackGroupId: DeadlineGroupKey | null; dropLabel?: string };
export type DeadlineGroup = DeadlineDropTarget & { key: DeadlineGroupKey; memos: MemoNode[] };
export type DeadlineDropTarget = DeadlineGroupDefinition;
export const DEADLINE_GROUPS: readonly DeadlineGroupDefinition[] = [
  { id: 'overdue', label: '期限切れ', create: null, fallbackGroupId: null },
  { id: 'morning', label: '午前', create: { kind: 'fixed', preset: 'morning' }, fallbackGroupId: 'today', dropLabel: '午前までに変更' },
  { id: 'afternoon', label: '午後', create: { kind: 'fixed', preset: 'afternoon' }, fallbackGroupId: 'today', dropLabel: '午後までに変更' },
  { id: 'today', label: '今日', create: { kind: 'fixed', preset: 'today' }, fallbackGroupId: 'thisWeek', dropLabel: '今日までに変更' },
  { id: 'tomorrow', label: '明日', create: { kind: 'fixed', preset: 'tomorrow' }, fallbackGroupId: 'thisWeek', dropLabel: '明日までに変更' },
  { id: 'thisWeek', label: '今週', create: { kind: 'fixed', preset: 'thisWeek' }, fallbackGroupId: 'thisMonth', dropLabel: '今週までに変更' },
  { id: 'thisMonth', label: '今月', create: { kind: 'fixed', preset: 'thisMonth' }, fallbackGroupId: 'thisYear', dropLabel: '今月までに変更' },
  { id: 'thisYear', label: '今年', create: { kind: 'fixed', preset: 'thisYear' }, fallbackGroupId: 'later', dropLabel: '今年までに変更' },
  { id: 'later', label: 'それ以降', create: { kind: 'editable', preset: 'custom' }, fallbackGroupId: null },
  { id: 'none', label: '期限なし', create: { kind: 'fixed', preset: 'none' }, fallbackGroupId: null, dropLabel: '期限なしに変更' },
] as const;

const endOfDay = (date: Date) => { const value = new Date(date); value.setHours(23, 59, 59, 999); return value; };

const deadlineBoundaries = (now: Date) => ({
  todayEnd: endOfDay(now),
  tomorrowEnd: endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)),
  weekEnd: endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((7 - now.getDay()) % 7))),
  monthEnd: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  yearEnd: endOfDay(new Date(now.getFullYear(), 11, 31)),
});

export function deadlineGroupForDueAt(dueAt: Date | null, now = new Date()): DeadlineGroupKey {
  if (dueAt === null) return 'none';
  const { todayEnd, tomorrowEnd, weekEnd, monthEnd, yearEnd } = deadlineBoundaries(now);
  const time = dueAt.getTime();
  return time < now.getTime() ? 'overdue' : time <= todayEnd.getTime() ? 'today' : time <= tomorrowEnd.getTime() ? 'tomorrow' : time <= weekEnd.getTime() ? 'thisWeek' : time <= monthEnd.getTime() ? 'thisMonth' : time <= yearEnd.getTime() ? 'thisYear' : 'later';
}

export function deadlineGroupForMemo(memo: MemoNode, now = new Date()): DeadlineGroupKey {
  if (memo.dueAt && memo.dueAt.getTime() < now.getTime()) return 'overdue';
  if (memo.duePreset === 'morning' || memo.duePreset === 'afternoon') return memo.duePreset;
  return deadlineGroupForDueAt(memo.dueAt, now);
}

export function visibleDeadlineGroup(source: DeadlineGroupKey, visibleGroupIds: ReadonlySet<DeadlineGroupKey>): DeadlineGroupKey | null {
  const byId = new Map(DEADLINE_GROUPS.map((group) => [group.id, group])); const visited = new Set<DeadlineGroupKey>(); let current: DeadlineGroupKey | null = source;
  while (current) { if (visibleGroupIds.has(current)) return current; if (visited.has(current)) return null; visited.add(current); current = byId.get(current)?.fallbackGroupId ?? null; }
  return null;
}

export function deadlineCreateContext(definition: DeadlineGroupDefinition, now = new Date()): DeadlineCreateContext | null {
  if (!definition.create) return null;
  if (definition.create.kind === 'fixed') return { label: definition.label, initialDuePreset: definition.create.preset, initialDueAt: dueDateForPreset(definition.create.preset, now), dueEditable: false, targetGroup: definition.id };
  const { yearEnd } = deadlineBoundaries(now);
  return { label: definition.label, initialDuePreset: definition.create.preset, initialDueAt: new Date(yearEnd.getTime() + 1), dueEditable: true, targetGroup: definition.id };
}

export function deadlineDraftForCreateContext(context: DeadlineCreateContext, editableDueAt?: Date | null, now = new Date()) {
  const dueAt = context.dueEditable ? editableDueAt ?? null : context.initialDueAt;
  if (context.dueEditable && deadlineGroupForDueAt(dueAt, now) !== context.targetGroup) throw new Error(`「${context.label}」に入る期限を指定してください。`);
  return { duePreset: context.initialDuePreset, dueAt };
}

export function deadlineGroups(nodes: Node[], now = new Date(), visibleGroupIds: ReadonlySet<DeadlineGroupKey> = new Set(DEADLINE_GROUPS.map((group) => group.id))): DeadlineGroup[] {
  const groups = new Map<DeadlineGroupKey, MemoNode[]>();
  const memos = nodes.filter((node): node is MemoNode => node.type === 'memo' && node.status === 'active' && node.deletedAt === null)
    .sort((a, b) => a.deadlineSortKey && b.deadlineSortKey ? compareSortKeys(a.deadlineSortKey, b.deadlineSortKey) || a.id.localeCompare(b.id) : (a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) || compareSortKeys(a.sortKey, b.sortKey) || a.id.localeCompare(b.id));
  for (const memo of memos) {
    const key = visibleDeadlineGroup(deadlineGroupForMemo(memo, now), visibleGroupIds);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), memo]);
  }
  return DEADLINE_GROUPS.filter((definition) => visibleGroupIds.has(definition.id)).map((definition) => ({ ...definition, key: definition.id, memos: groups.get(definition.id) ?? [] }));
}

export function updateMemoDeadline(nodes: Node[], memoId: string, targetId: DeadlineGroupKey, now = new Date()) {
  const target = DEADLINE_GROUPS.find((group) => group.id === targetId);
  if (!target || target.create?.kind !== 'fixed') return nodes;
  const memo = nodes.find((node) => node.id === memoId);
  if (!memo || memo.type !== 'memo' || memo.deletedAt !== null || memo.status !== 'active') return nodes;
  const preset = target.create.preset;
  const dueAt = dueDateForPreset(preset, now);
  return nodes.map((node) => node.id === memoId ? { ...node, duePreset: preset, dueAt, updatedAt: now } : node);
}

/** Change a deadline group and place the memo at one exact position in the list. */
export function moveMemoInDeadlineList(nodes: Node[], memoId: string, targetId: DeadlineGroupKey, beforeId?: string, now = new Date()) {
  const target = DEADLINE_GROUPS.find((group) => group.id === targetId);
  const moving = nodes.find((node): node is MemoNode => node.id === memoId && node.type === 'memo');
  if (!moving || moving.deletedAt !== null || moving.status !== 'active' || !target) return nodes;
  const sameGroup = deadlineGroupForMemo(moving, now) === targetId;
  if (!sameGroup && target.create?.kind !== 'fixed') return nodes;

  const ordered = deadlineGroups(nodes, now).flatMap((group) => group.memos);
  const initialKeys = generateNKeysBetween(null, null, ordered.length);
  const withKeys = nodes.map((node) => {
    if (node.type !== 'memo') return node;
    const index = ordered.findIndex((memo) => memo.id === node.id);
    return index >= 0 ? { ...node, deadlineSortKey: node.deadlineSortKey ?? initialKeys[index] } : node;
  });
  const withDeadline = sameGroup ? withKeys : updateMemoDeadline(withKeys, memoId, targetId, now);
  const targetMemos = deadlineGroups(withDeadline, now).find((group) => group.key === targetId)?.memos.filter((memo) => memo.id !== memoId) ?? [];
  const insertion = beforeId ? targetMemos.findIndex((memo) => memo.id === beforeId) : targetMemos.length;
  const index = insertion < 0 ? targetMemos.length : insertion;
  const deadlineSortKey = generateKeyBetween(targetMemos[index - 1]?.deadlineSortKey ?? null, targetMemos[index]?.deadlineSortKey ?? null);
  return withDeadline.map((node) => node.id === memoId ? { ...node, deadlineSortKey, updatedAt: now } : node);
}

export function categoryPath(nodes: Node[], parentId: string | null) {
  const byId = new Map(nodes.map((node) => [node.id, node])); const titles: string[] = []; const visited = new Set<string>(); let id = parentId;
  while (id) { if (visited.has(id)) { titles.unshift('…'); break; } visited.add(id); const node = byId.get(id); if (!node || node.type !== 'category') break; titles.unshift(node.title); id = node.parentId; }
  return titles.length ? titles.join(' > ') : '無所属';
}
