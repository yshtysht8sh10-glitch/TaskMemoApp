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
