import {
  completeMemo as completeMemoOperation,
  createNode,
  restoreNode,
  softDeleteNode,
  updateNode,
} from '../domain/nodeOperations';
import type { MemoNode, Node } from '../models/node';
import type {
  CategoryView,
  CreateMemoInput,
  ListMemosInput,
  MemoSelector,
  MemoView,
  UpdateMemoInput,
} from './contracts';
import { ExternalAiError } from './errors';
import type { AuthenticatedTaskMemoUser, TaskMemoNodeRepository } from './repository';

const requireUser = (user: AuthenticatedTaskMemoUser) => {
  if (!user.uid.trim()) throw new ExternalAiError('auth', '認証済みユーザーを確認できません。');
  return user.uid;
};

const parseInstant = (value: string | null | undefined, field: string) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ExternalAiError('validation', `${field}はタイムゾーンを含む有効な日時にしてください。`);
  return date;
};

const memoView = (memo: MemoNode, nodes: readonly Node[], revisions: Record<string, number> = {}): MemoView => {
  const parent = memo.parentId ? nodes.find((node) => node.id === memo.parentId && node.type === 'category') : undefined;
  return {
    id: memo.id,
    title: memo.title,
    body: memo.body,
    parentId: memo.parentId,
    categoryTitle: parent?.title ?? null,
    sortKey: memo.sortKey,
    dueAt: memo.dueAt?.toISOString() ?? null,
    duePreset: memo.duePreset,
    status: memo.status,
    completedAt: memo.completedAt?.toISOString() ?? null,
    deletedAt: memo.deletedAt?.toISOString() ?? null,
    createdAt: memo.createdAt.toISOString(),
    updatedAt: memo.updatedAt.toISOString(),
    revision: revisions[memo.id] ?? 0,
  };
};

function candidates(nodes: readonly Node[], title: string, includeDeleted: boolean) {
  const normalized = title.trim().toLocaleLowerCase();
  return nodes.filter((node): node is MemoNode => node.type === 'memo'
    && !node.purgedAt
    && (includeDeleted || node.deletedAt === null)
    && node.title.trim().toLocaleLowerCase() === normalized);
}

function resolveMemo(nodes: readonly Node[], selector: MemoSelector, includeDeleted = false, revisions: Record<string, number> = {}) {
  let matches: MemoNode[];
  if (selector.memoId) {
    matches = nodes.filter((node): node is MemoNode => node.id === selector.memoId
      && node.type === 'memo' && !node.purgedAt && (includeDeleted || node.deletedAt === null));
  } else if (selector.title?.trim()) {
    matches = candidates(nodes, selector.title, includeDeleted);
  } else {
    throw new ExternalAiError('validation', 'memoIdを指定してください。表示名で探す場合はtitleを指定できます。');
  }
  if (!matches.length) throw new ExternalAiError('not_found', '対象のMemoが見つかりません。');
  if (matches.length > 1) {
    throw new ExternalAiError(
      'conflict',
      '同名のMemoが複数あります。候補のidを指定してやり直してください。',
      matches.map((memo) => memoView(memo, nodes, revisions)),
    );
  }
  return matches[0];
}

function assertActiveParent(nodes: readonly Node[], parentId: string | null | undefined) {
  if (parentId === undefined || parentId === null) return;
  const parent = nodes.find((node) => node.id === parentId && node.type === 'category' && node.deletedAt === null && !node.purgedAt);
  if (!parent) throw new ExternalAiError('validation', '指定したCategoryが見つからないか、利用できません。');
}

export class TaskMemoApplicationService {
  constructor(
    private readonly repository: TaskMemoNodeRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: (requestId?: string) => string = (requestId) => requestId ? `memo-ai-${requestId}` : `memo-${crypto.randomUUID()}`,
  ) {}

  async listMemos(user: AuthenticatedTaskMemoUser, input: ListMemosInput = {}) {
    const { nodes, revisions } = await this.repository.read(requireUser(user));
    const from = parseInstant(input.from, 'from');
    const to = parseInstant(input.to, 'to');
    if (from && to && from > to) throw new ExternalAiError('validation', 'fromはto以前にしてください。');
    return nodes.filter((node): node is MemoNode => node.type === 'memo'
      && !node.purgedAt
      && (input.includeDeleted ? true : node.deletedAt === null)
      && (!input.status || input.status === 'all' || node.status === input.status)
      && (!from || (!!node.dueAt && node.dueAt >= from))
      && (!to || (!!node.dueAt && node.dueAt <= to)))
      .sort((a, b) => (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER))
      .map((memo) => memoView(memo, nodes, revisions));
  }

  async getMemo(user: AuthenticatedTaskMemoUser, selector: MemoSelector) {
    const { nodes, revisions } = await this.repository.read(requireUser(user));
    return memoView(resolveMemo(nodes, selector, true, revisions), nodes, revisions);
  }

