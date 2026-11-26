import { StyleSheet, Text, View } from 'react-native';
import type { RoutineHistoryDay } from '../domain/routine';
import type { ThemeColors } from '../theme/theme';

type Result = RoutineHistoryDay['outcome'];
export function routineResultAppearance(state: Result, mode: 'light' | 'dark', colors: Pick<ThemeColors, 'text' | 'textSecondary'>) {
  switch (state) {
    case 'completed': return { label: '完了', color: mode === 'dark' ? '#72d89a' : '#18723c' };
    case 'skipped': return { label: 'スキップ', color: mode === 'dark' ? colors.text : '#000000' };
    case 'pending': return { label: '-', color: colors.textSecondary };
  }
}

/** Native shapes avoid platform-dependent emoji color and additional icon fonts. */
export function RoutineResultIcon({ state, color }: { state: Result; color: string }) {
  return <View testID={`routine-result-icon-${state}`} aria-hidden accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={[styles.icon, { borderColor: color }, state !== 'skipped' && styles.circle]}>
    {state === 'completed' && <Text style={[styles.check, { color }]}>✓</Text>}
    {state === 'skipped' && <>
      <View testID="skip-triangle" style={[styles.triangle, { borderLeftColor: color }]} />
      <View testID="skip-bar" style={[styles.bar, { backgroundColor: color }]} />
    </>}
  </View>;
}
const styles = StyleSheet.create({
  icon: { width: 18, height: 18, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  circle: { borderRadius: 9, borderWidth: 1.5 },
  check: { fontSize: 12, lineHeight: 14, fontWeight: '700', textAlign: 'center' },
  triangle: { width: 0, height: 0, borderTopWidth: 5, borderBottomWidth: 5, borderLeftWidth: 7, borderTopColor: 'transparent', borderBottomColor: 'transparent' },
  bar: { width: 2, height: 10 },
});
