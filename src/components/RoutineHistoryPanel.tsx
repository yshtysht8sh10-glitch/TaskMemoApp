import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MemoNode } from '../models/node';
import { routineHistoryDays } from '../domain/routine';
import { useAppTheme } from '../theme/theme';

/** Mount with key=memo.id so a different Routine starts in compact mode. */
export function RoutineHistoryPanel({ memo, onToggle }: {
  memo: MemoNode;
  onToggle: (id: string, date: Date) => void;
}) {
  const { colors } = useAppTheme();
  const [limit, setLimit] = useState(7);
  const allDays = routineHistoryDays(memo, new Date(), Infinity);
  const days = allDays.slice(0, limit);
  return <View>
    {!days.length && <Text style={{ color: colors.textSecondary }}>保存済みの実績はありません</Text>}
    {days.map(day => <View key={day.key} style={styles.row}>
      <Text style={[styles.label, { color: colors.text }]}>{day.key} {day.outcome === 'completed' ? '完了' : day.outcome === 'skipped' ? 'スキップ' : '-'}</Text>
      {day.outcome !== 'skipped' && <Pressable accessibilityRole="button"
        accessibilityLabel={`${day.key}の${day.completed ? '完了を取り消す' : '完了'}`}
        onPress={() => onToggle(memo.id, day.date)} style={styles.button}>
        <Text style={{ color: colors.accent }}>{day.completed ? '完了を取り消す' : '完了'}</Text>
      </Pressable>}
    </View>)}
    {limit < allDays.length && <Pressable accessibilityRole="button"
      accessibilityLabel={limit === 7 ? 'すべての履歴を表示' : 'さらに履歴を表示'}
      onPress={() => setLimit(current => Math.min(allDays.length, current === 7 ? 50 : current + 50))}
      style={styles.button}>
      <Text style={{ color: colors.accent }}>{limit === 7 ? 'すべての履歴を表示' : 'さらに履歴を表示'}</Text>
    </Pressable>}
    {allDays.length > 7 && <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{days.length} / {allDays.length}件を表示</Text>}
    {limit > 7 && <Pressable accessibilityRole="button" accessibilityLabel="直近の履歴に戻す"
      onPress={() => setLimit(7)} style={styles.button}>
      <Text style={{ color: colors.accent }}>直近の履歴に戻す</Text>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { flexShrink: 1, fontSize: 14 },
  button: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 8, justifyContent: 'center' },
});