  async createMemo(user: AuthenticatedTaskMemoUser, input: CreateMemoInput) {
    const uid = requireUser(user);
    if (!input.title?.trim()) throw new ExternalAiError('validation', 'titleは必須です。');
    const dueAt = parseInstant(input.dueAt, 'dueAt');
    return this.repository.transact(uid, ({ nodes, revisions }) => {
      assertActiveParent(nodes, input.parentId);
      const now = this.now();
      const id = this.createId(input.requestId);
      const next = createNode(nodes, 'memo', {
        title: input.title,
        body: input.body,
        parentId: input.parentId ?? null,
        dueAt,
        duePreset: input.duePreset,
      }, now, id);
      return { nodes: next, result: memoView(resolveMemo(next, { memoId: id }), next, { ...revisions, [id]: 1 }) };
    }, { operation: 'create_memo', requestId: input.requestId, producerId: user.producerId ?? user.uid });
  }

  async updateMemo(user: AuthenticatedTaskMemoUser, input: UpdateMemoInput) {
    const uid = requireUser(user);
    const dueAt = parseInstant(input.dueAt, 'dueAt');
    if (input.newTitle !== undefined && !input.newTitle.trim()) throw new ExternalAiError('validation', 'newTitleを空にはできません。');
    return this.repository.transact(uid, ({ nodes, revisions }) => {
      const memo = resolveMemo(nodes, input, false, revisions);
      assertActiveParent(nodes, input.parentId);
      const moved = input.parentId !== undefined && input.parentId !== memo.parentId
        ? updateNode(nodes, memo.id, { parentId: input.parentId }, this.now())
        : nodes;
      const next = updateNode(moved, memo.id, {
        title: input.newTitle,
        body: input.body,
        dueAt,
        duePreset: input.duePreset,
      }, this.now());
      return { nodes: next, result: memoView(resolveMemo(next, { memoId: memo.id }), next, { ...revisions, [memo.id]: (revisions[memo.id] ?? 0) + 1 }) };
    }, { operation: 'update_memo', requestId: input.requestId, producerId: user.producerId ?? user.uid, expectedRevision: input.expectedRevision });
  }

  async completeMemo(user: AuthenticatedTaskMemoUser, selector: MemoSelector) {
    const uid = requireUser(user);
    return this.repository.transact(uid, ({ nodes, revisions }) => {
      const memo = resolveMemo(nodes, selector, false, revisions);
      if (memo.status === 'completed') return { nodes, result: memoView(memo, nodes, revisions) };
      const next = completeMemoOperation(nodes, memo.id, this.now());
      return { nodes: next, result: memoView(resolveMemo(next, { memoId: memo.id }), next, { ...revisions, [memo.id]: (revisions[memo.id] ?? 0) + 1 }) };
    }, { operation: 'complete_memo', requestId: selector.requestId, producerId: user.producerId ?? user.uid, expectedRevision: selector.expectedRevision });
  }

  async deleteMemo(user: AuthenticatedTaskMemoUser, selector: MemoSelector) {
    const uid = requireUser(user);
    return this.repository.transact(uid, ({ nodes, revisions }) => {
      const memo = resolveMemo(nodes, selector, false, revisions);
      const next = softDeleteNode(nodes, memo.id, false, this.now());
      return { nodes: next, result: memoView(resolveMemo(next, { memoId: memo.id }, true), next, { ...revisions, [memo.id]: (revisions[memo.id] ?? 0) + 1 }) };
    }, { operation: 'delete_memo', requestId: selector.requestId, producerId: user.producerId ?? user.uid, expectedRevision: selector.expectedRevision });
  }

  async restoreMemo(user: AuthenticatedTaskMemoUser, selector: MemoSelector) {
    const uid = requireUser(user);
    return this.repository.transact(uid, ({ nodes, revisions }) => {
      const memo = resolveMemo(nodes, selector, true, revisions);
      if (!memo.deletedAt) throw new ExternalAiError('conflict', 'このMemoは削除されていません。');
      const next = restoreNode(nodes, memo.id, this.now());
      return { nodes: next, result: memoView(resolveMemo(next, { memoId: memo.id }), next, { ...revisions, [memo.id]: (revisions[memo.id] ?? 0) + 1 }) };
    }, { operation: 'restore_memo', requestId: selector.requestId, producerId: user.producerId ?? user.uid, expectedRevision: selector.expectedRevision });
  }

  async listCategories(user: AuthenticatedTaskMemoUser): Promise<CategoryView[]> {
    const { nodes, revisions } = await this.repository.read(requireUser(user));
    return nodes.filter((node) => node.type === 'category' && node.deletedAt === null && !node.purgedAt)
      .map((node) => ({ id: node.id, title: node.title, parentId: node.parentId, sortKey: node.sortKey, revision: revisions[node.id] ?? 0 }));
  }
}
