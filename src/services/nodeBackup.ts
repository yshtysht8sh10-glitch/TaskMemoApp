import type { DuePreset, MemoStatus, Node } from "@/models/node";
import { allDeadlineGroupIds, TODAY_GRANULARITIES, type DeadlineGroupKey, type TodayGranularity } from "../domain/deadlineView";
import type { ReminderPreferences } from "@/domain/reminders";
import type { FeaturePreferences } from "@/services/featurePreferences";
import type { ListDisplayPreferences, TreeDisplayPreferences } from "./viewPreferences";
import type { ThemeMode } from "@/theme/theme";
import type { LegacyPinnedNoteCandidate } from "@/sync/taskMemoApplicationStore";

export const BACKUP_SCHEMA_VERSION = 4;
const DATE_FIELDS = [
  "createdAt",
  "updatedAt",
  "deletedAt",
  "purgedAt",
  "dueAt",
  "completedAt",
] as const;
const DUE_PRESETS = new Set<DuePreset>([
  "none",
  "today",
  "tomorrow",
  "morning",
  "afternoon",
  "thisWeek",
  "thisMonth",
  "thisYear",
  "custom",
]);
const MEMO_STATUSES = new Set<MemoStatus>(["active", "completed"]);
const PINNED_NOTE_HEIGHT_MIN = 72;
const PINNED_NOTE_HEIGHT_MAX = 280;

export type NodeBackup = {
  schemaVersion: 1 | 2 | 3 | 4;
  exportedAt: string;
  nodes?: Node[];
  pinnedNote?: { body: string; updatedAt: string };
};
export type TaskMemoBackupSettings = {
  listDisplay: ListDisplayPreferences;
  treeDisplay: TreeDisplayPreferences;
  reminders: ReminderPreferences;
  theme: ThemeMode;
  features: FeaturePreferences;
};
export type TaskMemoBackupData = { nodes: Node[]; pinnedNote: { body: string; updatedAt: Date } | null; settings: TaskMemoBackupSettings | null; legacyPinnedNoteCandidates: LegacyPinnedNoteCandidate[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const validDateString = (value: unknown, nullable = false) =>
  (nullable && value === null) ||
  (typeof value === "string" && !Number.isNaN(Date.parse(value)));

export function serializeNodeBackup(nodes: Node[], exportedAt = new Date()) {
  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: exportedAt.toISOString(),
      nodes,
    },
    null,
    2,
  );
}

export function serializeTaskMemoBackup(nodes: Node[], pinnedNote: { body: string; updatedAt: Date }, settings: TaskMemoBackupSettings, exportedAt = new Date(), legacyPinnedNoteCandidates: LegacyPinnedNoteCandidate[] = []) {
  return JSON.stringify({ schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: exportedAt.toISOString(), content: { nodes, pinnedNote, legacyPinnedNoteCandidates }, settings }, null, 2);
}

export function parseNodeBackup(raw: string): Node[] {
  return parseTaskMemoBackup(raw).nodes;
}

