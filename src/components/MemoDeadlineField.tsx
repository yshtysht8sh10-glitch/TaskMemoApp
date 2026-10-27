import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { DuePreset } from '../models/node';
import { MEMO_DEADLINE_PRESETS, chooseMemoDeadline } from '../utils/memoDeadline';
import { DateTimeField } from './DateTimeField';

/** Used only by ordinary Memo editing. Routine editing has its own time/rule fields. */
export function MemoDeadlineField({ preset, custom, onChange, styles }: {
  preset: DuePreset; custom: string;
  onChange: (preset: DuePreset, custom?: string) => void;
  styles: { chips: StyleProp<ViewStyle>; chip: StyleProp<ViewStyle>; chipOn: StyleProp<ViewStyle>;
    chipText: StyleProp<TextStyle>; chipTextOn: StyleProp<TextStyle> };
}) {
  return <>
    <View style={styles.chips}>
      {MEMO_DEADLINE_PRESETS.map(item => <Pressable key={item.key} accessibilityRole="button"
        onPress={() => { const selected = chooseMemoDeadline(item.key); onChange(selected.preset, selected.custom); }}
        style={[styles.chip, preset === item.key && styles.chipOn]}>
        <Text style={[styles.chipText, preset === item.key && styles.chipTextOn]}>{item.label}</Text>
      </Pressable>)}
    </View>
    {preset === 'custom' && <DateTimeField value={custom} onChange={value => onChange('custom', value)} />}
  </>;
}
