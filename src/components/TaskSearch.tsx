import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MemoNode, Node } from '../models/node';
import { searchTasks, type TaskSearchResult } from '../domain/taskSearch';
import { useAppTheme } from '../theme/theme';
import { FormTextInput } from './FormTextInput';

export function TaskSearch({ nodes, editable, onOpenMemo, onClose }: {
  nodes: Node[];
  editable: boolean;
  onOpenMemo: (memo: MemoNode) => void;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const [query, setQuery] = useState('');
  // Search sessions are short; use the current date again on every input/data render.
  const dateKey = new Date().toDateString();
  const results = useMemo(() => searchTasks(nodes, query, new Date(dateKey)), [nodes, query, dateKey]);
  const renderItem = ({ item }: { item: TaskSearchResult }) => <Pressable
    accessibilityRole="button" accessibilityLabel={`${item.memo.title} · ${item.folder}${item.occurrenceKey ? ` · ${item.occurrenceKey}分` : ''}`}
    disabled={!editable} onPress={() => onOpenMemo(item.memo)}
    style={[styles.result, { backgroundColor: colors.memoBackground, borderColor: colors.memoBorder, opacity: editable ? 1 : 0.65 }]}>
    <Text style={{ color: colors.memoText, fontSize: 17, fontWeight: '600' }}>{item.memo.title}</Text>
    <Text style={{ color: colors.memoText }}>{item.folder}</Text>
    <Text style={{ color: colors.memoText }}>{item.occurrenceKey ? `Routine ${item.occurrenceKey}分 · ` : ''}{item.dueAt ? item.dueAt.toLocaleString() : '期限なし'}</Text>
  </Pressable>;
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>タスクを検索</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="検索を終了して元の画面へ戻る" onPress={onClose} style={styles.button}>
            <Text style={{ color: colors.accent }}>閉じる</Text>
          </Pressable>
        </View>
        <FormTextInput accessibilityLabel="タスク名を検索" placeholder="タスク名の一部を入力" placeholderTextColor={colors.textSecondary}
          value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" returnKeyType="search"
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]} />
        <View style={styles.header}>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>{query.trim() ? `${results.length}件` : '未完了タスクをフォルダ横断で検索'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="検索文字をクリア" onPress={() => setQuery('')} style={styles.button}>
            <Text style={{ color: colors.accent }}>クリア</Text>
          </Pressable>
        </View>
        {!editable && <Text style={{ color: colors.textSecondary }}>検索は利用できます。編集は同期状態の確認後に利用できます。</Text>}
        <FlatList data={results} keyExtractor={item => item.key} renderItem={renderItem}
          keyboardShouldPersistTaps="handled" initialNumToRender={20} windowSize={7}
          ListEmptyComponent={<Text style={{ color: colors.textSecondary, paddingVertical: 24 }}>{query.trim() ? '該当する未完了タスクはありません' : 'タスク名を入力してください'}</Text>} />
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  button: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, minHeight: 48, fontSize: 16 },
  result: { padding: 14, gap: 4, borderWidth: 1, borderRadius: 8, marginBottom: 8 },
});
