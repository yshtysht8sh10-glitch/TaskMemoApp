import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import DraggableFlatList, { type DragEndParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { flattenVisibleNodes, UNASSIGNED_GROUP_ID, visibleDescendantNodeCount, visibleUnassignedMemoCount, type VisibleTreeRow } from '@/domain/treeView';
import { dropCandidateFor, resolveDropCandidate, type DropCandidate } from '@/domain/treeDrop';
import type { Node } from '@/models/node';
import { CategoryRow } from '@/components/CategoryRow';
import { MemoRow } from '@/components/MemoRow';
import { measureAllTreeRows, TreeRowDiagnostics } from '@/components/TreeRowDiagnostics';
import { beginTreeDragTrace, nextTreeMountId, nodesRevision, summarizeNodes, summarizeRows, treeDiagnosticLog } from '@/components/treeDiagnostics';
import { useAppTheme, type ThemeColors } from '@/theme/theme';
import { WebSortableScrollList } from '@/components/WebSortableScrollList';
import { routineCategoryForMemo } from '@/domain/routine';
import { completableSelectedMemoIds, normalizeSelectedNodeIds, selectedNodeState } from '@/domain/nodeSelection';
import { useInlineTitleEdit } from '@/hooks/useInlineTitleEdit';

export type VisibleRow = VisibleTreeRow;
export type { DropCandidate } from '@/domain/treeDrop';
type Props = { nodes: Node[]; showCompletedMemos: boolean; onShowCompletedMemosChange: (value: boolean) => void; completingIds: ReadonlySet<string>; onCompletionAnimationFinished: (id: string) => void; onAddMemo: (parentId: string | null) => void; onRenameMemo: (id: string, title: string) => void; onComplete: (memo: import('@/models/node').MemoNode) => void; onMenu: (node: Node) => void; onDrop: (nodeId: string, candidate: DropCandidate) => void; onBulkMove: (nodeIds: string[], onSuccess: () => void) => void; onBulkComplete: (nodeIds: string[]) => boolean; onBulkDelete: (nodeIds: string[], onSuccess: () => void) => void };
const INITIAL_EXPANDED_CATEGORY_IDS = [UNASSIGNED_GROUP_ID, 'personal', 'books', 'technical-books'];
let retainedExpandedCategoryIds = new Set(INITIAL_EXPANDED_CATEGORY_IDS);

export function NodeTree({ nodes, showCompletedMemos, onShowCompletedMemosChange, completingIds, onCompletionAnimationFinished, onAddMemo, onRenameMemo, onComplete, onMenu, onDrop, onBulkMove, onBulkComplete, onBulkDelete }: Props) {
  const { colors } = useAppTheme(); const styles = createStyles(colors);
  const [mountId] = useState(nextTreeMountId);
  const viewportRef = useRef<View>(null); const scrollOffsetRef = useRef(0);
  const [renderedAt] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(() => new Set(retainedExpandedCategoryIds));
  const [candidate, setCandidate] = useState<DropCandidate | null>(null);
  const [selectionMode, setSelectionMode] = useState(false); const [selectedNodeIds, setSelectedNodeIds] = useState(() => new Set<string>());
  const titleEdit = useInlineTitleEdit(onRenameMemo);
  const movingId = useRef<string | null>(null);
  const candidateRef = useRef<DropCandidate | null>(null);
  const rows = useMemo(() => flattenVisibleNodes(nodes, expanded, showCompletedMemos), [nodes, expanded, showCompletedMemos]);
  const categoryIds = useMemo(() => [UNASSIGNED_GROUP_ID, ...nodes.filter((node) => node.type === 'category' && node.deletedAt === null).map((node) => node.id)], [nodes]);
  const categoryChildCounts = useMemo(() => new Map(categoryIds.map((id) => [id, id === UNASSIGNED_GROUP_ID ? visibleUnassignedMemoCount(nodes) : visibleDescendantNodeCount(nodes, id)])), [categoryIds, nodes]);
  const orderedKeys = useMemo(() => rows.map((row) => row.node.id), [rows]);
  const revision = useMemo(() => nodesRevision(nodes), [nodes]);
  useEffect(() => { treeDiagnosticLog('tree-render', { mountId, nodesRevision: revision, nodes: summarizeNodes(nodes), treeRows: summarizeRows(rows), keys: orderedKeys, expanded: [...expanded] }); }, [expanded, mountId, nodes, orderedKeys, revision, rows]);
  useEffect(() => () => { retainedExpandedCategoryIds = new Set(expanded); }, [expanded]);
  useEffect(() => { treeDiagnosticLog('tree-mount', { mountId }); return () => treeDiagnosticLog('tree-unmount', { mountId }); }, [mountId]);
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const normalizedIds = useMemo(() => normalizeSelectedNodeIds(nodes, selectedNodeIds), [nodes, selectedNodeIds]);
  const completableCount = useMemo(() => completableSelectedMemoIds(nodes, normalizedIds).length, [nodes, normalizedIds]);
  const clearSelection = () => { setSelectionMode(false); setSelectedNodeIds(new Set()); };
  const toggleSelected = (id: string) => setSelectedNodeIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return new Set(normalizeSelectedNodeIds(nodes, next)); });
  const candidateBeforeTarget = (active: VisibleRow, target: VisibleRow) => {
    const hover = dropCandidateFor(nodes, active.node.id, target.node);
    if (!hover) return null;
    const withoutActive = rows.filter((row) => row.node.id !== active.node.id);
    const targetIndex = withoutActive.findIndex((row) => row.node.id === target.node.id);
    if (targetIndex < 0) return hover;
    const reordered = [...withoutActive];
    reordered.splice(targetIndex, 0, active);
    return resolveDropCandidate(nodes, active.node.id, hover, reordered);
  };
  const selectionTools = selectionMode ? <><Text style={styles.selectionCount}>{normalizedIds.length}件選択</Text><Pressable style={styles.tool} onPress={clearSelection}><Text style={styles.toolText}>キャンセル</Text></Pressable></> : <Pressable style={styles.tool} onPress={() => setSelectionMode(true)}><Text style={styles.toolText}>複数選択</Text></Pressable>;
  const actionBar = selectionMode && <View style={styles.actionBar}><Text style={styles.actionCount}>{normalizedIds.length}件選択</Text><Pressable disabled={!normalizedIds.length} style={[styles.actionButton, !normalizedIds.length && styles.disabled]} onPress={() => onBulkMove(normalizedIds, clearSelection)}><Text style={styles.actionText}>移動</Text></Pressable><Pressable disabled={!completableCount} style={[styles.actionButton, !completableCount && styles.disabled]} onPress={() => { if (onBulkComplete(normalizedIds)) clearSelection(); }}><Text style={styles.actionText}>{completableCount}件のMemoを完了</Text></Pressable><Pressable disabled={!normalizedIds.length} style={[styles.actionButton, styles.deleteButton, !normalizedIds.length && styles.disabled]} onPress={() => onBulkDelete(normalizedIds, clearSelection)}><Text style={styles.deleteText}>削除</Text></Pressable></View>;
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
  const completedToggle = !selectionMode && <View style={styles.toggle}><Text style={styles.toolText}>完了を表示</Text><Switch value={showCompletedMemos} onValueChange={onShowCompletedMemosChange} accessibilityLabel="完了を表示" /></View>;
  if (Platform.OS === 'web') return <View style={styles.container}>
    <View style={styles.toolbar}>{selectionTools}{completedToggle}{!selectionMode && <><Pressable style={styles.tool} onPress={() => setExpanded(new Set(categoryIds))} accessibilityLabel="すべて開く"><Text style={styles.toolText}>すべて開く</Text></Pressable><Pressable style={styles.tool} onPress={() => setExpanded(new Set())} accessibilityLabel="すべて閉じる"><Text style={styles.toolText}>すべて閉じる</Text></Pressable></>}</View>
    <WebSortableScrollList data={rows} keyFor={(row) => row.node.id} canDrag={(row) => !selectionMode && !row.virtual}
      distinguishBeforeTarget
      canDropAfter={(row) => row.node.type === 'memo'}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: selectionMode ? 170 : 110 }}
      onHover={(active, target, placement) => { movingId.current = active.node.id; const next = placement === 'before' ? candidateBeforeTarget(active, target) : dropCandidateFor(nodes, active.node.id, target.node, placement); candidateRef.current = next; setCandidate(next); }}
      onDrop={(active, target, placement) => { const next = placement === 'before' ? candidateBeforeTarget(active, target) : dropCandidateFor(nodes, active.node.id, target.node, placement); candidateRef.current = null; setCandidate(null); if (next) onDrop(active.node.id, next); }}
      renderItem={(item, isActive) => {
        const isTarget = candidate?.targetId === item.node.id; const treeProps = { depth: item.depth, ancestorContinuation: item.ancestorContinuation, hasNextSibling: item.hasNextSibling };
        const selectionState = selectedNodeState(nodes, selectedNodeIds, item.node.id);
        return item.node.type === 'category' ? <CategoryRow category={item.node} {...treeProps} virtual={!!item.virtual} allowAddMemo={true} isExpanded={expanded.has(item.node.id)} collapsedChildCount={categoryChildCounts.get(item.node.id) ?? 0} isActive={isActive} isDropInside={isTarget && candidate?.kind === 'inside'} showInsertBefore={isTarget && candidate?.kind === 'before'} selectionMode={selectionMode && !item.virtual && item.node.categoryKind !== 'routineRoot'} selectionState={selectionState} onToggleSelected={() => toggleSelected(item.node.id)} onToggle={() => toggle(item.node.id)} onAddMemo={() => onAddMemo(item.virtual ? null : item.node.id)} onMenu={() => onMenu(item.node)} onLongPress={() => {}} /> : <MemoRow memo={item.node} {...treeProps} now={renderedAt} isActive={isActive} showInsertBefore={isTarget && candidate?.kind === 'before'} completing={completingIds.has(item.node.id)} routine={!!routineCategoryForMemo(nodes, item.node)} selectionMode={selectionMode} selectionState={selectionState} onToggleSelected={() => toggleSelected(item.node.id)} onCompletionAnimationFinished={() => onCompletionAnimationFinished(item.node.id)} titleEdit={titleEdit} onComplete={() => item.node.type === 'memo' && onComplete(item.node)} onMenu={() => onMenu(item.node)} onLongPress={() => {}} />;
      }} />
    {actionBar}
  </View>;
  return <View style={styles.container}>
    <View style={styles.toolbar}>{selectionTools}{completedToggle}{!selectionMode && <><Pressable style={styles.tool} onPress={() => setExpanded(new Set(categoryIds))} accessibilityLabel="すべて開く"><Text style={styles.toolText}>すべて開く</Text></Pressable><Pressable style={styles.tool} onPress={() => setExpanded(new Set())} accessibilityLabel="すべて閉じる"><Text style={styles.toolText}>すべて閉じる</Text></Pressable></>}</View>
    <View ref={viewportRef} collapsable={false} style={styles.listViewport}>
      <DraggableFlatList data={rows} keyExtractor={(row) => row.node.id}
        onDragBegin={(index) => { movingId.current = rows[index]?.virtual ? null : rows[index]?.node.id ?? null; if (movingId.current) beginTreeDragTrace(movingId.current); treeDiagnosticLog('drag-begin', { mountId, index, movingId: movingId.current, nodes: summarizeNodes(nodes), treeRows: summarizeRows(rows), keys: orderedKeys }); updateCandidate(index); }}
        onPlaceholderIndexChange={updateCandidate} onRelease={(index) => { treeDiagnosticLog('drag-release', { index, movingId: movingId.current, candidate: candidateRef.current }); measureAllTreeRows('release'); }} onDragEnd={drop}
        onScrollOffsetChange={(offset) => { scrollOffsetRef.current = offset; }} activationDistance={16} autoscrollThreshold={70} autoscrollSpeed={85}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: selectionMode ? 170 : 110 }} renderItem={({ item, drag, isActive, getIndex }) => {
    const isTarget = candidate?.targetId === item.node.id;
    const treeProps = { depth: item.depth, ancestorContinuation: item.ancestorContinuation, hasNextSibling: item.hasNextSibling };
    const selectionState = selectedNodeState(nodes, selectedNodeIds, item.node.id);
    return <TreeRowDiagnostics rowKey={item.node.id} index={getIndex() ?? -1} orderedKeys={orderedKeys} viewportRef={viewportRef} scrollOffsetRef={scrollOffsetRef} revision={revision}>
      <ScaleDecorator activeScale={1.025}>{item.node.type === 'category' ? <CategoryRow category={item.node} {...treeProps} virtual={!!item.virtual} allowAddMemo={true} isExpanded={expanded.has(item.node.id)} collapsedChildCount={categoryChildCounts.get(item.node.id) ?? 0} isActive={isActive} isDropInside={isTarget && candidate?.kind === 'inside'} showInsertBefore={isTarget && candidate?.kind === 'before'} selectionMode={selectionMode && !item.virtual && item.node.categoryKind !== 'routineRoot'} selectionState={selectionState} onToggleSelected={() => toggleSelected(item.node.id)} onToggle={() => toggle(item.node.id)} onAddMemo={() => onAddMemo(item.virtual ? null : item.node.id)} onMenu={() => onMenu(item.node)} onLongPress={selectionMode || item.virtual ? () => {} : drag} /> : <MemoRow memo={item.node} {...treeProps} now={renderedAt} isActive={isActive} showInsertBefore={isTarget && candidate?.kind === 'before'} completing={completingIds.has(item.node.id)} routine={!!routineCategoryForMemo(nodes, item.node)} selectionMode={selectionMode} selectionState={selectionState} onToggleSelected={() => toggleSelected(item.node.id)} onCompletionAnimationFinished={() => onCompletionAnimationFinished(item.node.id)} titleEdit={titleEdit} onComplete={() => item.node.type === 'memo' && onComplete(item.node)} onMenu={() => onMenu(item.node)} onLongPress={selectionMode ? () => {} : drag} />}</ScaleDecorator>
    </TreeRowDiagnostics>;
      }} />
    </View>
    {actionBar}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({ container: { flex: 1 }, listViewport: { flex: 1 }, toolbar: { minHeight: 42, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 12, gap: 6 }, toggle: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 4 }, tool: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 8, backgroundColor: colors.surfaceAlt }, toolText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' }, selectionCount: { marginRight: 'auto', color: colors.text, fontSize: 13, fontWeight: '700' }, actionBar: { position: 'absolute', left: 10, right: 10, bottom: 10, minHeight: 62, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface, elevation: 10, shadowOpacity: 0.2, shadowRadius: 10 }, actionCount: { marginRight: 'auto', color: colors.text, fontSize: 12, fontWeight: '700' }, actionButton: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.surfaceAlt }, actionText: { color: colors.text, fontSize: 11, fontWeight: '700' }, deleteButton: { backgroundColor: colors.surfaceAlt }, deleteText: { color: colors.danger, fontSize: 12, fontWeight: '700' }, disabled: { opacity: 0.35 } });
