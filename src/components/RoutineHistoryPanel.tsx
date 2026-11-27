import { memo as memoComponent, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MemoNode, Node, RoutineOutcome } from '../models/node';
import { routineHistoryRows } from '../utils/routineHistoryRows';
import { localDateKey, parseLocalDateKey, routineHistoryDays, type RoutineHistoryDay } from '../domain/routine';
import { useAppTheme } from '../theme/theme';
import { RoutineResultActions } from './RoutineResultActions';
import { routineResultAppearance, RoutineResultIcon } from './RoutineResultMark';

/** Mount with key=memo.id so a different Routine starts in compact mode. */
export function RoutineHistoryPanel({ memo, nodes, onToggle, onResult }: {
  memo: MemoNode;
  nodes?: Node[];
  onToggle: (id: string, date: Date) => void;
  /** Omitted by product entry until the reviewed server capability is supplied. */
  onResult?: (id: string, date: Date, state: RoutineOutcome['state']) => void;
}) {
  const { colors } = useAppTheme();
  const [limit, setLimit] = useState(7);
  const [selected, setSelected] = useState<RoutineHistoryDay | null>(null);
  const today = localDateKey();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = new Date().getTimezoneOffset();
  // Refresh local Date action targets even if a device zone switch leaves the
  // displayed YYYY-MM-DD unchanged.
  const calendar = useMemo(() => ({ date: parseLocalDateKey(today)!, zone, offset }), [today, zone, offset]);
  const allDays = useMemo(() => nodes ? routineHistoryRows(nodes, memo, calendar.date, Infinity)
    : routineHistoryDays(memo, calendar.date, Infinity), [nodes, memo, calendar]);
  const days = useMemo(() => allDays.slice(0, limit), [allDays, limit]);
  // Parent callbacks may change after autosave/auth updates. Keep the event target
  // current without making thousands of unchanged rows render for that change.
  const callback = useRef(onToggle);
  useLayoutEffect(() => { callback.current = onToggle; }, [onToggle]);
  const toggle = useCallback((id: string, date: Date) => callback.current(id, date), []);
  return <View>
    {!days.length && <Text style={{ color: colors.textSecondary }}>保存済みの実績はありません</Text>}
    <HistoryRows days={days} id={memo.id} onToggle={toggle} onSelect={onResult ? setSelected : undefined} />
    {selected && onResult && <RoutineResultActions dateKey={selected.key}
      state={allDays.find(day => day.key === selected.key)?.outcome ?? 'pending'}
      onSelect={state => { onResult(memo.id, selected.date, state); setSelected(null); }} />}
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

type RowsProps = { days: RoutineHistoryDay[]; id: string; onToggle: (id: string, date: Date) => void; onSelect?: (day: RoutineHistoryDay) => void };
const HistoryRows = memoComponent(function HistoryRows({ days, id, onToggle, onSelect }: RowsProps) {
  const { colors, resolved } = useAppTheme();
  return <>{days.map(day => { const result = routineResultAppearance(day.outcome, resolved, colors); return <View key={day.key} style={styles.row}>
      <View style={styles.summary}>
        <RoutineResultIcon state={day.outcome} color={result.color} />
        <Text style={[styles.label, { color: colors.text }]}>{day.key} <Text testID={`routine-result-label-${day.outcome}`} style={{ color: result.color }}>{result.label}</Text></Text>
      </View>
      {day.outcome !== 'skipped' && day.outcome !== 'missed' && <Pressable accessibilityRole="button"
        accessibilityLabel={`${day.key}の${day.completed ? '完了を取り消す' : '完了'}`}
        onPress={() => onToggle(id, day.date)} style={styles.button}>
        <Text style={{ color: colors.accent }}>{day.completed ? '完了を取り消す' : '完了'}</Text>
      </Pressable>}
      {onSelect && <Pressable accessibilityRole="button" accessibilityLabel={`${day.key}の結果を選択`}
        onPress={() => onSelect(day)} style={styles.button}><Text style={{ color: colors.accent }}>結果を選択</Text></Pressable>}
    </View>; })}</>;
}, (before, after) => before.id === after.id && before.onToggle === after.onToggle && before.onSelect === after.onSelect &&
  (before.days === after.days || (before.days.length === after.days.length && before.days.every((day, index) => {
    const next = after.days[index];
    return day.key === next.key && day.outcome === next.outcome && day.completed === next.completed && day.date.getTime() === next.date.getTime();
  }))));

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  label: { flexShrink: 1, fontSize: 14 },
  button: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 8, justifyContent: 'center' },
});
