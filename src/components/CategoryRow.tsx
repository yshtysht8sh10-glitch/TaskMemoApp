import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CategoryNode } from '@/models/node';

type Props = { category: CategoryNode; depth: number; isExpanded: boolean; isActive?: boolean; onToggle: () => void; onMenu: () => void; onLongPress: () => void };
export const TREE_INDENT = 16;
export const getTreeIndent = (depth: number) => Math.min(depth * TREE_INDENT, 64);

export function CategoryRow({ category, depth, isExpanded, isActive, onToggle, onMenu, onLongPress }: Props) {
  return <View style={[styles.wrap, { marginLeft: getTreeIndent(depth) }]}>
    <Pressable onPress={onToggle} onLongPress={onLongPress} delayLongPress={280}
      accessibilityRole="button" accessibilityLabel={`${category.title}を${isExpanded ? '閉じる' : '開く'}`}
      accessibilityState={{ expanded: isExpanded }}
      style={({ pressed }) => [styles.row, (pressed || isActive) && styles.active]}>
      <Text style={styles.disclosure}>{isExpanded ? '▼' : '▶'}</Text>
      <Text style={styles.title} numberOfLines={2}>{category.title}</Text>
      <Pressable hitSlop={12} onPress={(event) => { event.stopPropagation(); onMenu(); }} accessibilityLabel={`${category.title}のメニュー`} style={styles.menu}><Text style={styles.menuText}>•••</Text></Pressable>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 3 }, row: { minHeight: 52, paddingHorizontal: 12, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', borderRadius: 12, backgroundColor: '#eef1f5' },
  active: { opacity: 0.78, borderWidth: 2, borderColor: '#61758a' }, disclosure: { width: 26, color: '#485260', fontSize: 12 },
  title: { flex: 1, color: '#222b36', fontSize: 16, fontWeight: '700', lineHeight: 22 }, menu: { width: 42, minHeight: 36, alignItems: 'center', justifyContent: 'center' }, menuText: { color: '#616b78', fontWeight: '800', letterSpacing: 1 },
});
