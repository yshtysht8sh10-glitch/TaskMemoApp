import type { DuePreset, RepeatRule } from '../models/node';
import type { VersionedNode, SyncNodeValue, SyncOperationType } from '../sync/types';

/** Shared by the parser, tests and the generated manual tables. */
export const TEXT_COLUMNS = ['ref', 'type', 'title', 'due', 'completion', 'body', 'routine'] as const;
export const TEXT_TYPES = ['Category', 'Task', 'Idea'] as const;
export const COMPLETION_VALUES = ['未完了', '完了'] as const;
export const RELATIVE_DUE_VALUES = ['今日', '明日', '明後日', '今週', '来週', '今月', '来月', '今年', '午前', '午後', '期限なし'] as const;
export const ROUTINE_FREQUENCIES = ['day', 'week', 'month', 'year'] as const;
export const SYSTEM_REGIONS = ['@root', '@routine'] as const;
export const ROUTINE_ALIASES = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } as const;
export const TEXT_ERRORS = {
  syntax: '列数・escape・ref・インデントを確認してください。',
  type: '種別はCategory / Task / Ideaです。',
  title: '空のタイトルは保存できません。',
  due: '期限は許可された相対表現または実在する絶対日時で指定してください。',
  completion: '完了状態は未完了 / 完了です。',
  routine: 'Routineはday/week/month/year interval=N startsOn=YYYY-MM-DDです。',
  hierarchy: '親は有効なCategoryでなければなりません。',
  ref: 'refはこのsessionの既存Nodeを重複なく参照してください。',
  identity: 'ref欠落と新規行が併存しています。既存refを復元するか、削除と追加を別保存にしてください。',
  protected: 'システムNode・種別変換・実績・非対応属性の変更は制限されています。',
  conflict: 'Domainが編集開始後に変わりました。入力を保持して再確認してください。',
} as const;
export type TextError = { code: keyof typeof TEXT_ERRORS; line: number; cell: number; message: string };
export type TextCell = { value: string; start: number; end: number };
export type TextRow = { line: number; depth: number; region?: 'root' | 'routine'; cells: TextCell[]; ref: string | null; type: typeof TEXT_TYPES[number]; title: string; due?: string; completion?: string; body?: string; routine?: string; parentRow: number | null };
export type TextDocument = { rows: TextRow[]; errors: TextError[]; regions?: { line: number; name: 'root' | 'routine' }[] };
export type TextContext = { now: string; timeZone: string };
export type TextSession = {
  version: 1; id: string; scope: string; view: 'tree' | 'list'; context: TextContext;
  baseline: VersionedNode[]; refs: Record<string, string>; orderedIds: string[];
  /** Explicit projection order/groups from the entrance View, never hierarchy. */
  listGroups: Record<string, string>; newParentId: string | null;
  baselineCells: Record<string, string[]>;
  systemRegions?: boolean;
  routineRootId?: string | null;
};
export type ResolvedDue = { dueAt: string | null; duePreset: DuePreset };
export type ValidatedRow = TextRow & { resolvedDue?: ResolvedDue; repeatRule?: RepeatRule | null };
export type ValidatedDocument = { rows: ValidatedRow[]; errors: TextError[] };
export type TextChange = { id: string; type: SyncOperationType; before: SyncNodeValue | null; after: SyncNodeValue; fields: string[]; line: number };
export type TextPlan = { session: TextSession; document: string; changes: TextChange[]; errors: TextError[]; fingerprint: string; deletedIds: string[]; requiresConfirmation: boolean };

export const errorAt = (code: TextError['code'], line: number, cell: number, message: string = TEXT_ERRORS[code]): TextError => ({ code, line, cell, message });
/** Stable exact fingerprint, not a hash/token: comparison is collision-free. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
