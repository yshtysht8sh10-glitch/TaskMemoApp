export type NodeType = "category" | "memo";

export type QueueTaskState = {
  position: { version: number; parentId: string | null; sortKey: string };
  completion: { version: number; status: 'active' | 'completed'; completedAt: string | null };
};

export type BaseNode = {
  id: string;
  type: NodeType;
  /** null indicates that the node is directly under the root. */
  parentId: string | null;
  /** Lexicographically sortable rank within nodes that share a parentId. */
  sortKey: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  /** null indicates that the node has not been logically deleted. */
  deletedAt: Date | null;
  /** Groups nodes removed by one cascade operation so the subtree can be restored. */
  deletionBatchId?: string | null;
  /** Permanent-deletion tombstone. Purged nodes stay in sync storage but never appear in the UI. */
  purgedAt?: Date | null;
};

export type CategoryNode = BaseNode & {
  type: "category";
  /** Ordinary Category with sequential Task visibility; missing means a normal folder. */
  taskQueue?: boolean;
  /** Null restores the legacy icon. */
  folderColor?: "blue" | "yellow" | "green" | "red" | "purple" | "gray" | null;
  categoryKind?:
    | "routineRoot"
    | "routineDaily"
    | "routineWeekly"
    | "routineMonthly"
    | "routineYearly";
  routineWeekday?: number;
  routineDayOfMonth?: number;
  /** JavaScript month index (0-11) used with routineDayOfMonth. */
  routineMonth?: number;
};

export type DuePreset =
  | "none"
  | "today"
  | "tomorrow"
  | "morning"
  | "afternoon"
  | "thisWeek"
  | "thisMonth"
  | "thisYear"
  | "custom";

export type MemoStatus = "active" | "completed";
export type MemoType = "task" | "idea";

export type RepeatFrequency = "day" | "week" | "month" | "year";

export type RepeatRule = {
  frequency: RepeatFrequency;
  interval: number;
  /** Local calendar date (YYYY-MM-DD) that anchors the interval. */
  startsOn: string;
  weekdays?: number[];
  dayOfMonth?: number;
  nthWeekday?: { ordinal: number; weekday: number };
};

export type MemoNode = BaseNode & {
  type: "memo";
  /** Independent placement/completion registers for Tasks that have participated in a queue. */
  queueState?: QueueTaskState;
  /** Missing on legacy data; absence is interpreted as `task`. */
  memoType?: MemoType;
  /** Manual ordering used by the deadline list, independent of tree order. */
  deadlineSortKey?: string;
  /** Independent deadline-list ranks per Routine date; projections remain transient. */
  routineDeadlineSortKeys?: Record<string, string>;
  body: string;
  /** The authoritative instant used for due-date checks. */
  dueAt: Date | null;
  /** The UI choice from which dueAt was derived. */
  duePreset: DuePreset;
  status: MemoStatus;
  completedAt: Date | null;
  /** Completion timestamps keyed by the local calendar date (YYYY-MM-DD). */
  /** ISO completion timestamp, or null as a synchronized completion-cancellation tombstone. */
  routineHistory?: Record<string, string | null>;
  /** Atomic per-date result. Missing dates fall back to legacy routineHistory.
   * Pending is a durable cancellation; version advances for Undo/Redo too. */
  routineOutcomes?: Record<string, RoutineOutcome>;
  /** Per-occurrence due time. Null cancels an override during sync/undo. */
  routineDueOverrides?: Record<string, string | null>;
  /** Transient list projection for a missed occurrence; never persisted. */
  routineOccurrenceKey?: string;
  routineSourceId?: string;
  repeatRule?: RepeatRule | null;
  /** Definition lifecycle, separate from daily outcomes. Missing means active. */
  routineLifecycle?: {
    version: number;
    periods: { completedAt: string; resumedAt: string | null; retained: Record<string, string> }[];
  };
};

export type Node = CategoryNode | MemoNode;

export type RoutineOutcome = {
  state: 'completed' | 'skipped' | 'pending';
  changedAt: string;
  version: number;
};
