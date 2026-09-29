import { DateTimePicker } from '@expo/ui/community/datetime-picker';

export function TimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [hour, minute] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hour || 0, minute || 0, 0, 0);
  return <DateTimePicker value={date} mode="time" display="compact" onValueChange={(_, next) => onChange(`${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`)} />;
}
