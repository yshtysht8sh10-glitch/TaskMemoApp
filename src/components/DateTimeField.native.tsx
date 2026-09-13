import { DateTimePicker as ExpoDateTimePicker } from '@expo/ui/community/datetime-picker';

import { formatDateTimeInput, parseLocalDateTime } from '@/utils/dueDates';

export function DateTimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <ExpoDateTimePicker value={parseLocalDateTime(value) ?? new Date()} mode="datetime" display="compact" onValueChange={(_, date) => onChange(formatDateTimeInput(date))} />;
}
