import type { CategoryNode, Node } from '@/models/node';
import { compareNodes } from './nodeOperations';

export function categoryMoveDestinations(nodes: Node[], canMoveTo: (categoryId: string) => boolean) {
  const categories = nodes.filter((node): node is CategoryNode => node.type === 'category' && node.deletedAt === null && !node.purgedAt);
  const byParent = new Map<string | null, CategoryNode[]>();
  for (const category of categories) byParent.set(category.parentId, [...(byParent.get(category.parentId) ?? []), category]);
  for (const siblings of byParent.values()) siblings.sort(compareNodes);
  const result: { category: CategoryNode; depth: number; available: boolean }[] = [];
  const visited = new Set<string>();
  const visit = (category: CategoryNode, depth: number) => {
    if (visited.has(category.id)) return;
    visited.add(category.id);
    result.push({ category, depth, available: canMoveTo(category.id) });
    for (const child of byParent.get(category.id) ?? []) visit(child, depth + 1);
  };
  for (const category of byParent.get(null) ?? []) visit(category, 0);
  for (const category of categories.sort(compareNodes)) visit(category, 0);
  return result;
}
