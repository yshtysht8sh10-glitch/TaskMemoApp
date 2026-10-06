import { isValidSortKey } from '../domain/sortKeys';
import { canonical } from '../textFormat/syntax';
import type { SyncNodeValue } from './types';

/** Exact content fingerprint. Kept private: contains user data, never log it. */
export const sourceFingerprint = (value: unknown) => canonical(value);
/** V1 seed used a..z lexical ranks. Its loader deliberately leaves tombstones
 * untouched (6c05de3). They have no active ordering role; preserve, never repair.
 * Active Nodes and unrecognised malformed ranks still require valid fractions. */
export const isSupportedRawRank = (node: SyncNodeValue) => typeof node.sortKey === 'string' &&
  (isValidSortKey(node.sortKey) || (Boolean(node.deletedAt || node.purgedAt) && /^[a-z]$/.test(node.sortKey)));
export function decodeLegacyNodes(raw: string | null): SyncNodeValue[] {
  const nodes: SyncNodeValue[] = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(nodes)) throw new Error('V1保存がNode配列ではありません。原本を保持しました。');
  const ids = new Map<string, SyncNodeValue>();
  const ranks = new Set<string>();
  for (const n of nodes) {
    const failed = [
      !n || typeof n.id !== 'string' || !n.id ? 'id: 非空文字列が必要' : '',
      n && ids.has(n.id) ? 'id: 重複' : '',
      !n || !['memo', 'category'].includes(String(n.type)) ? 'type: memo/categoryが必要' : '',
      !n || typeof n.title !== 'string' ? 'title: 文字列が必要' : '',
      !n || !isSupportedRawRank(n) ? 'sortKey: 有効なfractional rank（非表示legacy Nodeのみa..zを保持）が必要' : '',
    ].filter(Boolean);
    if (failed.length) throw new Error(`V1のID/種別/rank検証で停止しました。自動修復しません。\nrecord ${nodes.indexOf(n) + 1}: ${JSON.stringify({ id: n?.id ?? null, type: n?.type ?? null, kind: n?.kind ?? null, parentId: n?.parentId ?? null, sortKey: n?.sortKey ?? null, rank: n?.rank ?? null, deletedAt: n?.deletedAt ?? null, purgedAt: n?.purgedAt ?? null })}\n${failed.join('\n')}`);
    for (const key of ['createdAt', 'updatedAt', 'deletedAt', 'purgedAt', 'dueAt', 'completedAt']) {
      if (n[key] != null && (typeof n[key] !== 'string' || !Number.isFinite(Date.parse(n[key] as string)))) throw new Error(`V1日時 ${key} が不正です。`);
    }
    if (!n.createdAt || !n.updatedAt) throw new Error('V1の作成/更新日時がありません。');
    if (n.type === 'memo' && (typeof n.body !== 'string' || !['active', 'completed'].includes(String(n.status)) ||
      !['task', 'idea'].includes(String(n.memoType ?? 'task')) || typeof n.duePreset !== 'string')) throw new Error('V1 Memo属性が不正です。');
    if (!n.deletedAt && !n.purgedAt) {
      const rank = canonical([n.parentId ?? null, n.sortKey]);
      if (ranks.has(rank)) throw new Error('V1兄弟rankが重複しています。原本を保持しました。');
      ranks.add(rank);
    }
    ids.set(n.id, n);
  }
  for (const n of nodes) {
    const seen = new Set([n.id]); let parent = n.parentId;
    while (parent != null) {
      if (typeof parent !== 'string' || seen.has(parent) || ids.get(parent)?.type !== 'category') throw new Error('V1親構造が不正です。');
      seen.add(parent); parent = ids.get(parent)!.parentId;
    }
  }
  return nodes;
}
