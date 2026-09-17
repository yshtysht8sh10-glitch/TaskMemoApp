import type { DuePreset, MemoStatus } from '../models/node';

export type MemoSelector = { memoId?: string; title?: string };

export type ListMemosInput = {
  from?: string;
  to?: string;
  status?: MemoStatus | 'all';
  includeDeleted?: boolean;
};

export type CreateMemoInput = {
  title: string;
  body?: string;
  parentId?: string | null;
  dueAt?: string | null;
  duePreset?: DuePreset;
};

export type UpdateMemoInput = MemoSelector & {
  newTitle?: string;
  body?: string;
  parentId?: string | null;
  dueAt?: string | null;
  duePreset?: DuePreset;
};

export type MemoView = {
  id: string;
  title: string;
  body: string;
  parentId: string | null;
  categoryTitle: string | null;
  sortKey: string;
  dueAt: string | null;
  duePreset: DuePreset;
  status: MemoStatus;
  completedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CategoryView = {
  id: string;
  title: string;
  parentId: string | null;
  sortKey: string;
};
