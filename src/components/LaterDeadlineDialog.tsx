import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { DateTimeField } from './DateTimeField';
import { useAppTheme } from '../theme/theme';
import { formatDateTimeInput, parseLocalDateTime } from '../utils/dueDates';
import { deadlineGroupForDueAt } from '../domain/deadlineView';

function DeadlineChoice({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useAppTheme();
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={{ padding: 14, borderRadius: 10, backgroundColor: colors.surfaceAlt, opacity: disabled ? 0.4 : 1 }}>
    <Text style={{ color: colors.text, fontSize: 16 }}>{label}</Text>
  </Pressable>;
}

export function LaterDeadlineDialog({ title, now, onConfirm, onCancel }: {
  title: string; now: Date; onConfirm: (dueAt: Date) => Promise<boolean>; onCancel: () => void;
}) {
  const { colors } = useAppTheme();
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState(() => formatDateTimeInput(new Date(now.getFullYear() + 1, 0, 1, 23, 59)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const dueAt = parseLocalDateTime(value);
  const valid = !!dueAt && deadlineGroupForDueAt(dueAt, new Date()) === 'later';
  const confirm = async () => {
    if (saving.current || !valid || !dueAt) return;
    saving.current = true; setBusy(true); setError(null);
    try { if (!await onConfirm(dueAt)) setError('保存できませんでした。同期状態を確認して再試行してください。'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存できませんでした。'); }
    finally { saving.current = false; setBusy(false); }
  };
  return <Modal transparent visible animationType="fade" onRequestClose={() => { if (!busy) onCancel(); }}>
    <View style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: colors.backdrop }}>
      <ScrollView style={{ maxHeight: '90%', flexGrow: 0, borderRadius: 16, backgroundColor: colors.surface }}
        contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>期限変更の確認</Text>
        <Text style={{ color: colors.text }}>{title}</Text>
        <Text style={{ color: colors.text }}>期限を {value} に変更しますか？</Text>
        {custom && <DateTimeField value={value} onChange={next => { if (!busy) setValue(next); }} />}
        {!valid && <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          この日時は「それ以降」以外のグループに分類されます。日時を指定してください。
        </Text>}
        {error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
        <DeadlineChoice label={custom ? 'この日時に変更する' : 'この期限に変更する'} onPress={() => { void confirm(); }} disabled={busy || !valid} />
        {!custom && <DeadlineChoice label="別の日時を指定する" onPress={() => setCustom(true)} disabled={busy} />}
        <DeadlineChoice label="キャンセル" onPress={onCancel} disabled={busy} />
      </ScrollView>
    </View>
  </Modal>;
}
