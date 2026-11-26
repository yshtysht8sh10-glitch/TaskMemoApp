import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RoutineOutcome } from '../models/node';
import { useAppTheme } from '../theme/theme';

export const routineResultLabel = (state: RoutineOutcome['state']) =>
  ({ completed: '完了', skipped: 'スキップ', missed: '未達', pending: '未処理' })[state];

/** Controlled UI only. Supplying the callback never establishes a server capability. */
export function RoutineResultActions({ dateKey, state, onSelect }: {
  dateKey: string; state: RoutineOutcome['state']; onSelect: (state: RoutineOutcome['state']) => void;
}) {
  const { colors } = useAppTheme();
  return <View>
    <Text style={{ color: colors.text }}>{dateKey} {routineResultLabel(state)}</Text>
    <View style={styles.actions}>
      {(['completed', 'skipped', 'missed', 'pending'] as const).map(result => {
        const label = result === 'pending' ? '結果を取り消す' : routineResultLabel(result);
        return <Pressable key={result} accessibilityRole="button" accessibilityLabel={`${dateKey}の${label}`}
          disabled={state === result} onPress={() => onSelect(result)} style={styles.button}>
          <Text style={{ color: state === result ? colors.text : colors.accent }}>{label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, padding: 10, justifyContent: 'center' },
});
