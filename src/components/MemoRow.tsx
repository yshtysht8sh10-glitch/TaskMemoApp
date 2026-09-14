import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MemoNode } from '@/models/node';
import { formatDueLabel } from '@/utils/formatDueLabel';
import { TREE_LAYOUT, TreeRowLayout } from '@/components/TreeRowLayout';
import { useAppTheme, type ThemeColors } from '@/theme/theme';
import { MemoRowActions } from '@/components/MemoRowActions';
import { CompletionMotion } from '@/components/CompletionMotion';

type Props = { memo: MemoNode; depth: number; ancestorContinuation: boolean[]; hasNextSibling: boolean; now: number; isActive?: boolean; showInsertBefore?: boolean; completing?: boolean; onCompletionAnimationFinished: () => void; onPress: () => void; onComplete: () => void; onMenu: () => void; onLongPress: () => void };
export function MemoRow({ memo, depth, ancestorContinuation, hasNextSibling, now, isActive, showInsertBefore, completing = false, onCompletionAnimationFinished, onPress, onComplete, onMenu, onLongPress }: Props) {
  const styles = createStyles(useAppTheme().colors);
  const dueLabel = formatDueLabel(memo); const completed = memo.status === 'completed'; const overdue = !completed && !!memo.dueAt && memo.dueAt.getTime() < now;
  return <CompletionMotion completing={completing} onFinished={onCompletionAnimationFinished}><TreeRowLayout depth={depth} ancestorContinuation={ancestorContinuation} hasNextSibling={hasNextSibling}>
    <View style={styles.spacing}><Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={320} style={({ pressed }) => [styles.note, completed && styles.completedNote, showInsertBefore && styles.insertBefore, (pressed || isActive) && styles.active]}>
      <View style={styles.icon}><View style={styles.bullet} /></View>
      <View style={styles.content}><Text style={[styles.title, completed && styles.completedTitle]} numberOfLines={1}>{completed ? `✓ ${memo.title}` : memo.title}</Text>{dueLabel ? <Text style={[styles.due, overdue && styles.overdue]}>{overdue ? `期限切れ · ${dueLabel}` : dueLabel}</Text> : null}</View>
      <MemoRowActions title={memo.title} completed={completed} completing={completing} onComplete={onComplete} onMenu={onMenu} />
    </Pressable></View>
  </TreeRowLayout></CompletionMotion>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  spacing: { paddingVertical: 3 },
  note: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.memoBorder, borderRadius: 4, backgroundColor: colors.memoBackground },
  completedNote: { borderColor: colors.border, backgroundColor: colors.completedBackground }, completedTitle: { color: colors.textSecondary },
  insertBefore: { borderTopWidth: 3, borderTopColor: colors.accent }, active: { opacity: 0.82, backgroundColor: colors.accentSoft },
  icon: { width: TREE_LAYOUT.iconWidth, alignItems: 'center' }, bullet: { width: 5, height: 5, backgroundColor: colors.textSecondary, borderRadius: 3 },
  content: { flex: 1, paddingVertical: 5 }, title: { color: colors.memoText, fontSize: 15, lineHeight: 19 }, due: { marginTop: 1, color: colors.textSecondary, fontSize: 11, fontWeight: '500' }, overdue: { color: colors.danger, fontWeight: '700' },
});
