import { generateKeyBetween } from 'fractional-indexing';
import type { Node } from '../models/node';
import type { SyncNodeValue } from '../sync/types';
import { isValidSortKey } from './sortKeys';
export const ROUTINE_ROOT_ID = 'system-routine';
export const isRoutineRoot = (node: { id: string; type?: unknown; categoryKind?: unknown }) => node.type === 'category' && node.categoryKind === 'routineRoot';
/** No resurrection, ID repair, root merging, or metadata rewriting. */
export function findRoutineRoot(nodes: readonly SyncNodeValue[]) {
  const roots = nodes.filter(isRoutineRoot);
  if (roots.length > 1) throw new Error('Routine管理領域が複数あります。原本を保持して停止しました。');
  const root = roots[0];
  if (root && (root.deletedAt || root.purgedAt || root.parentId !== null || !isValidSortKey(root.sortKey as string)))
    throw new Error('Routine管理領域の状態が不正です。自動復活・修復せず停止しました。');
  if (nodes.some(node => node.id === ROUTINE_ROOT_ID && !isRoutineRoot(node)))
    throw new Error('Routine管理領域の予約IDが別Nodeで使われています。原本を保持しました。');
  return root ?? null;
}
export function newRoutineRoot(nodes: readonly SyncNodeValue[], now: Date): SyncNodeValue {
  const siblings = nodes.filter(n => !n.deletedAt && !n.purgedAt && n.parentId === null);
  const keys = siblings.map(n => n.sortKey as string).sort();
  if (keys.some(key => !isValidSortKey(key)) || new Set(keys).size !== keys.length)
    throw new Error('Routine管理領域を作成する前に既存の兄弟順序を確認してください。自動修復しません。');
  return { id: ROUTINE_ROOT_ID, type: 'category', categoryKind: 'routineRoot', parentId: null,
    title: 'ルーティーン', sortKey: generateKeyBetween(keys.at(-1) ?? null, null),
    createdAt: now.toISOString(), updatedAt: now.toISOString(), deletedAt: null };
}
/** System structure cannot be deleted/retyped/moved by user commands or History. */
export function assertRoutineRootTransition(before: Node[], after: Node[]) {
  const roots = after.filter(isRoutineRoot).filter(n => !n.deletedAt && !n.purgedAt);
  if (roots.length > 1) throw new Error('Routine管理領域の重複を作成できません。');
  for (const root of before.filter(isRoutineRoot).filter(n => !n.deletedAt && !n.purgedAt)) {
    const next = after.find(n => n.id === root.id);
    if (!next || !isRoutineRoot(next) || next.parentId !== root.parentId || next.deletedAt || next.purgedAt || next.title !== root.title)
      throw new Error('Routine管理領域はシステム管理対象です。削除・移動・変更できません。');
  }
}
