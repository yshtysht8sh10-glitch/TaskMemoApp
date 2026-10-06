import { generateKeyBetween } from 'fractional-indexing';
import { isValidSortKey } from '../domain/sortKeys';
import type { RepeatRule } from '../models/node';
import type { SyncNodeValue, VersionedNode } from '../sync/types';
import { sessionDate } from './deadlines';
import { parseText } from './parser';
import { sameBaseline, treeOrder } from './session';
import { canonical, errorAt, type TextChange, type TextPlan, type TextSession } from './syntax';
import { validateText } from './validator';

/** Pure, deterministic. Current time and generated IDs are frozen in the session. */
export function planTextEdit(session: TextSession, text: string, current: VersionedNode[]): TextPlan {
  const document = validateText(parseText(text, session.view), session.context, session);
  const errors = [...document.errors], changes: TextChange[] = [];
  const before = new Map(current.map(r => [r.value.id, r.value]));
  const after = new Map(current.map(r => [r.value.id, r.value]));
  const rowIds = document.rows.map((row, i) => row.ref ? session.refs[row.ref] : `text-${session.id}-${i + 1}`);
  const present = new Set(document.rows.flatMap(row => row.ref ? [row.ref] : []));
  const deletedIds = Object.entries(session.refs).filter(([ref]) => !present.has(ref)).map(([, id]) => id);
  const result = (): TextPlan => {
    const fingerprint = canonical({ sessionId: session.id, scope: session.scope, baseline: session.baseline, text, changes, deletedIds });
    return { session, document: text, changes: errors.length ? [] : changes, errors, fingerprint, deletedIds, requiresConfirmation: deletedIds.length > 0 || changes.length >= 50 || (session.orderedIds.length >= 20 && changes.length >= Math.ceil(session.orderedIds.length * 0.3)) };
  };
  if (!sameBaseline(session, current)) errors.push(errorAt('conflict', 0, 0));
  if (deletedIds.length && document.rows.some(row => !row.ref)) errors.push(errorAt('identity', 0, 1));
  if (errors.length) return result();
  const now = session.context.now;
  document.rows.forEach((row, index) => {
    const id = rowIds[index], existing = before.get(id);
    if (!row.ref && existing) { errors.push(errorAt('ref', row.line, 1, '新規IDが既存Nodeと衝突しました。')); return; }
    const parentId = session.view === 'list' ? existing ? existing.parentId as string | null : session.newParentId
      : row.parentRow === null ? row.region === 'routine' ? session.routineRootId ?? null : null : rowIds[row.parentRow];
    if (row.type === 'Category' && existing?.type === 'memo' || row.type !== 'Category' && existing?.type === 'category') { errors.push(errorAt('protected', row.line, 2, 'Category↔Memo変換は非対応です。')); return; }
    if (!existing && session.view === 'list' && row.type === 'Category') { errors.push(errorAt('protected', row.line, 2, '一覧からCategoryは追加できません。')); return; }
    if (existing?.categoryKind && existing.categoryKind !== 'routineRoot' && canonical(row.cells.map(c => c.value).slice(1)) !== canonical(session.baselineCells[row.ref!].slice(1))) { errors.push(errorAt('protected', row.line, 2, '旧Routine Categoryは編集できません。')); return; }
    if (existing?.categoryKind === 'routineRoot' && parentId !== existing.parentId) { errors.push(errorAt('protected', row.line, 1, 'Routine rootは移動できません。')); return; }
    let n: SyncNodeValue = existing ? { ...existing } : { id, type: row.type === 'Category' ? 'category' : 'memo', title: row.title, parentId, sortKey: '', createdAt: now, updatedAt: now, deletedAt: null, deletionBatchId: null,
      ...(row.type !== 'Category' ? { memoType: row.type === 'Idea' ? 'idea' : 'task', body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, repeatRule: null } : {}) };
    n.title = row.title; n.parentId = parentId;
    if (row.type !== 'Category') {
      const routineParent = session.baseline.find(r => r.value.id === parentId)?.value.categoryKind === 'routineRoot';
      const wasRoutine = existing && session.baseline.some(r => r.value.id === existing.parentId && r.value.categoryKind === 'routineRoot');
      if (!session.systemRegions && existing && Boolean(wasRoutine) !== routineParent && row.completion) {
        errors.push(errorAt('protected', row.line, 5, 'Routineへの出入りでは完了列を空にして実績と通常statusを保持してください。')); return;
      }
      if (row.type === 'Idea' && routineParent) { errors.push(errorAt('protected', row.line, 2, 'Routine内のTaskはIdeaにできません。')); return; }
      if (existing && (existing.memoType === 'idea' ? 'Idea' : 'Task') !== row.type) {
        // Preserve metadata by rejecting destructive conversions rather than stripping fields.
        if (existing.dueAt || existing.status === 'completed' || existing.repeatRule || Object.keys(existing.routineHistory as object ?? {}).length || Object.keys(existing.routineDueOverrides as object ?? {}).length) { errors.push(errorAt('protected', row.line, 2, '期限・完了・Routine情報を持つ種別変換は初期版ではできません。')); return; }
        n.memoType = row.type === 'Idea' ? 'idea' : 'task';
      }
      if (row.resolvedDue) { n.dueAt = row.resolvedDue.dueAt; n.duePreset = row.resolvedDue.duePreset; }
      if (row.body !== undefined) n.body = row.body;
      const leavingRoutine = wasRoutine && !routineParent;
      if (session.systemRegions && routineParent && !wasRoutine && existing?.status === 'completed') { errors.push(errorAt('protected', row.line, 5, '完了済みTaskは通常UIで未完了に戻してからRoutine化してください。完了履歴を暗黙に削除しません。')); return; }
      if (session.view === 'list' && canonical(existing?.repeatRule) !== canonical(row.repeatRule) && row.routine !== session.baselineCells[row.ref ?? '']?.[6]) { errors.push(errorAt('routine', row.line, 7, '一覧ではRoutine構造を変更できません。ツリーから編集してください。')); return; }
      if (session.systemRegions && leavingRoutine) n.repeatRule = null;
      if (row.routine && row.routine !== session.baselineCells[row.ref ?? '']?.[6]) {
        const oldRule = n.repeatRule as RepeatRule | null | undefined;
        if (oldRule && Object.keys(oldRule).some(key => !['frequency', 'interval', 'startsOn'].includes(key))) { errors.push(errorAt('protected', row.line, 7, '拡張repeatRuleは直接編集できません。')); return; }
        n.repeatRule = row.repeatRule ?? null;
      }
      // Legacy dormant rules outside the Routine root survive unrelated edits unchanged.
      // A new rule or membership change must satisfy the current regional contract.
      if (n.repeatRule && !routineParent && (!existing || parentId !== existing.parentId || canonical(existing.repeatRule) !== canonical(n.repeatRule))) errors.push(errorAt('routine', row.line, 7, 'RoutineはRoutine root直下で設定してください。'));
      // Existing moveNode clears repeatRule on entry; require an explicit new rule here.
      if (routineParent && !wasRoutine && existing?.repeatRule && row.routine === session.baselineCells[row.ref!]?.[6]) errors.push(errorAt('protected', row.line, 7, 'Routineへの移動はruleを明示的に再指定してください。'));
      if (row.completion) {
        const completed = row.completion === '完了';
        if (routineParent) {
          const key = sessionDate(session.context), history = n.routineHistory as Record<string, string | null> | undefined;
          if (Boolean(history?.[key]) !== completed) n.routineHistory = { ...history, [key]: completed ? now : null };
        } else if ((n.status === 'completed') !== completed) { n.status = completed ? 'completed' : 'active'; n.completedAt = completed ? now : null; }
      }
    }
    after.set(id, n);
  });
  for (const id of deletedIds) {
    const n = before.get(id)!;
    if (n.categoryKind === 'routineRoot') { errors.push(errorAt('protected', 0, 1, 'Routine rootは削除できません。')); continue; }
    // Match ordinary trash semantics: independent Memos do not restore unrelated deletes.
    let batchRoot: string | null = n.type === 'category' ? id : null;
    let parent = n.parentId as string | null;
    const seen = new Set<string>();
    while (parent && deletedIds.includes(parent) && !seen.has(parent)) {
      seen.add(parent); batchRoot = parent; parent = before.get(parent)?.parentId as string | null;
    }
    after.set(id, { ...n, deletedAt: now, deletionBatchId: batchRoot ? `text-delete-${session.id}-${batchRoot}` : null, updatedAt: now });
  }
  if (errors.length) return result();

  // Tree sequence is a total order per parent. List sequence is only deadline order per entrance group.
  const groups = new Map<string, string[]>();
  rowIds.forEach(id => {
    const n = after.get(id)!;
    if (session.view === 'list' && n.type === 'category') return;
    const group = session.view === 'tree' ? String(n.parentId ?? '\0root') : session.listGroups[id] ?? '\0list';
    groups.set(group, [...groups.get(group) ?? [], id]);
  });
  for (const ids of groups.values()) {
    const field = session.view === 'tree' ? 'sortKey' : 'deadlineSortKey';
    const originalIds = session.view === 'tree'
      ? session.orderedIds.filter(id => ids.includes(id) && before.get(id)!.parentId === after.get(ids[0])!.parentId)
      : session.orderedIds.filter(id => ids.includes(id));
    if (canonical(originalIds) === canonical(ids) && ids.every(id => before.has(id) && (session.view === 'list' || before.get(id)!.parentId === after.get(id)!.parentId))) continue;
    const retainedRanks = ids.filter(id => before.has(id) && (session.view === 'list' || before.get(id)!.parentId === after.get(id)!.parentId))
      .map(id => before.get(id)![field]).filter(rank => rank !== undefined);
    if (retainedRanks.some(rank => typeof rank !== 'string' || !isValidSortKey(rank)) || new Set(retainedRanks).size !== retainedRanks.length) {
      errors.push(errorAt('protected', 0, 1, '並べ替え先のrankが不正・重複しています。既存の復旧手順で修復してください。')); continue;
    }
    let previous: string | null = null;
    ids.forEach((id, index) => {
      const n = after.get(id)!, old = before.get(id);
      const key = n[field] as string | undefined;
      const remainingKeys = ids.slice(index + 1)
        .filter(next => before.has(next) && (session.view === 'list' || before.get(next)!.parentId === after.get(next)!.parentId))
        .map(next => after.get(next)![field]).filter((k): k is string => typeof k === 'string' && isValidSortKey(k) && (previous === null || k > previous)).sort();
      // Retain any existing rank that still fits the target sequence. Only moved ranks change.
      if (old && key && isValidSortKey(key) && (previous === null || key > previous) && (!remainingKeys.length || key < remainingKeys[0]) && (session.view === 'list' || old.parentId === n.parentId)) previous = key;
      else {
        // Hidden system backing nodes still occupy ranks; never collide with or move them.
        const hiddenRanks = session.view === 'tree' ? [...after.values()].filter(other => !other.deletedAt && !other.purgedAt && other.parentId === n.parentId && !ids.includes(other.id))
          .map(other => other.sortKey).filter((rank): rank is string => typeof rank === 'string' && isValidSortKey(rank) && (previous === null || rank > previous)) : [];
        const next = [...remainingKeys, ...hiddenRanks].sort()[0] ?? null;
        const rank = generateKeyBetween(previous, next); after.set(id, { ...n, [field]: rank }); previous = rank;
      }
    });
  }
  // New list Memos get a tree rank after their existing siblings, independently of projection order.
  if (session.view === 'list') for (const id of rowIds.filter(id => !before.has(id))) {
    const n = after.get(id)!;
    const siblings = [...after.values()].filter(p => p.id !== id && !p.deletedAt && !p.purgedAt && p.parentId === n.parentId && isValidSortKey(p.sortKey as string)).map(p => p.sortKey as string).sort();
    after.set(id, { ...n, sortKey: generateKeyBetween(siblings.at(-1) ?? null, null) });
  }
  const activeNodes = [...after.values()].filter(n => !n.deletedAt && !n.purgedAt);
  for (const n of activeNodes) if (n.parentId && !activeNodes.some(p => p.id === n.parentId && p.type === 'category')) errors.push(errorAt('hierarchy', 0, 1, '残すNodeの親Categoryが削除されています。'));
  try { treeOrder(current.map(r => ({ ...r, value: after.get(r.value.id)! })).concat(rowIds.filter(id => !before.has(id)).map(id => ({ value: after.get(id)!, revision: 0, lastOpId: '', lastDeviceId: '', lastLocalSeq: 0, operationType: 'create' as const })))); } catch (e) { errors.push(errorAt('hierarchy', 0, 1, e instanceof Error ? e.message : undefined)); }
  for (const [id, n] of after) {
    const old = before.get(id);
    if (old && canonical(old) === canonical(n)) continue;
    const previousTime = old?.updatedAt ? Date.parse(old.updatedAt as string) : 0;
    const value: SyncNodeValue = { ...n, updatedAt: new Date(Math.max(Date.parse(now), previousTime + 1)).toISOString() };
    const fields = [...new Set([...Object.keys(old ?? {}), ...Object.keys(value)])].filter(field => canonical(old?.[field]) !== canonical(value[field]));
    const historyChanged = old && canonical(old.routineHistory) !== canonical(value.routineHistory);
    const type = !old ? 'create' : value.deletedAt && !old.deletedAt ? 'softDelete' : old.status !== value.status ? value.status === 'completed' ? 'complete' : 'uncomplete'
      : historyChanged ? (value.routineHistory as Record<string, unknown>)?.[sessionDate(session.context)] ? 'complete' : 'uncomplete' : 'update';
    changes.push({ id, type, before: old ?? null, after: value, fields, line: document.rows.find((_, i) => rowIds[i] === id)?.line ?? 0 });
  }
  return result();
}
