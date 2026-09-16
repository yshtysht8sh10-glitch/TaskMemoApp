import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DraggableFlatList, { type DragEndParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { flattenVisibleNodes, UNASSIGNED_GROUP_ID, type VisibleTreeRow } from '@/domain/treeView';
import { dropCandidateFor, resolveDropCandidate, type DropCandidate } from '@/domain/treeDrop';
import type { Node } from '@/models/node';
import { CategoryRow } from '@/components/CategoryRow';
import { MemoRow } from '@/components/MemoRow';
import { measureAllTreeRows, TreeRowDiagnostics } from '@/components/TreeRowDiagnostics';
import { beginTreeDragTrace, nextTreeMountId, nodesRevision, summarizeNodes, summarizeRows, treeDiagnosticLog } from '@/components/treeDiagnostics';
import { useAppTheme, type ThemeColors } from '@/theme/theme';
import { WebSortableScrollList } from '@/components/WebSortableScrollList';
import { routineCategoryForMemo } from '@/domain/routine';

export type VisibleRow = VisibleTreeRow;
export type { DropCandidate } from '@/domain/treeDrop';
type Props = { nodes: Node[]; completingIds: ReadonlySet<string>; onCompletionAnimationFinished: (id: string) => void; onAddMemo: (parentId: string | null) => void; onEdit: (node: Node) => void; onComplete: (memo: import('@/models/node').MemoNode) => void; onMenu: (node: Node) => void; onDrop: (nodeId: string, candidate: DropCandidate) => void; onBulkMove: (memoIds: string[]) => void };
const INITIAL_EXPANDED_CATEGORY_IDS = [UNASSIGNED_GROUP_ID, 'personal', 'books', 'technical-books'];
let retainedExpandedCategoryIds = new Set(INITIAL_EXPANDED_CATEGORY_IDS);

export function NodeTree({ nodes, completingIds, onCompletionAnimationFinished, onAddMemo, onEdit, onComplete, onMenu, onDrop, onBulkMove }: Props) {
  const { colors } = useAppTheme(); const styles = createStyles(colors);
  const [mountId] = useState(nextTreeMountId);
  const viewportRef = useRef<View>(null); const scrollOffsetRef = useRef(0);
  const [renderedAt] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(() => new Set(retainedExpandedCategoryIds));
  const [candidate, setCandidate] = useState<DropCandidate | null>(null);
  const [selectionMode, setSelectionMode] = useState(false); const [selectedMemoIds, setSelectedMemoIds] = useState(() => new Set<string>());
  const movingId = useRef<string | null>(null);
  const candidateRef = useRef<DropCandidate | null>(null);
  const rows = useMemo(() => flattenVisibleNodes(nodes, expanded), [nodes, expanded]);
  const categoryIds = useMemo(() => [UNASSIGNED_GROUP_ID, ...nodes.filter((node) => node.type === 'category' && node.deletedAt === null).map((node) => node.id)], [nodes]);
  const orderedKeys = useMemo(() => rows.map((row) => row.node.id), [rows]);
  const revision = useMemo(() => nodesRevision(nodes), [nodes]);
  useEffect(() => { treeDiagnosticLog('tree-render', { mountId, nodesRevision: revision, nodes: summarizeNodes(nodes), treeRows: summarizeRows(rows), keys: orderedKeys, expanded: [...expanded] }); }, [expanded, mountId, nodes, orderedKeys, revision, rows]);
  useEffect(() => () => { retainedExpandedCategoryIds = new Set(expanded); }, [expanded]);
  useEffect(() => { treeDiagnosticLog('tree-mount', { mountId }); return () => treeDiagnosticLog('tree-unmount', { mountId }); }, [mountId]);
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleSelected = (id: string) => setSelectedMemoIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectionTools = <><Pressable style={styles.tool} onPress={() => { setSelectionMode((current) => !current); setSelectedMemoIds(new Set()); }}><Text style={styles.toolText}>{selectionMode ? '選択終了' : '複数選択'}</Text></Pressable>{selectionMode && <><Text style={{ color: colors.textSecondary, fontSize: 11 }}>{selectedMemoIds.size}件選択</Text><Pressable disabled={selectedMemoIds.size === 0} style={[styles.tool, selectedMemoIds.size === 0 && { opacity: 0.4 }]} onPress={() => { onBulkMove([...selectedMemoIds]); setSelectionMode(false); setSelectedMemoIds(new Set()); }}><Text style={styles.toolText}>移動</Text></Pressable></>}</>;
  const updateCandidate = (index: number, data = rows) => { const target = data[index]?.node; const next = movingId.current ? dropCandidateFor(nodes, movingId.current, target) : null; candidateRef.current = next; setCandidate(next); treeDiagnosticLog('placeholder-change', { index, movingId: movingId.current, targetId: target?.id ?? null, candidate: next }); };
  const drop = ({ data, from, to }: DragEndParams<VisibleRow>) => {
    const id = movingId.current;
    // The returned array already contains the moving row at `to`, so it is not
    // a reliable target. Keep the ID-based candidate captured during hovering.
    const hoverCandidate = candidateRef.current;
    const finalCandidate = id && hoverCandidate ? resolveDropCandidate(nodes, id, hoverCandidate, data) : null;
    const movingBefore = nodes.find((node) => node.id === id);
    treeDiagnosticLog('drag-end-before-state', { from, to, movingId: id, hoverCandidate, candidate: finalCandidate, movingBefore: movingBefore ? { parentId: movingBefore.parentId, sortKey: movingBefore.sortKey } : null, nodesRevision: revision, libraryDataKeys: data.map((row) => row.node.id), nodes: summarizeNodes(nodes), treeRows: summarizeRows(rows) });
    measureAllTreeRows('drop');
    movingId.current = null; candidateRef.current = null; setCandidate(null);
    if (id && finalCandidate) onDrop(id, finalCandidate);
  };
  if (Platform.OS === 'web') return <View style={styles.container}>
    <View style={styles.toolbar}>{selectionTools}<Pressable style={styles.tool} onPress={() => setExpanded(new Set(categoryIds))} accessibilityLabel="すべて開く"><Text style={styles.toolText}>すべて開く</Text></Pressable><Pressable style={styles.tool} onPress={() => setExpanded(new Set())} accessibilityLabel="すべて閉じる"><Text style={styles.toolText}>すべて閉じる</Text></Pressable></View>
    <WebSortableScrollList data={rows} keyFor={(row) => row.node.id} canDrag={(row) => !selectionMode && !row.virtual}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 110 }}
      onHover={(active, target) => { movingId.current = active.node.id; const next = dropCandidateFor(nodes, active.node.id, target.node); candidateRef.current = next; setCandidate(next); }}
      onDrop={(active, target) => { const next = dropCandidateFor(nodes, active.node.id, target.node); candidateRef.current = null; setCandidate(null); if (next) onDrop(active.node.id, next); }}
      renderItem={(item, isActive) => {
        const isTarget = candidate?.targetId === item.node.id; const treeProps = { depth: item.depth, ancestorContinuation: item.ancestorContinuation, hasNextSibling: item.hasNextSibling };
        return item.node.type === 'category' ? <CategoryRow category={item.node} {...treeProps} virtual={!!item.virtual} isExpanded={expanded.has(item.node.id)} isActive={isActive} isDropInside={isTarget && candidate?.kind === 'inside'} showInsertBefore={isTarget && candidate?.kind === 'before'} onToggle={() => toggle(item.node.id)} onAddMemo={() => onAddMemo(item.virtual ? null : item.node.id)} onMenu={() => onMenu(item.node)} onLongPress={() => {}} /> : <MemoRow memo={item.node} {...treeProps} now={renderedAt} isActive={isActive} showInsertBefore={isTarget && candidate?.kind === 'before'} completing={completingIds.has(item.node.id)} routine={!!routineCategoryForMemo(nodes, item.node)} selectionMode={selectionMode} selected={selectedMemoIds.has(item.node.id)} onToggleSelected={() => toggleSelected(item.node.id)} onCompletionAnimationFinished={() => onCompletionAnimationFinished(item.node.id)} onPress={() => onEdit(item.node)} onComplete={() => item.node.type === 'memo' && onComplete(item.node)} onMenu={() => onMenu(item.node)} onLongPress={() => {}} />;
      }} />
  </View>;
  return <View style={styles.container}>
    <View style={styles.toolbar}>{selectionTools}<Pressable style={styles.tool} onPress={() => setExpanded(new Set(categoryIds))} accessibilityLabel="すべて開く"><Text style={styles.toolText}>すべて開く</Text></Pressable><Pressable style={styles.tool} onPress={() => setExpanded(new Set())} accessibilityLabel="すべて閉じる"><Text style={styles.toolText}>すべて閉じる</Text></Pressable></View>
    <View ref={viewportRef} collapsable={false} style={styles.listViewport}>
      <DraggableFlatList data={rows} keyExtractor={(row) => row.node.id}
        onDragBegin={(index) => { movingId.current = rows[index]?.virtual ? null : rows[index]?.node.id ?? null; if (movingId.current) beginTreeDragTrace(movingId.current); treeDiagnosticLog('drag-begin', { mountId, index, movingId: movingId.current, nodes: summarizeNodes(nodes), treeRows: summarizeRows(rows), keys: orderedKeys }); updateCandidate(index); }}
        onPlaceholderIndexChange={updateCandidate} onRelease={(index) => { treeDiagnosticLog('drag-release', { index, movingId: movingId.current, candidate: candidateRef.current }); measureAllTreeRows('release'); }} onDragEnd={drop}
        onScrollOffsetChange={(offset) => { scrollOffsetRef.current = offset; }} activationDistance={16} autoscrollThreshold={70} autoscrollSpeed={85}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 110 }} renderItem={({ item, drag, isActive, getIndex }) => {
    const isTarget = candidate?.targetId === item.node.id;
    const treeProps = { depth: item.depth, ancestorContinuation: item.ancestorContinuation, hasNextSibling: item.hasNextSibling };
    return <TreeRowDiagnostics rowKey={item.node.id} index={getIndex() ?? -1} orderedKeys={orderedKeys} viewportRef={viewportRef} scrollOffsetRef={scrollOffsetRef} revision={revision}>
      <ScaleDecorator activeScale={1.025}>{item.node.type === 'category' ? <CategoryRow category={item.node} {...treeProps} virtual={!!item.virtual} isExpanded={expanded.has(item.node.id)} isActive={isActive} isDropInside={isTarget && candidate?.kind === 'inside'} showInsertBefore={isTarget && candidate?.kind === 'before'} onToggle={() => toggle(item.node.id)} onAddMemo={() => onAddMemo(item.virtual ? null : item.node.id)} onMenu={() => onMenu(item.node)} onLongPress={item.virtual ? () => {} : drag} /> : <MemoRow memo={item.node} {...treeProps} now={renderedAt} isActive={isActive} showInsertBefore={isTarget && candidate?.kind === 'before'} completing={completingIds.has(item.node.id)} routine={!!routineCategoryForMemo(nodes, item.node)} selectionMode={selectionMode} selected={selectedMemoIds.has(item.node.id)} onToggleSelected={() => toggleSelected(item.node.id)} onCompletionAnimationFinished={() => onCompletionAnimationFinished(item.node.id)} onPress={() => onEdit(item.node)} onComplete={() => item.node.type === 'memo' && onComplete(item.node)} onMenu={() => onMenu(item.node)} onLongPress={drag} />}</ScaleDecorator>
    </TreeRowDiagnostics>;
      }} />
    </View>
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({ container: { flex: 1 }, listViewport: { flex: 1 }, toolbar: { minHeight: 38, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 12, gap: 4 }, tool: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 8, backgroundColor: colors.surfaceAlt }, toolText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' } });
