import { webFormTypography } from '../theme/formTypography';
import React from 'react';
import { View } from 'react-native';
import { useAppTheme } from '@/theme/theme';
import { formatDateTimeInput, parseLocalDateTime } from '@/utils/dueDates';

export function DateTimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { colors } = useAppTheme();
  const date = parseLocalDateTime(value) ?? new Date();
  const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const timeValue = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const update = (nextDate: string, nextTime: string) => {
    const parsed = parseLocalDateTime(`${nextDate} ${nextTime}`);
    if (parsed) onChange(formatDateTimeInput(parsed));
  };
  const style: React.CSSProperties = { minHeight: 48, flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '0 10px', border: `1px solid ${colors.border}`, borderRadius: 11, background: colors.surface, color: colors.text, ...webFormTypography };
  return <View style={{ flexDirection: 'row', gap: 8 }}>
    <input type="date" aria-label="日付" value={dateValue} onChange={(event) => update(event.target.value, timeValue)} style={style} />
    <input type="time" aria-label="時刻" value={timeValue} onChange={(event) => update(dateValue, event.target.value)} style={style} />
  </View>;
}