export function parseTaskMemoBackup(raw: string): TaskMemoBackupData {
  let backup: unknown;
  try {
    backup = JSON.parse(raw);
  } catch {
    throw new Error("JSON形式が正しくありません。");
  }
  if (!isObject(backup) || ![1, 2, 3, BACKUP_SCHEMA_VERSION].includes(backup.schemaVersion as number))
    throw new Error("対応していないバックアップ形式です。");
  const content = (backup.schemaVersion === 3 || backup.schemaVersion === 4) && isObject(backup.content) ? backup.content : backup;
  if (!validDateString(backup.exportedAt) || !Array.isArray(content.nodes))
    throw new Error("バックアップの基本情報が不正です。");

  const ids = new Set<string>();
  const records = content.nodes.map((value, index) => {
    if (!isObject(value)) throw new Error(`${index + 1}件目のNodeが不正です。`);
    if (typeof value.id !== "string" || !value.id || ids.has(value.id))
      throw new Error("Node IDが空または重複しています。");
    ids.add(value.id);
    if (value.type !== "category" && value.type !== "memo")
      throw new Error(`${value.id}のtypeが不正です。`);
    if (value.parentId !== null && typeof value.parentId !== "string")
      throw new Error(`${value.id}のparentIdが不正です。`);
    if (
      typeof value.sortKey !== "string" ||
      !value.sortKey ||
      typeof value.title !== "string"
    )
      throw new Error(`${value.id}の基本項目が不正です。`);
    if (
      !validDateString(value.createdAt) ||
      !validDateString(value.updatedAt) ||
      !validDateString(value.deletedAt, true) ||
      (value.purgedAt !== undefined && !validDateString(value.purgedAt, true))
    )
      throw new Error(`${value.id}の日付が不正です。`);
    if (value.type === "memo") {
      if (
        value.memoType !== undefined &&
        value.memoType !== "task" &&
        value.memoType !== "idea"
      )
        throw new Error(`${value.id}のMemo種別が不正です。`);
      if (
        typeof value.body !== "string" ||
        !DUE_PRESETS.has(value.duePreset as DuePreset) ||
        !MEMO_STATUSES.has(value.status as MemoStatus)
      )
        throw new Error(`${value.id}のMemo項目が不正です。`);
      if (
        !validDateString(value.dueAt, true) ||
        !validDateString(value.completedAt, true)
      )
        throw new Error(`${value.id}のMemo日付が不正です。`);
    }
    return value;
  });

  const byId = new Map(records.map((node) => [node.id as string, node]));
  for (const node of records) {
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId as string);
      if (!parent || parent.type !== "category" || node.parentId === node.id)
        throw new Error(`${node.id}の親参照が不正です。`);
      if (node.deletedAt === null && parent.deletedAt !== null)
        throw new Error(`${node.id}が削除済みCategoryを参照しています。`);
    }
    const visited = new Set<string>();
    let current: Record<string, unknown> | undefined = node;
    while (current && current.parentId !== null) {
      const parentId = current.parentId as string;
      if (visited.has(parentId))
        throw new Error("Category階層にcycleがあります。");
      visited.add(parentId);
      current = byId.get(parentId);
    }
  }

  const nodes = records.map((record) => {
    const restored = { ...record };
    for (const field of DATE_FIELDS)
      if (typeof restored[field] === "string")
        restored[field] = new Date(restored[field] as string);
    if (restored.type === "memo" && restored.memoType === undefined)
      restored.memoType = "task";
    return restored as Node;
  });
  let pinnedNote: TaskMemoBackupData["pinnedNote"] = null;
  if (backup.schemaVersion === 2 || backup.schemaVersion === 3 || backup.schemaVersion === 4) {
    if (!isObject(content.pinnedNote) || typeof content.pinnedNote.body !== "string" || !validDateString(content.pinnedNote.updatedAt))
      throw new Error("常設メモのデータが不正です。");
    pinnedNote = { body: content.pinnedNote.body, updatedAt: new Date(content.pinnedNote.updatedAt as string) };
  }
  const settings = backup.schemaVersion === 3 || backup.schemaVersion === 4 ? parseSettings(backup.settings) : null;
  let legacyPinnedNoteCandidates: LegacyPinnedNoteCandidate[] = [];
  if (backup.schemaVersion === 4) {
    if (!Array.isArray(content.legacyPinnedNoteCandidates)) throw new Error("常設メモの回復候補が不正です。");
    legacyPinnedNoteCandidates = content.legacyPinnedNoteCandidates.map((candidate) => {
      if (!isObject(candidate) || typeof candidate.body !== "string" || !validDateString(candidate.updatedAt)) throw new Error("常設メモの回復候補が不正です。");
      return { body: candidate.body, updatedAt: candidate.updatedAt as string };
    });
  }
  return { nodes, pinnedNote, settings, legacyPinnedNoteCandidates };
}

function parseSettings(value: unknown): TaskMemoBackupSettings {
  if (!isObject(value) || !isObject(value.listDisplay) || !isObject(value.treeDisplay) || !isObject(value.reminders) || !isObject(value.features))
    throw new Error("設定データが不正です。");
  const list = value.listDisplay;
  const validGroups = new Set(allDeadlineGroupIds());
  const validGranularities = new Set(TODAY_GRANULARITIES.map((item) => item.id));
  if (!Array.isArray(list.visibleGroupIds) || list.visibleGroupIds.some((id) => typeof id !== "string" || !validGroups.has(id as DeadlineGroupKey))
    || typeof list.showPinnedNote !== "boolean" || !validGranularities.has(list.todayGranularity as TodayGranularity)
    || typeof list.pinnedNoteHeight !== "number" || !Number.isFinite(list.pinnedNoteHeight)
    || list.pinnedNoteHeight < PINNED_NOTE_HEIGHT_MIN || list.pinnedNoteHeight > PINNED_NOTE_HEIGHT_MAX
    || typeof value.treeDisplay.showCompletedMemos !== "boolean"
    || typeof value.reminders.enabled !== "boolean" || typeof value.reminders.sameDay !== "boolean" || typeof value.reminders.dayBefore !== "boolean"
    || !["system", "light", "dark"].includes(value.theme as string)
    || typeof value.features.ideasEnabled !== "boolean") throw new Error("設定値が不正です。");
  return {
    listDisplay: { visibleGroupIds: [...list.visibleGroupIds] as DeadlineGroupKey[], showPinnedNote: list.showPinnedNote, todayGranularity: list.todayGranularity as TodayGranularity, pinnedNoteHeight: list.pinnedNoteHeight },
    treeDisplay: { showCompletedMemos: value.treeDisplay.showCompletedMemos },
    reminders: { enabled: value.reminders.enabled, sameDay: value.reminders.sameDay, dayBefore: value.reminders.dayBefore },
    theme: value.theme as ThemeMode,
    features: { ideasEnabled: value.features.ideasEnabled },
  };
}
