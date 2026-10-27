import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { DuePreset } from '../models/node';
import { memoDeadlineChoices, chooseMemoDeadline } from '../utils/memoDeadline';
import type { DeadlineGroupKey, TodayGranularity } from '../domain/deadlineView';
import { DateTimeField } from './DateTimeField';

/** Used only by ordinary Memo editing. Routine editing has its own time/rule fields. */
export function MemoDeadlineField({ preset, custom, onChange, styles, visibleGroupIds, granularity }: {
  preset: DuePreset; custom: string;
  visibleGroupIds: ReadonlySet<DeadlineGroupKey>; granularity: TodayGranularity;
  onChange: (preset: DuePreset, custom?: string) => void;
  styles: { chips: StyleProp<ViewStyle>; chip: StyleProp<ViewStyle>; chipOn: StyleProp<ViewStyle>;
    chipText: StyleProp<TextStyle>; chipTextOn: StyleProp<TextStyle> };
}) {
  const choices = memoDeadlineChoices(visibleGroupIds, granularity);
  return <>
    <View style={styles.chips}>
      {choices.map(item => {
        const selected = item.key === 'none' ? preset === 'none' : item.key === 'custom' && preset !== 'none';
        return <Pressable key={item.key} accessibilityRole="button"
          onPress={() => { const next = chooseMemoDeadline(item.key, new Date(), granularity); onChange(next.preset, next.custom); }}
          style={[styles.chip, selected && styles.chipOn]}>
          <Text style={[styles.chipText, selected && styles.chipTextOn]}>{item.label}</Text>
        </Pressable>;
      })}
    </View>
    {preset !== 'none' ? <DateTimeField value={custom} onChange={value => onChange('custom', value)} />
      : <Text style={styles.chipText}>現在の期限：期限なし</Text>}
  </>;
}
