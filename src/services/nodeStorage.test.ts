import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoNode } from '@/models/node';
import { loadNodes, saveNodes } from './nodeStorage';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
} }));

const date = new Date('2026-09-17T00:00:00.000Z');
const memo = (memoType?: MemoNode['memoType']): MemoNode => ({ id: memoType ?? 'legacy', type: 'memo', memoType, parentId: null, sortKey: 'a0', title: 'Memo', body: '', dueAt: null, duePreset: 'none', status: 'active', completedAt: null, repeatRule: null, createdAt: date, updatedAt: date, deletedAt: null });

describe('Node AsyncStorage', () => {
  beforeEach(() => storage.clear());
  it('Task/Idea種別を往復し、旧MemoはTaskへ正規化する', async () => { await saveNodes([memo('task'), { ...memo('idea'), id: 'idea' }, { ...memo(), id: 'legacy' }]); const loaded = await loadNodes([]); expect(loaded.filter((node) => node.type === 'memo').map((node) => node.memoType)).toEqual(['task', 'idea', 'task']); });
});
