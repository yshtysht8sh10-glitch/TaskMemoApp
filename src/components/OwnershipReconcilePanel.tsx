import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { OwnershipPlan } from '../sync/ownershipReconcile';
import { integrateOwnershipSortKeys } from '../sync/ownershipSortKeys';
import { useAppTheme } from '../theme/theme';
import { ConflictComparison } from './ConflictComparison';
type Props = { count: number; recovery: boolean; plan: OwnershipPlan | null; review: () => Promise<void>; commit: (choices: Record<string, 'local' | 'account'>, confirmation?: { fingerprint: string; deletedIds: string[] }) => Promise<void>; skip: () => Promise<void>; close: () => Promise<void> };
export function OwnershipReconcilePanel({ count, recovery, plan, review, commit, skip, close }: Props) {
  const { colors } = useAppTheme();
  const [choices, setChoices] = useState<Record<string, 'local' | 'account'>>({});
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  if (!count && !recovery && !plan) return null;
  const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled || busy} onPress={action} style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, opacity: disabled || busy ? .45 : 1 }}><Text style={{ color: colors.text }}>{label}</Text></Pressable>;
  const deletedIds = plan?.items.filter(i => choices[i.id] === 'local' && i.local?.deletedAt && i.account && !i.account.value.deletedAt && !i.account.value.purgedAt).map(i => i.id) ?? [];
  let orderPreview: ReturnType<typeof integrateOwnershipSortKeys> | null = null;
  let orderError = '';
  if (plan) try { orderPreview = integrateOwnershipSortKeys(plan, choices); }
  catch (e) { orderError = e instanceof Error ? e.message : '取り込み順序を確認できません。'; }
  const reviewAgain = () => void run(async () => { setChoices({}); setConfirmed(false); await review(); });
  return <View style={{ gap: 12, padding: 12, borderWidth: 1, borderColor: colors.border }}>
    <Text style={{ color: colors.text, fontWeight: 'bold' }}>{recovery ? 'ローカル取り込みの復旧が必要です' : `この端末に未取り込みのローカル変更が${count}件あります`}</Text>
    <Text style={{ color: colors.textSecondary }}>ログイン前のローカルデータを、このアカウントへ取り込むか確認します。通常のクラウド同期とは別の操作です。原本は保持されます。</Text>
    {!plan ? <>{button(recovery ? '最新状態を確認して復旧' : '取り込み内容を確認', reviewAgain)}{!recovery && button('アカウント側のみを使用する', () => void run(skip))}</> : <>
      <Text style={{ color: colors.text }}>確認対象: {plan.items.length}件</Text>
      {!!orderPreview?.adjustments.length && <Text style={{ color: colors.textSecondary }}>兄弟順序の重複を避けるため、ローカル採用Node {orderPreview.adjustments.length}件の並び順キーを調整します。アカウント採用側の順序とローカル原本は保持します。</Text>}
      {!!orderError && <Text style={{ color: colors.danger }}>{orderError}</Text>}
      {plan.items.map(item => <View key={item.id} style={{ gap: 8, padding: 10, backgroundColor: colors.surfaceAlt }}>
        <Text style={{ color: colors.text, fontWeight: 'bold' }}>{item.id === '$profile' ? '常設メモ・Idea設定' : String(item.local?.title ?? item.account?.value.title ?? '削除対象')} · {({ same: '同一内容（変更なし）', add: '追加候補', apply: '変更候補', conflict: '個別確認', purged: '削除済み・復活不可' })[item.kind]}</Text>
        <ConflictComparison local={item.id === '$profile' ? plan.source.profile : item.local} account={item.id === '$profile' ? { body: plan.targetProfile.pinnedNote?.value.body ?? '', ideasEnabled: plan.targetProfile.features?.value.ideasEnabled ?? false } : item.account?.value ?? null} />
        {orderPreview?.adjustments.filter(a => a.id === item.id).map(a => <Text key={a.id} style={{ color: colors.textSecondary }}>取り込み先のsortKey: {a.before} → {a.after}（ローカル原本は変更しません）</Text>)}
        {!!item.account?.value.deletedAt && !!item.local && !item.local.deletedAt && <Text style={{ color: colors.textSecondary }}>アカウントのゴミ箱にあるNodeは、この取り込みで復元できません。通常のゴミ箱復元後に再確認してください。</Text>}
        {item.kind !== 'same' && <>{button(`${choices[item.id] === 'local' ? '✓ ' : ''}ローカルを採用`, () => setChoices(c => ({ ...c, [item.id]: 'local' })), item.kind === 'purged' || (item.id !== '$profile' && !item.local) || (!!item.account?.value.deletedAt && !!item.local && !item.local.deletedAt))}{button(`${choices[item.id] === 'account' ? '✓ ' : ''}アカウントを採用`, () => setChoices(c => ({ ...c, [item.id]: 'account' })))}</>}
      </View>)}
      {button('衝突のない追加・変更候補をまとめて選択', () => setChoices(c => ({ ...c, ...Object.fromEntries(plan.items.filter(i => i.kind === 'add' || i.kind === 'apply').map(i => [i.id, 'local' as const])) })))}
      {!!deletedIds.length && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }} onPress={() => setConfirmed(v => !v)}><Text style={{ color: colors.danger }}>{confirmed ? '☑' : '☐'} 削除対象{deletedIds.length}件を確認しました</Text></Pressable>}
      {button('選択内容を確認して取り込む', () => void run(() => commit(choices, { fingerprint: plan.fingerprint, deletedIds })), !!orderError || plan.items.some(i => i.kind !== 'same' && !choices[i.id]) || (!!deletedIds.length && !confirmed))}
      {button('最新状態で再確認', reviewAgain)}{button('後で行う', () => void run(close))}
    </>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
  </View>;
}
