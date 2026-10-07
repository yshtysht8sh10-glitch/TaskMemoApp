import { FormTextInput } from './FormTextInput';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View, StyleSheet, type TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useAppTheme } from '../theme/theme';
import { encodeCell } from '../textFormat/parser';
import { serializeText } from '../textFormat/session';
import { planTextEdit } from '../textFormat/planner';
import { closeTextChoices, renderTextView, textCellCandidates, textHighlights, textChangeLabels, TEXT_DETAIL_LABELS, type TextDetail, type TextViewSnapshot } from '../textFormat/presentation';
import { TEXT_COLUMNS, type TextPlan, type TextSession } from '../textFormat/syntax';

// Browser owns the resized height; React never controls it or replaces the input.
const webEditorResize: TextStyle & { resize: 'vertical' } = { resize: 'vertical', overflow: 'scroll' };

function ActionButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useAppTheme();
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button, { backgroundColor: colors.surfaceAlt, opacity: disabled ? 0.4 : 1 }]}><Text style={{ color: colors.text }}>{label}</Text></Pressable>;
}
type EditProps = { session: TextSession; excluded: number; prepare: (session: TextSession, text: string) => TextPlan; commit: (plan: TextPlan, confirmation?: { fingerprint: string; deletedIds: string[] }) => Promise<void>; discard: (session: TextSession) => void; onClose: () => void };
export function TextEditScreen({ session, excluded, prepare, commit, discard, onClose }: EditProps) {
  const { colors } = useAppTheme();
  const initial = useMemo(() => serializeText(session), [session]);
  const [text, setText] = useState(initial), [validatedText, setValidatedText] = useState(initial);
  const [problem, setProblem] = useState(''), [busy, setBusy] = useState(false);
  const inFlight = useRef(false), input = useRef<TextInput>(null);
  const [selection, setSelection] = useState(0);
  const [dialog, setDialog] = useState<'close' | TextPlan | null>(null);
  const dirty = text !== initial;
  useEffect(() => { const timer = setTimeout(() => setValidatedText(text), 180); return () => clearTimeout(timer); }, [text]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const live = useMemo(() => planTextEdit(session, validatedText, session.baseline), [session, validatedText]);
  const highlight = useMemo(() => textHighlights(session, validatedText), [session, validatedText]);
  const cursorLine = text.slice(0, selection).split('\n').length;
  const cursorColumn = selection - text.lastIndexOf('\n', selection - 1);
  const cursorRow = highlight.doc.rows.find(row => row.line === cursorLine);
  const cellIndex = cursorRow?.cells.findIndex(cell => cursorColumn >= cell.start && cursorColumn <= cell.end) ?? -1;
  const candidates = textCellCandidates(cellIndex);
  const finish = () => { discard(session); onClose(); };
  const requestClose = () => {
    if (inFlight.current) return;
    if (!dirty) { finish(); return; }
    try { const current = prepare(session, text); setValidatedText(text); setProblem(''); setDialog('close'); if (current.errors.length) setProblem('エラーがあるため保存できません。変更を破棄して閉じることはできます。'); }
    catch (reason) { setProblem(String(reason instanceof Error ? reason.message : reason)); setDialog('close'); }
  };
  const execute = async (plan: TextPlan, confirmed = false) => {
    if (inFlight.current) return;
    if (plan.document !== text) { setDialog(null); setProblem('確認後に入力が変わりました。保存内容を再確認してください。'); return; }
    inFlight.current = true; setBusy(true); setDialog(null); setProblem('');
    try { await commit(plan, confirmed ? { fingerprint: plan.fingerprint, deletedIds: plan.deletedIds } : undefined); onClose(); }
    catch (reason) { setProblem(reason instanceof Error ? reason.message : String(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = () => {
    if (inFlight.current) return;
    setValidatedText(text); setProblem('');
    try {
      const plan = prepare(session, text);
      if (plan.errors.length) { setProblem('入力エラーがあります。保存されていません。'); setDialog(null); return; }
      if (plan.requiresConfirmation) setDialog(plan); else void execute(plan);
    } catch (reason) { setProblem(reason instanceof Error ? reason.message : String(reason)); setDialog(null); }
  };
  const strictErrors = dialog === 'close' && (text === validatedText ? live.errors.length > 0 : planTextEdit(session, text, session.baseline).errors.length > 0);
  return <Modal visible animationType="slide" onRequestClose={requestClose}>
    <SafeAreaView style={[s.screen, { backgroundColor: colors.background }]}>
      <View style={s.actions}><Text accessibilityRole="header" style={[s.heading, { color: colors.text }]}>テキスト編集 · {session.view === 'tree' ? 'ツリー' : '一覧'}</Text><ActionButton label="閉じる" onPress={requestClose} disabled={busy} /><ActionButton label={busy ? '保存中…' : '保存'} onPress={save} disabled={busy} /></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <Text style={{ color: colors.textSecondary }}>{session.view === 'tree' ? 'ツリー全体を編集します。2スペースで階層変更。@root＝無所属、@routine＝Routine管理領域。' : '表示設定に含まれる一覧の実Nodeを編集します。インデント・グループは所属を変更しません。'}</Text>
        {excluded > 0 && <Text style={{ color: colors.textSecondary }}>Routine表示 {excluded}行は編集対象外です（仮想Occurrenceを含む）。Routine定義はツリーから編集してください。</Text>}
        <Text style={{ color: colors.textSecondary }}>ref | 種別 | タイトル | 期限 | 完了 | 本文 | Routine　　新規行はrefなし。1保存をまとめてUndoできます。</Text>
        <FormTextInput ref={input} accessibilityLabel="TaskMemoテキスト編集入力" multiline value={text} onChangeText={setText} onSelectionChange={event => setSelection(event.nativeEvent.selection.start)} editable={!busy && !dialog} autoCapitalize="none" autoCorrect={false} spellCheck={false}
          style={[s.editor, Platform.OS === 'web' && webEditorResize, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]} />
        {!!candidates.length && text === validatedText && <View style={s.actions}><Text style={{ color: colors.textSecondary }}>候補（{TEXT_COLUMNS[cellIndex]}）:</Text>{candidates.map(value => <ActionButton key={value} label={value} disabled={busy || !!dialog} onPress={() => {
          const cell = cursorRow!.cells[cellIndex], lineStart = text.split('\n').slice(0, cursorLine - 1).join('\n').length + (cursorLine > 1 ? 1 : 0);
          const raw = text.slice(lineStart + cell.start - 1, lineStart + cell.end - 1);
          setText(text.slice(0, lineStart + cell.start - 1) + /^\s*/.exec(raw)![0] + encodeCell(value) + /\s*$/.exec(raw)![0] + text.slice(lineStart + cell.end - 1)); input.current?.focus();
        }} />)}</View>}
        <Text style={{ color: colors.textSecondary }}>期限の絶対日付例: 4/25、2027/4/25、4/25 17:00。曖昧な表現は使えません。</Text>
        {!!problem && <Text accessibilityRole="alert" style={{ color: colors.danger }}>⚠ {problem}</Text>}
        {!!live.errors.length && <View accessibilityLiveRegion="polite" style={[s.notice, { backgroundColor: colors.surfaceAlt, borderColor: colors.danger }]}>{live.errors.map((error, i) => <Text key={i} style={{ color: colors.text }}>⚠ {error.line ? `${error.line}行 ${error.cell}列` : '全体'}: {error.message}</Text>)}</View>}
        <Text accessibilityRole="header" style={[s.heading, { color: colors.text }]}>構文・変更表示</Text>
        <Text style={{ color: colors.textSecondary }}>下線＋赤系文字＝変更、＋新規＝追加、−削除予定＝未保存の削除、⚠背景＝エラー。列名と領域枠でも区別します。</Text>
        <ScrollView horizontal><View style={{ minWidth: '100%' }}>{validatedText.split(/\r?\n/).map((raw, i) => {
          const region = highlight.doc.regions?.find(r => r.line === i + 1);
          const entry = highlight.rows.find(r => r.row.line === i + 1);
          const errors = live.errors.filter(e => e.line === i + 1);
          if (region) return <View key={i} style={[s.region, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}><Text style={{ color: colors.text, fontWeight: '800' }}>{i + 1}　▣ システム領域 {raw}（{region.name === 'root' ? '無所属' : 'Routine管理'}）</Text></View>;
          return <View key={i} style={[s.line, { borderWidth: errors.length ? 1 : 0, borderColor: colors.danger, backgroundColor: errors.length ? colors.surfaceAlt : colors.surface }]}>
            <Text style={{ color: colors.textSecondary }}>{i + 1}　{errors.length ? '⚠ ' : ''}{entry?.isNew ? '＋新規 ' : entry?.structureChanged ? '↕ 所属・並び変更 ' : ''}</Text>
            {entry ? entry.row.cells.map((cell, index) => <View key={index} style={s.cell}><Text style={{ color: colors.textSecondary, fontSize: 10 }}>{TEXT_COLUMNS[index]}</Text><Text selectable style={{ color: entry.changed[index] ? colors.danger : index === 1 ? colors.accent : index === 3 ? colors.memoText : index === 6 ? colors.ideaText : colors.text, backgroundColor: index === 3 ? colors.memoBackground : index === 6 ? colors.ideaBackground : undefined, fontWeight: index < 2 ? '700' : '400', textDecorationLine: entry.changed[index] ? 'underline' : 'none' }}>{cell.value || '∅'}</Text></View>) : <Text selectable style={{ color: colors.text }}>{raw}</Text>}
          </View>;
        })}</View></ScrollView>
        {highlight.deleted.map(ref => <Text key={ref} style={{ color: colors.textSecondary }}>− 削除予定 {ref}: {session.baselineCells[ref][2]}</Text>)}
      </ScrollView>
      {dialog && <View accessibilityViewIsModal style={[s.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text accessibilityRole="header" style={[s.heading, { color: colors.text }]}>{dialog === 'close' ? '未保存の変更があります' : `${dialog.changes.length}件の変更・${dialog.deletedIds.length}件の削除を保存しますか？`}</Text>
        {dialog !== 'close' && <ScrollView style={{ maxHeight: 180 }}>{dialog.changes.map(change => <Text key={change.id} style={{ color: colors.text }}>{change.type === 'softDelete' ? '− 削除' : change.before ? '変更' : '＋ 新規'}: {String(change.after.title)}（{textChangeLabels(change.fields).join('、')}）</Text>)}</ScrollView>}
        <View style={s.actions}><ActionButton label="編集を続ける" disabled={busy} onPress={() => setDialog(null)} />{dialog === 'close' ? <>{closeTextChoices(dirty, strictErrors || !!problem).includes('save') && <ActionButton label="保存して閉じる" disabled={busy} onPress={save} />}<ActionButton label="変更を破棄して閉じる" disabled={busy} onPress={finish} /></> : <ActionButton label="確認して保存" disabled={busy} onPress={() => void execute(dialog, true)} />}</View>
      </View>}
    </SafeAreaView>
  </Modal>;
}

export function TextViewScreen({ snapshot, onClose }: { snapshot: TextViewSnapshot; onClose: () => void }) {
  const { colors } = useAppTheme();
  const [enabled, setEnabled] = useState<TextDetail[]>([]), [labels, setLabels] = useState(false), [message, setMessage] = useState('');
  const text = useMemo(() => renderTextView(snapshot, enabled, labels), [snapshot, enabled, labels]);
  const input = useRef<TextInput>(null);
  return <Modal visible animationType="slide" onRequestClose={onClose}><SafeAreaView style={[s.screen, { backgroundColor: colors.background }]}>
    <View style={s.actions}><Text accessibilityRole="header" style={[s.heading, { color: colors.text }]}>テキストView · {snapshot.view === 'tree' ? 'ツリー' : '一覧'}（読み取り専用）</Text>
      <Pressable accessibilityRole="button" onPress={onClose} style={[s.button, { backgroundColor: colors.surfaceAlt }]}><Text style={{ color: colors.text }}>閉じる</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => { setMessage(''); void Clipboard.setStringAsync(text).then(ok => setMessage(ok ? 'コピーしました' : 'コピーできませんでした。本文を選択してコピーしてください。')).catch(() => setMessage('コピーできませんでした。本文を選択してコピーしてください。')); }} style={[s.button, { backgroundColor: colors.surfaceAlt }]}><Text style={{ color: colors.text }}>コピー</Text></Pressable>
    </View>
    <View style={s.actions}>{[...Object.entries(TEXT_DETAIL_LABELS), ['labels', '項目名を表示']].map(([key, label]) => {
      const checked = key === 'labels' ? labels : enabled.includes(key as TextDetail);
      return <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => key === 'labels' ? setLabels(!labels) : setEnabled(current => checked ? current.filter(k => k !== key) : [...current, key as TextDetail])} style={s.button}><Text style={{ color: colors.text }}>{checked ? '☑' : '☐'} {label}</Text></Pressable>;
    })}</View>
    {!!message && <Text accessibilityLiveRegion="polite" style={{ color: colors.text, padding: 12 }}>{message}</Text>}
    <ScrollView contentContainerStyle={s.content}><FormTextInput ref={input} accessibilityLabel="読み取り専用テキストView" multiline editable={false} value={text} style={[s.editor, { minHeight: 500, color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} /></ScrollView>
  </SafeAreaView></Modal>;
}
const s = StyleSheet.create({ screen: { flex: 1 }, actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 10 }, heading: { fontSize: 17, fontWeight: '700', flexGrow: 1 }, content: { padding: 12, gap: 12 }, button: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', borderRadius: 8 }, editor: { minHeight: 260, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 14, lineHeight: 22, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', textAlignVertical: 'top' }, notice: { padding: 10, borderWidth: 1, borderRadius: 8, gap: 6 }, region: { borderWidth: 2, padding: 10, marginVertical: 4 }, line: { flexDirection: 'row', alignItems: 'center', padding: 5 }, cell: { paddingHorizontal: 8, minWidth: 75 }, dialog: { borderTopWidth: 1, padding: 12, gap: 8 } });
