import type { Node } from '../models/node';
import type { SyncOperationType } from './types';

/** Only an explicit deletion command may remove a large share of active Nodes. */
export function assertSafeNodeTransition(before: Node[], after: Node[], type: SyncOperationType) {
  const active = (nodes: Node[]) => nodes.filter(node => !node.deletedAt && !node.purgedAt).length;
  const previous = active(before), next = active(after);
  if (type === 'softDelete' || type === 'purge') return;
  if (previous >= 20 && next < previous && (next === 0 || previous - next >= Math.max(20, Math.ceil(previous / 2))))
    throw new Error(`Node件数が${previous}件から${next}件へ急減したため同期を停止しました。復旧診断を確認してください。`);
}

/** Only the exact reviewed soft-deletion set is exempt, never an allow flag. */
export function assertSafeTextTransition(before: Node[], after: Node[], confirmedDeletionIds: readonly string[]) {
  const afterById = new Map(after.map(node => [node.id, node]));
  const approved = new Set(confirmedDeletionIds);
  const actual = before.filter(node => !node.deletedAt && !node.purgedAt &&
    (!afterById.has(node.id) || afterById.get(node.id)!.deletedAt || afterById.get(node.id)!.purgedAt)).map(node => node.id);
  if (approved.size !== confirmedDeletionIds.length || actual.length !== approved.size || actual.some(id => !approved.has(id)))
    throw new Error('確認した削除対象と実際の減少が一致しません。');
  for (const node of before) {
    const next = afterById.get(node.id);
    if (!next || (!!next.purgedAt !== !!node.purgedAt) || (node.deletedAt && !next.deletedAt))
      throw new Error('テキスト保存ではNode除去・purge・ゴミ箱復元はできません。');
  }
  // Run the ordinary guard on every change except the explicitly reviewed deletes.
  assertSafeNodeTransition(before, after.map(node => approved.has(node.id) ?
    { ...node, deletedAt: null, purgedAt: null } : node), 'update');
}
