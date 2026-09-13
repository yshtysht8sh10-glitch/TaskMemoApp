import { useMemo, useState } from 'react';
import DraggableFlatList, { type DragEndParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { compareNodes, visibleNodes } from '@/domain/nodeOperations';
import type { Node } from '@/models/node';
import { CategoryRow } from '@/components/CategoryRow';
import { MemoRow } from '@/components/MemoRow';

type VisibleRow = { node: Node; depth: number };
type Props = { nodes: Node[]; onEdit: (node: Node) => void; onMenu: (node: Node) => void; onDrop: (node: Node, target: Node | null) => void };
const INITIAL_EXPANDED_CATEGORY_IDS = ['personal', 'books', 'technical-books'];
function flatten(nodes: Node[], expanded: Set<string>) { const available = visibleNodes(nodes); const byParent = new Map<string | null, Node[]>(); for (const node of available) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]); for (const siblings of byParent.values()) siblings.sort(compareNodes); const rows: VisibleRow[] = []; const walk = (parentId: string | null, depth: number) => { for (const node of byParent.get(parentId) ?? []) { rows.push({ node, depth }); if (node.type === 'category' && expanded.has(node.id)) walk(node.id, depth + 1); } }; walk(null, 0); return rows; }
export function NodeTree({ nodes, onEdit, onMenu, onDrop }: Props) {
  const [renderedAt] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(() => new Set(INITIAL_EXPANDED_CATEGORY_IDS));
  const rows = useMemo(() => flatten(nodes, expanded), [nodes, expanded]);
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const drop = ({ data, from, to }: DragEndParams<VisibleRow>) => { if (from === to) return; onDrop(rows[from].node, data[to]?.node ?? null); };
  return <DraggableFlatList data={rows} keyExtractor={(row) => row.node.id} onDragEnd={drop} activationDistance={12} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 110 }} renderItem={({ item, drag, isActive }) => <ScaleDecorator activeScale={1.025}>{item.node.type === 'category' ? <CategoryRow category={item.node} depth={item.depth} isExpanded={expanded.has(item.node.id)} isActive={isActive} onToggle={() => toggle(item.node.id)} onMenu={() => onMenu(item.node)} onLongPress={drag} /> : <MemoRow memo={item.node} depth={item.depth} now={renderedAt} isActive={isActive} onPress={() => onEdit(item.node)} onMenu={() => onMenu(item.node)} onLongPress={drag} />}</ScaleDecorator>} />;
}
