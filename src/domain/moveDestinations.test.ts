import { expect, it } from 'vitest';
import type { CategoryNode } from '@/models/node';
import { categoryMoveDestinations } from './moveDestinations';

const at = new Date(0);
const category = (id: string, parentId: string | null, sortKey: string): CategoryNode => ({ id, type: 'category', parentId, sortKey, title: id, createdAt: at, updatedAt: at, deletedAt: null });

it('移動先を親子順と深さで表示し、循環不可の行も位置を保つ', () => {
  const nodes = [category('child', 'parent', 'a'), category('sibling', null, 'b'), category('parent', null, 'a'), category('grandchild', 'child', 'a')];
  expect(categoryMoveDestinations(nodes, (id) => id !== 'child').map(({ category, depth, available }) => [category.id, depth, available])).toEqual([
    ['parent', 0, true], ['child', 1, false], ['grandchild', 2, true], ['sibling', 0, true],
  ]);
});
