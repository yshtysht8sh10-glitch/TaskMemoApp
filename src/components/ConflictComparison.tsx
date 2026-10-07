import { useState } from 'react';
import { Platform, Pressable, Text, View, type TextStyle } from 'react-native';
import { useAppTheme } from '../theme/theme';
import { compareConflictFields, conflictTextSegments, displayConflictValue, type ConflictField } from './conflictPresentation';

const wrap: TextStyle & { overflowWrap?: 'anywhere'; whiteSpace?: 'pre-wrap' } = Platform.OS === 'web'
  ? { overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' } : {};
function FieldComparison({ field, changed }: { field: ConflictField; changed: boolean }) {
  const { colors } = useAppTheme(); const [expanded, setExpanded] = useState(false);
  const values = { local: displayConflictValue(field.local), account: displayConflictValue(field.account) };
  const segments = conflictTextSegments(values.local, values.account);
  const shortened = changed && [...segments.local, ...segments.account].some(s => !s.changed && s.text.length > 160);
  return <View style={{ gap: 6, minWidth: 0, borderWidth: 1, borderColor: colors.border, padding: 8, borderRadius: 6 }}>
    <Text style={{ color: colors.text, fontWeight: '700' }}>{changed ? 'Δ 変更項目: ' : '＝ 同一項目: '}{field.name}</Text>
    {(['local', 'account'] as const).map(side => <View key={side} style={{ minWidth: 0, gap: 4 }}>
      <Text style={{ color: colors.textSecondary }}>{side === 'local' ? 'ローカル' : 'アカウント'} · {typeof field[side] === 'string' ? '文字列' : field[side] === null ? 'null' : Array.isArray(field[side]) ? '配列' : typeof field[side] === 'object' ? 'オブジェクト' : typeof field[side] === 'boolean' ? 'boolean' : typeof field[side] === 'number' ? '数値' : '未設定'}</Text>
      <Text selectable style={[wrap, { color: colors.text, lineHeight: 22 }]}>{segments[side].map((s, i) => {
        const value = !expanded && changed && !s.changed && s.text.length > 160
          ? i === 0 ? `…（同一部分を省略）\n${Array.from(s.text).slice(-80).join('')}` : `${Array.from(s.text).slice(0, 80).join('')}\n…（同一部分を省略）` : s.text;
        return <Text key={i} style={changed && s.changed ? { backgroundColor: colors.memoBackground, color: colors.memoText, fontWeight: '700', textDecorationLine: 'underline' } : undefined}>{value}</Text>;
      })}</Text>
    </View>)}
    {shortened && <Pressable accessibilityRole="button" onPress={() => setExpanded(v => !v)} style={{ paddingVertical: 12 }}><Text style={{ color: colors.accent }}>{expanded ? '同一部分を省略' : '全文を表示'}</Text></Pressable>}
  </View>;
}
export function ConflictComparison({ local, account }: { local: unknown; account: unknown }) {
  const { colors } = useAppTheme(); const [showSame, setShowSame] = useState(false);
  const diff = compareConflictFields(local, account);
  return <View style={{ gap: 8, minWidth: 0 }}>
    <Text style={{ color: colors.text, fontWeight: '700' }}>差分 {diff.changed.length}件</Text>
    {!diff.changed.length && <Text style={{ color: colors.textSecondary }}>表示対象のフィールドに差分はありません（実質差分0件）。競合判定・同期状態は変更していません。</Text>}
    {!!diff.changed.length && <Text style={{ color: colors.textSecondary }}>下線＋強調背景が変更箇所です。ローカル／アカウントを上下に比較します。</Text>}
    {diff.changed.map(field => <FieldComparison key={field.name} field={field} changed />)}
    {!!diff.same.length && <Pressable accessibilityRole="button" accessibilityState={{ expanded: showSame }} onPress={() => setShowSame(v => !v)} style={{ paddingVertical: 12 }}><Text style={{ color: colors.accent }}>同一項目 {diff.same.length}件を{showSame ? '隠す' : '表示'}</Text></Pressable>}
    {showSame && diff.same.map(field => <FieldComparison key={field.name} field={field} changed={false} />)}
  </View>;
}
