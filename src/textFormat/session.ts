import { compareNodes } from '../domain/nodeOperations';
import { nodeFromV2Value } from '../sync/nodeV2Codec';
import type { VersionedNode } from '../sync/types';
import { deadlineCell, sessionDate, zonedParts } from './deadlines';
import { encodeCell, parseText } from './parser';
import { canonical, type TextSession } from './syntax';

export type SessionOptions = {
  id: string; scope: string; view: 'tree' | 'list'; now: string; timeZone: string;
  /** List projection must reference source IDs, not missed-occurrence virtual IDs. */
  orderedIds?: string[]; listGroups?: Record<string, string>; newParentId?: string | null;
  systemRegions?: boolean;
};
const active = (record: VersionedNode) => !record.value.deletedAt && !record.value.purgedAt;
export function treeOrder(records: VersionedNode[]): string[] {
  const nodes = records.filter(active).map(record => nodeFromV2Value(record.value));
  const ids: string[] = [], visited = new Set<string>();
  const visit = (parentId: string | null) => {
    for (const node of nodes.filter(n => n.parentId === parentId).sort(compareNodes)) {
      if (visited.has(node.id)) throw new Error('循環したDomainは編集できません。');
      visited.add(node.id); ids.push(node.id); if (node.type === 'category') visit(node.id);
    }
  };
  visit(null);
  if (ids.length !== nodes.length) throw new Error('孤立・循環したDomainは編集できません。');
  return ids;
}
export function cellsForRecord(record: VersionedNode, session: Pick<TextSession, 'context' | 'baseline'>): string[] {
  const n = record.value;
  if (n.type === 'category') return ['', 'Category', n.title as string];
  const routine = session.baseline.some(r => r.value.id === n.parentId && r.value.categoryKind === 'routineRoot');
  const key = sessionDate(session.context);
  const rule = n.repeatRule as Record<string, unknown> | null | undefined;
  return ['', n.memoType === 'idea' ? 'Idea' : 'Task', n.title as string,
    deadlineCell(n.dueAt as string | null, n.duePreset as string, session.context),
    routine ? (Boolean((n.routineHistory as Record<string, unknown> | undefined)?.[key]) ? '完了' : '未完了') : n.status === 'completed' ? '完了' : '未完了',
    (n.body as string) ?? '', rule ? `${rule.frequency} interval=${rule.interval} startsOn=${rule.startsOn}` : 'なし'];
}
export function createTextSession(records: VersionedNode[], options: SessionOptions): TextSession {
  // Clone raw values (including unknown fields and field absence), never normalize.
  const baseline: VersionedNode[] = JSON.parse(JSON.stringify(records));
  if (new Set(baseline.map(r => r.value.id)).size !== baseline.length) throw new Error('重複Node IDです。');
  zonedParts(options.now, options.timeZone);
  let orderedIds = options.view === 'tree' ? options.orderedIds ?? treeOrder(baseline)
    : options.orderedIds ?? baseline.filter(r => active(r) && r.value.type === 'memo').map(r => r.value.id);
  const byId = new Map(baseline.map(r => [r.value.id, r]));
  if (new Set(orderedIds).size !== orderedIds.length || orderedIds.some(id => !byId.has(id) || !active(byId.get(id)!))) throw new Error('入口Viewの対象IDが不正です。');
  if (options.view === 'tree' && orderedIds.length !== baseline.filter(active).length) throw new Error('ツリー編集には全有効Nodeが必要です。');
  const roots = baseline.filter(r => active(r) && r.value.categoryKind === 'routineRoot');
  if (options.systemRegions && roots.length > 1) throw new Error('Routine管理領域が一意に特定できません。');
  const routineRootId = roots[0]?.value.id ?? null;
  if (options.systemRegions) orderedIds = orderedIds.filter(id => id !== routineRootId);
  if (orderedIds.some(id => byId.get(id)!.value.routineOccurrenceKey || byId.get(id)!.value.routineSourceId)) throw new Error('Routine projectionではなくsource Nodeを指定してください。');
  const newParentId = options.newParentId ?? null;
  if (newParentId && (!byId.has(newParentId) || !active(byId.get(newParentId)!) || byId.get(newParentId)!.value.type !== 'category')) throw new Error('新規Nodeの親が不正です。');
  const session: TextSession = { version: 1, id: options.id, scope: options.scope, view: options.view, context: { now: new Date(options.now).toISOString(), timeZone: options.timeZone }, baseline,
    refs: Object.fromEntries(orderedIds.map((id, i) => [`@n${i + 1}`, id])), orderedIds: [...orderedIds], listGroups: { ...options.listGroups }, newParentId, baselineCells: {}, systemRegions: options.systemRegions, routineRootId };
  for (const [ref, id] of Object.entries(session.refs)) session.baselineCells[ref] = cellsForRecord(byId.get(id)!, session);
  if (session.view === 'tree') {
    const parsed = parseText(serializeText(session), 'tree');
    if (parsed.errors.length || parsed.rows.some(row => {
      const parent = row.parentRow === null ? row.region === 'routine' ? routineRootId : null : session.refs[parsed.rows[row.parentRow].ref!];
      return parent !== byId.get(session.refs[row.ref!])!.value.parentId;
    })) throw new Error('入口ツリーの並びがDomain階層と一致しません。');
  }
  return session;
}

export function serializeText(session: TextSession): string {
  const byId = new Map(session.baseline.map(r => [r.value.id, r.value]));
  const lines = Object.entries(session.refs).map(([ref, id]) => {
    let depth = 0, parent = byId.get(id)!.parentId as string | null;
    if (session.view === 'tree') {
      const seen = new Set<string>();
      while (parent) { if (seen.has(parent) || !byId.has(parent)) throw new Error('不正な階層です。'); seen.add(parent); if (!(session.systemRegions && parent === session.routineRootId)) depth++; parent = byId.get(parent)!.parentId as string | null; }
    }
    const cells = [...session.baselineCells[ref]]; cells[0] = ref;
    return { routine: Boolean(session.routineRootId && byId.get(id)!.parentId === session.routineRootId), text: '  '.repeat(depth + (session.systemRegions && session.view === 'tree' ? 1 : 0)) + cells.map(encodeCell).join(' | ') };
  });
  if (session.systemRegions && session.view === 'tree') return ['@root', ...lines.filter(l => !l.routine).map(l => l.text), '', '@routine', ...lines.filter(l => l.routine).map(l => l.text)].join('\n');
  return lines.map(l => l.text).join('\n');
}

export const sameBaseline = (session: TextSession, current: VersionedNode[]) => canonical([...session.baseline].sort((a, b) => a.value.id.localeCompare(b.value.id))) === canonical([...current].sort((a, b) => a.value.id.localeCompare(b.value.id)));
