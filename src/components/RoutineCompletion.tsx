import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { MemoNode, Node } from '../models/node';
import { isRoutineDefinitionCompleted } from '../domain/routineLifecycle';
import { routineCategoryForMemo } from '../domain/routine';
import { useAppTheme } from '../theme/theme';
import { appAlert } from '../utils/appAlert';

export function RoutineCompletionButton({ onComplete }: { onComplete: () => Promise<boolean> }) {
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);
  return <Pressable accessibilityRole="button" disabled={busy} style={{ paddingVertical: 16 }} onPress={() => appAlert('Routineを完了',
    '新しい周期Taskの発生を停止します。発生済みの未完了Taskと過去の完了・スキップ履歴は残ります。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: 'Routineを完了', onPress: async () => { setBusy(true); try { await onComplete(); } finally { setBusy(false); } } },
    ])}><Text style={{ color: colors.accent }}>Routineを完了</Text></Pressable>;
}

export function CompletedRoutines({ nodes, onResume }: { nodes: Node[]; onResume: (id: string) => Promise<boolean> }) {
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);
  const memos = nodes.filter((n): n is MemoNode => n.type === 'memo' && !n.deletedAt && !n.purgedAt && !!routineCategoryForMemo(nodes, n) && isRoutineDefinitionCompleted(n))
    .sort((a, b) => b.routineLifecycle!.periods.at(-1)!.completedAt.localeCompare(a.routineLifecycle!.periods.at(-1)!.completedAt));
  return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
    <Text style={{ color: colors.text, fontSize: 18 }}>完了済みRoutine一覧</Text>
    {!memos.length && <Text style={{ color: colors.textSecondary }}>項目はありません</Text>}
    {memos.map(memo => <View key={memo.id} style={{ padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}>
      <Text style={{ color: colors.text }}>✓ {memo.title}</Text>
      <Text style={{ color: colors.textSecondary }}>Routine完了: {new Date(memo.routineLifecycle!.periods.at(-1)!.completedAt).toLocaleString()}</Text>
      <Pressable accessibilityRole="button" disabled={busy} style={{ paddingVertical: 12 }} onPress={async () => {
        setBusy(true); try { await onResume(memo.id); } finally { setBusy(false); }
      }}><Text style={{ color: colors.accent }}>完了を取り消す</Text></Pressable>
    </View>)}
  </ScrollView>;
}
