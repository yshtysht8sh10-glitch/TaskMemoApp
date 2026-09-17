import React from 'react';

import { useAppTheme } from '@/theme/theme';

export function DateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { colors } = useAppTheme();
  return React.createElement('input', {
    type: 'date', value, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    style: { minHeight: 48, boxSizing: 'border-box', padding: '0 13px', border: `1px solid ${colors.border}`, borderRadius: 11, background: colors.surface, color: colors.text, fontSize: 16 },
  });
}
