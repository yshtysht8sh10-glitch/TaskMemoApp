import { useMemo } from 'react';
import { ScrollView, Text } from 'react-native';
import { generateNKeysBetween } from 'fractional-indexing';
import { OwnershipReconcilePanel } from '../components/OwnershipReconcilePanel';
import { planOwnershipReconcile } from '../sync/ownershipReconcile';
import { useAppTheme } from '../theme/theme';

/** DEV visual fixture only: never opens an Application store or cloud connection. */
export default function DevOwnershipBulk() {
  const { colors } = useAppTheme();
  const plan = useMemo(() => {
    if (process.env.EXPO_PUBLIC_TASKMEMO_ENV !== 'development') return null;
    const nodes = Object.fromEntries(generateNKeysBetween(null, null, 120).map((sortKey, i) => {
      const id = `bulk-${String(i + 1).padStart(3, '0')}`;
      return [id, { id, type: 'category', title: `確認 ${i + 1} ローカル`, parentId: null, sortKey,
        createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z', deletedAt: null }];
    }));
    const target = Object.fromEntries(Object.values(nodes).map(value => [value.id, { value: { ...value, title: value.title.replace('ローカル', 'アカウント') },
      operationType: 'update' as const, revision: 2, lastOpId: 'fixture:2', lastDeviceId: 'fixture', lastLocalSeq: 2 }]));
    return planOwnershipReconcile({ scope: 'fixture', nodes, profile: { body: '', ideasEnabled: false } }, target, undefined, 'fixture-account');
  }, []);
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16 }}>
    <Text style={{ color: colors.text, fontSize: 20, fontWeight: 'bold' }}>DEV 一括選択確認</Text>
    <Text style={{ color: colors.textSecondary }}>120件のfixtureです。実アカウント・保存領域・クラウドへ接続しません。最終確定も保存しません。</Text>
    {plan ? <OwnershipReconcilePanel count={120} recovery={false} plan={plan}
      review={async () => {}} close={async () => {}} skip={async () => {}}
      commit={async () => { throw new Error('DEV fixtureのため取り込みません。実データは変更していません。'); }} />
      : <Text style={{ color: colors.text }}>この確認ページはDEV限定です。</Text>}
  </ScrollView>;
}
