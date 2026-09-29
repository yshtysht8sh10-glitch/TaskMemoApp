import React from 'react';
import { useAppTheme } from '@/theme/theme';

export function TimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { colors } = useAppTheme();
  return <input type="time" aria-label="基本時刻" value={value} onChange={(event) => onChange(event.target.value)} style={{ minHeight: 48, width: '100%', boxSizing: 'border-box', padding: '0 13px', border: `1px solid ${colors.border}`, borderRadius: 11, background: colors.surface, color: colors.text, fontSize: 16 }} />;
}
