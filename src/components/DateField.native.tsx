import { DateTimePicker as ExpoDateTimePicker } from '@expo/ui/community/datetime-picker';

import { localDateKey, parseLocalDateKey } from '@/domain/routine';

export function DateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <ExpoDateTimePicker value={parseLocalDateKey(value) ?? new Date()} mode="date" display="compact" onValueChange={(_, date) => onChange(localDateKey(date))} />;
}
