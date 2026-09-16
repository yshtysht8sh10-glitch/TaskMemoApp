import { Pressable, StyleSheet, Text } from 'react-native';
import type { CategoryNode } from '@/models/node';
import { TREE_LAYOUT, TreeRowLayout } from '@/components/TreeRowLayout';
import { useAppTheme, type ThemeColors } from '@/theme/theme';

type Props = { category: CategoryNode; depth: number; ancestorContinuation: boolean[]; hasNextSibling: boolean; isExpanded: boolean; isActive?: boolean; isDropInside?: boolean; showInsertBefore?: boolean; virtual?: boolean; onToggle: () => void; onAddMemo: () => void; onMenu: () => void; onLongPress: () => void };

export function CategoryRow({ category, depth, ancestorContinuation, hasNextSibling, isExpanded, isActive, isDropInside, showInsertBefore, virtual, onToggle, onAddMemo, onMenu, onLongPress }: Props) {
  const styles = createStyles(useAppTheme().colors);
  const routine = !!category.categoryKind;
  return <TreeRowLayout depth={depth} ancestorContinuation={ancestorContinuation} hasNextSibling={hasNextSibling}>
    <Pressable onPress={onToggle} onLongPress={onLongPress} delayLongPress={280}
      accessibilityRole="button" accessibilityLabel={`${category.title}を${isExpanded ? '閉じる' : '開く'}`} accessibilityState={{ expanded: isExpanded }}
      style={({ pressed }) => [styles.row, routine && styles.routine, virtual && styles.virtual, showInsertBefore && styles.insertBefore, isDropInside && styles.dropInside, (pressed || isActive) && styles.active]}>
      <Text style={styles.icon}>{virtual ? '◇' : routine ? '🔁' : isExpanded ? '▼' : '▶'}</Text>
      <Text style={styles.title} numberOfLines={2}>{category.title}</Text>
      <Pressable hitSlop={8} onPress={(event) => { event.stopPropagation(); onAddMemo(); }} accessibilityLabel={`${category.title}にMemoを追加`} style={styles.add}><Text style={styles.addText}>＋</Text></Pressable>
      {!virtual && <Pressable hitSlop={8} onPress={(event) => { event.stopPropagation(); onMenu(); }} accessibilityLabel={`${category.title}のメニュー`} style={styles.menu}><Text style={styles.menuText}>•••</Text></Pressable>}
    </Pressable>
  </TreeRowLayout>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { minHeight: 42, flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent' },
  routine: { backgroundColor: colors.accentSoft, borderRadius: 6 }, virtual: { backgroundColor: colors.surfaceAlt, borderRadius: 6 },
  insertBefore: { borderTopWidth: 2, borderTopColor: colors.accent },
  dropInside: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  active: { opacity: 0.78, backgroundColor: colors.surfaceAlt },
  icon: { width: TREE_LAYOUT.iconWidth, textAlign: 'center', color: colors.textSecondary, fontSize: 12 },
  title: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  menu: { width: 38, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  add: { width: 38, minHeight: 38, alignItems: 'center', justifyContent: 'center' }, addText: { color: colors.accent, fontSize: 22, fontWeight: '500' },
  menuText: { color: colors.textSecondary, fontWeight: '800', letterSpacing: 1 },
});
