import type { CategoryNode, Node } from '../models/node';
export const FOLDER_COLORS = [
  { value: 'blue', label: '青', hex: '#448ee4' },
  { value: 'yellow', label: '黄', hex: '#c89b20' },
  { value: 'green', label: '緑', hex: '#36986b' },
  { value: 'red', label: '赤', hex: '#df6565' },
  { value: 'purple', label: '紫', hex: '#a276d5' },
  { value: 'gray', label: 'グレー', hex: '#89939e' },
] as const;
export function setFolderColor(nodes: Node[], id: string, color: CategoryNode['folderColor'], now = new Date()): Node[] {
  const target = nodes.find(n => n.id === id);
  if (!target || target.type !== 'category' || target.categoryKind || target.deletedAt || target.purgedAt)
    throw new Error('通常フォルダだけ色を変更できます。');
  if (color !== null && !FOLDER_COLORS.some(c => c.value === color)) throw new Error('フォルダの色が不正です。');
  if ((target.folderColor ?? null) === color) return nodes;
  return nodes.map(n => n.id === id ? { ...target, folderColor: color, updatedAt: now } : n);
}
