import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme, type ThemeColors } from '@/theme/theme';

export function MemoRowActions({ title, completed, completing, onComplete, onMenu }: { title: string; completed?: boolean; completing?: boolean; onComplete: () => void; onMenu: () => void }) {
  const styles = createStyles(useAppTheme().colors);
  return <View style={styles.actions}>{!completed && <Pressable disabled={completing} hitSlop={8} onPress={(event) => { event.stopPropagation(); onComplete(); }} accessibilityRole="button" accessibilityLabel={`${title}を完了`} accessibilityState={{ disabled: !!completing }} style={({ pressed }) => [styles.complete, completing && styles.completing, pressed && styles.pressed]}><Text style={styles.completeText}>{completing ? '✓' : '完了'}</Text></Pressable>}<Pressable disabled={completing} hitSlop={10} onPress={(event) => { event.stopPropagation(); onMenu(); }} accessibilityRole="button" accessibilityLabel={`${title}のメニュー`} style={styles.menu}><Text style={styles.menuText}>•••</Text></Pressable></View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({ actions: { flexDirection: 'row', alignItems: 'center' }, complete: { minWidth: 54, minHeight: 34, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent, borderRadius: 17, backgroundColor: colors.surfaceAlt }, completing: { backgroundColor: colors.accentSoft }, pressed: { opacity: 0.68, backgroundColor: colors.accentSoft }, completeText: { color: colors.accent, fontSize: 12, fontWeight: '800' }, menu: { width: 42, minHeight: 42, alignItems: 'center', justifyContent: 'center' }, menuText: { color: colors.textSecondary, fontWeight: '800', letterSpacing: 1 } });
