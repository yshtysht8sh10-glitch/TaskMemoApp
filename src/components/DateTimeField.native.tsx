import { DateTimePicker as ExpoDateTimePicker } from '@expo/ui/community/datetime-picker';
import { View } from 'react-native';

import { formatDateTimeInput, parseLocalDateTime } from '@/utils/dueDates';

export function DateTimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const current = parseLocalDateTime(value) ?? new Date();
  return <View style={{ flexDirection: 'row', gap: 8 }}>
    <ExpoDateTimePicker value={current} mode="date" display="compact" onValueChange={(_, date) => {
      const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), current.getHours(), current.getMinutes());
      onChange(formatDateTimeInput(next));
    }} />
    <ExpoDateTimePicker value={current} mode="time" display="compact" onValueChange={(_, date) => {
      const next = new Date(current.getFullYear(), current.getMonth(), current.getDate(), date.getHours(), date.getMinutes());
      onChange(formatDateTimeInput(next));
    }} />
  </View>;
}
