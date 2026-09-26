import { describe, expect, it } from 'vitest';
import { generateNKeysBetween } from 'fractional-indexing';
import type { CategoryNode } from '../models/node';
import { createNode, restoreNode } from './nodeOperations';
import { isValidSortKey, normalizeNodeSortKeys } from './sortKeys';

const now = new Date('2026-09-26T00:00:00.000Z');
const category = (id: string, sortKey: string, deletedAt: Date | null = null): CategoryNode => ({
  id, type: 'category', parentId: null, sortKey, title: id, createdAt: now, updatedAt: now, deletedAt,
});

describe('minimal active sortKey repair', () => {
  it('keeps 54 valid siblings unchanged when one key is duplicated', () => {
    const keys = generateNKeysBetween(null, null, 54);
    const nodes = [...keys.map((key, index) => category(`node-${index}`, key)), category('duplicate', keys[20])];
    const fixed = normalizeNodeSortKeys(nodes);
    expect(fixed.filter((node, index) => node.sortKey !== nodes[index].sortKey)).toHaveLength(1);
    expect(new Set(fixed.map((node) => node.sortKey)).size).toBe(55);
    expect(normalizeNodeSortKeys(fixed)).toBe(fixed);
  });

  it('does not reassign a deleted sibling when a new active node reuses its key', () => {
    const keys = generateNKeysBetween(null, null, 55);
    const nodes = keys.map((key, index) => category(`node-${index}`, key, index === 54 ? now : null));
    const created = createNode(nodes, 'memo', { title: 'new', parentId: null }, now, 'new');
    expect(created.at(-1)?.sortKey).toBe(nodes.at(-1)?.sortKey);
    expect(normalizeNodeSortKeys(created)).toBe(created);
  });

  it('repairs only an invalid active key and leaves tombstones untouched', () => {
    const keys = generateNKeysBetween(null, null, 54);
    const nodes = [...keys.map((key, index) => category(`node-${index}`, key)), category('invalid', 'zzzz'), category('deleted-invalid', 'zzzz', now)];
    const fixed = normalizeNodeSortKeys(nodes);
    expect(fixed.filter((node, index) => node.sortKey !== nodes[index].sortKey).map((node) => node.id)).toEqual(['invalid']);
    expect(fixed.at(-1)?.sortKey).toBe('zzzz');
    expect(isValidSortKey(fixed.at(-2)!.sortKey)).toBe(true);
    expect(normalizeNodeSortKeys(fixed)).toBe(fixed);
  });

  it('assigns a new key to a restored tombstone rather than rewriting its active sibling', () => {
    const active = category('z-active', 'a0');
    const deleted = category('a-deleted', 'a0', now);
    const restored = restoreNode([active, deleted], deleted.id, now);
    expect(restored[0].sortKey).toBe('a0');
    expect(restored[1].sortKey).not.toBe('a0');
    expect(normalizeNodeSortKeys(restored)).toBe(restored);
  });
});
