export type NodeType = 'category' | 'memo';

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
  type: 'category';
  categoryKind?: 'routineRoot' | 'routineDaily' | 'routineWeekly' | 'routineMonthly' | 'routineYearly';
  routineWeekday?: number;
  routineDayOfMonth?: number;
  /** JavaScript month index (0-11) used with routineDayOfMonth. */
  routineMonth?: number;
};

export type DuePreset =
  | 'none'
  | 'today'
  | 'tomorrow'
  | 'morning'
  | 'afternoon'
  | 'thisWeek'
  | 'thisMonth'
  | 'thisYear'
  | 'custom';

export type MemoStatus = 'active' | 'completed';

export type MemoNode = BaseNode & {
  type: 'memo';
  /** Manual ordering used by the deadline list, independent of tree order. */
  deadlineSortKey?: string;
  body: string;
  /** The authoritative instant used for due-date checks. */
  dueAt: Date | null;
  /** The UI choice from which dueAt was derived. */
  duePreset: DuePreset;
  status: MemoStatus;
  completedAt: Date | null;
  /** Completion timestamps keyed by the local calendar date (YYYY-MM-DD). */
  routineHistory?: Record<string, string>;
};

export type Node = CategoryNode | MemoNode;
