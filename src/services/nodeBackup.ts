import type { DuePreset, MemoStatus, Node } from '@/models/node';

export const BACKUP_SCHEMA_VERSION = 1;
const DATE_FIELDS = ['createdAt', 'updatedAt', 'deletedAt', 'purgedAt', 'dueAt', 'completedAt'] as const;
const DUE_PRESETS = new Set<DuePreset>(['none', 'today', 'tomorrow', 'morning', 'afternoon', 'thisWeek', 'thisMonth', 'thisYear', 'custom']);
const MEMO_STATUSES = new Set<MemoStatus>(['active', 'completed']);

export type NodeBackup = { schemaVersion: 1; exportedAt: string; nodes: Node[] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validDateString = (value: unknown, nullable = false) => (nullable && value === null) || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));

export function serializeNodeBackup(nodes: Node[], exportedAt = new Date()) {
  return JSON.stringify({ schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: exportedAt.toISOString(), nodes }, null, 2);
}

export function parseNodeBackup(raw: string): Node[] {
  let backup: unknown;
  try { backup = JSON.parse(raw); } catch { throw new Error('JSON形式が正しくありません。'); }
  if (!isObject(backup) || backup.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error('対応していないバックアップ形式です。');
  if (!validDateString(backup.exportedAt) || !Array.isArray(backup.nodes)) throw new Error('バックアップの基本情報が不正です。');

  const ids = new Set<string>();
  const records = backup.nodes.map((value, index) => {
    if (!isObject(value)) throw new Error(`${index + 1}件目のNodeが不正です。`);
    if (typeof value.id !== 'string' || !value.id || ids.has(value.id)) throw new Error('Node IDが空または重複しています。');
    ids.add(value.id);
    if (value.type !== 'category' && value.type !== 'memo') throw new Error(`${value.id}のtypeが不正です。`);
    if (value.parentId !== null && typeof value.parentId !== 'string') throw new Error(`${value.id}のparentIdが不正です。`);
    if (typeof value.sortKey !== 'string' || !value.sortKey || typeof value.title !== 'string') throw new Error(`${value.id}の基本項目が不正です。`);
    if (!validDateString(value.createdAt) || !validDateString(value.updatedAt) || !validDateString(value.deletedAt, true) ||
      (value.purgedAt !== undefined && !validDateString(value.purgedAt, true))) throw new Error(`${value.id}の日付が不正です。`);
    if (value.type === 'memo') {
      if (typeof value.body !== 'string' || !DUE_PRESETS.has(value.duePreset as DuePreset) || !MEMO_STATUSES.has(value.status as MemoStatus)) throw new Error(`${value.id}のMemo項目が不正です。`);
      if (!validDateString(value.dueAt, true) || !validDateString(value.completedAt, true)) throw new Error(`${value.id}のMemo日付が不正です。`);
    }
    return value;
  });

  const byId = new Map(records.map((node) => [node.id as string, node]));
  for (const node of records) {
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId as string);
      if (!parent || parent.type !== 'category' || node.parentId === node.id) throw new Error(`${node.id}の親参照が不正です。`);
      if (node.deletedAt === null && parent.deletedAt !== null) throw new Error(`${node.id}が削除済みCategoryを参照しています。`);
    }
    const visited = new Set<string>(); let current: Record<string, unknown> | undefined = node;
    while (current && current.parentId !== null) {
      const parentId = current.parentId as string;
      if (visited.has(parentId)) throw new Error('Category階層にcycleがあります。');
      visited.add(parentId); current = byId.get(parentId);
    }
  }

  return records.map((record) => {
    const restored = { ...record };
    for (const field of DATE_FIELDS) if (typeof restored[field] === 'string') restored[field] = new Date(restored[field] as string);
    return restored as Node;
  });
}
