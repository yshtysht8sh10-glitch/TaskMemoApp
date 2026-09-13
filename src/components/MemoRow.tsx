import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MemoNode } from '@/models/node';
import { formatDueLabel } from '@/utils/formatDueLabel';
import { getTreeIndent } from '@/components/CategoryRow';

type Props = { memo: MemoNode; depth: number; now: number; isActive?: boolean; onPress: () => void; onMenu: () => void; onLongPress: () => void };
export function MemoRow({ memo, depth, now, isActive, onPress, onMenu, onLongPress }: Props) {
  const dueLabel = formatDueLabel(memo); const overdue = !!memo.dueAt && memo.dueAt.getTime() < now;
  return <View style={[styles.wrap, { marginLeft: getTreeIndent(depth) }]}><Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={280} style={({ pressed }) => [styles.row, (pressed || isActive) && styles.active]}>
    <View style={styles.bullet} /><View style={styles.content}><Text style={styles.title} numberOfLines={2}>{memo.title}</Text>{dueLabel ? <Text style={[styles.due, overdue && styles.overdue]}>{overdue ? `期限切れ · ${dueLabel}` : dueLabel}</Text> : null}</View>
    <Pressable hitSlop={12} onPress={(event) => { event.stopPropagation(); onMenu(); }} accessibilityLabel={`${memo.title}のメニュー`} style={styles.menu}><Text style={styles.menuText}>•••</Text></Pressable>
  </Pressable></View>;
}
const styles = StyleSheet.create({ wrap: { paddingVertical: 2 }, row: { minHeight: 50, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'flex-start', borderRadius: 10, backgroundColor: '#fff' }, active: { opacity: 0.78, borderWidth: 2, borderColor: '#61758a' }, bullet: { width: 8, height: 8, marginTop: 7, marginRight: 14, borderWidth: 2, borderColor: '#8a939f', borderRadius: 4 }, content: { flex: 1 }, title: { color: '#343c47', fontSize: 16, lineHeight: 22 }, due: { marginTop: 2, color: '#7d6670', fontSize: 12, fontWeight: '500' }, overdue: { color: '#bd4545', fontWeight: '700' }, menu: { width: 42, minHeight: 36, alignItems: 'center', justifyContent: 'center' }, menuText: { color: '#79818b', fontWeight: '800', letterSpacing: 1 } });
