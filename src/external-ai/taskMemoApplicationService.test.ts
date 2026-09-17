import { describe, expect, it } from 'vitest';

import type { Node } from '@/models/node';
import { ExternalAiError } from './errors';
import type { TaskMemoNodeRepository } from './repository';
import { TaskMemoApplicationService } from './taskMemoApplicationService';

class MemoryRepository implements TaskMemoNodeRepository {
  constructor(public readonly users: Record<string, Node[]>) {}
  async read(uid: string) { return structuredClone(this.users[uid] ?? []); }
  async transact<T>(uid: string, mutate: (nodes: Node[]) => { nodes: Node[]; result: T }) {
    const changed = mutate(structuredClone(this.users[uid] ?? []));
    this.users[uid] = changed.nodes;
    return changed.result;
  }
}

const now = new Date('2026-09-16T03:00:00.000Z');
const category = (id: string, title: string): Node => ({ id, type: 'category', parentId: null, sortKey: 'a0', title, createdAt: now, updatedAt: now, deletedAt: null });
const memo = (id: string, title: string, parentId: string | null = null): Node => ({ id, type: 'memo', parentId, sortKey: 'a0', title, body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, createdAt: now, updatedAt: now, deletedAt: null });

describe('TaskMemoApplicationService', () => {
  it('uses only the authenticated UID and cannot cross user boundaries', async () => {
    const repository = new MemoryRepository({ a: [memo('a1', 'A')], b: [memo('b1', 'B')] });
    const service = new TaskMemoApplicationService(repository, () => now, () => 'new');
    expect((await service.listMemos({ uid: 'a' })).map((item) => item.title)).toEqual(['A']);
    await expect(service.getMemo({ uid: 'a' }, { memoId: 'b1' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('creates a memo through existing node rules and returns a stable ID', async () => {
    const repository = new MemoryRepository({ a: [category('c', '仕事')] });
    const service = new TaskMemoApplicationService(repository, () => now, () => 'memo-fixed');
    const created = await service.createMemo({ uid: 'a' }, { title: '電話', parentId: 'c', dueAt: '2026-09-17T00:00:00+09:00', duePreset: 'morning' });
    expect(created).toMatchObject({ id: 'memo-fixed', title: '電話', parentId: 'c', categoryTitle: '仕事', duePreset: 'morning' });
    expect(repository.users.a.find((node) => node.id === 'memo-fixed')?.sortKey).toBeTruthy();
  });

  it('updates parent and fields together without bypassing sort-key generation', async () => {
    const repository = new MemoryRepository({ a: [category('c', '仕事'), memo('m', '旧')] });
    const service = new TaskMemoApplicationService(repository, () => now);
    const updated = await service.updateMemo({ uid: 'a' }, { memoId: 'm', parentId: 'c', newTitle: '新', body: '本文' });
    expect(updated).toMatchObject({ id: 'm', parentId: 'c', title: '新', body: '本文' });
    expect(repository.users.a.find((node) => node.id === 'm')?.sortKey).toBeTruthy();
  });

  it('refuses ambiguous title mutations and returns candidates', async () => {
    const repository = new MemoryRepository({ a: [memo('m1', '牛乳を買う'), memo('m2', '牛乳を買う')] });
    const service = new TaskMemoApplicationService(repository, () => now);
    await expect(service.completeMemo({ uid: 'a' }, { title: '牛乳を買う' })).rejects.toMatchObject({
      code: 'conflict', candidates: [{ id: 'm1' }, { id: 'm2' }],
    });
    expect(repository.users.a.every((node) => node.type !== 'memo' || node.status === 'active')).toBe(true);
  });

  it('only soft-deletes and can restore without exposing purged nodes', async () => {
    const purged = { ...memo('purged', '消去済み'), deletedAt: now, purgedAt: now };
    const repository = new MemoryRepository({ a: [memo('m1', '対象'), purged] });
    const service = new TaskMemoApplicationService(repository, () => now);
    const deleted = await service.deleteMemo({ uid: 'a' }, { memoId: 'm1' });
    expect(deleted.deletedAt).toBe(now.toISOString());
    expect(repository.users.a.find((node) => node.id === 'm1')?.purgedAt).toBeUndefined();
    await expect(service.getMemo({ uid: 'a' }, { memoId: 'purged' })).rejects.toBeInstanceOf(ExternalAiError);
    expect((await service.restoreMemo({ uid: 'a' }, { memoId: 'm1' })).deletedAt).toBeNull();
  });

  it('rejects invalid parents and invalid date ranges', async () => {
    const service = new TaskMemoApplicationService(new MemoryRepository({ a: [] }), () => now);
    await expect(service.createMemo({ uid: 'a' }, { title: 'x', parentId: 'missing' })).rejects.toMatchObject({ code: 'validation' });
    await expect(service.listMemos({ uid: 'a' }, { from: '2026-09-18T00:00:00Z', to: '2026-09-17T00:00:00Z' })).rejects.toMatchObject({ code: 'validation' });
  });
});
