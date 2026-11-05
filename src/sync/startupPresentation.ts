export type StartupInput = {
  preferencesReady: boolean; authReady: boolean; applicationState: 'opening' | 'ready' | 'error';
  account: boolean; snapshotSource: 'checking' | 'cache' | 'server'; status: string;
  elapsed: boolean; cacheEditing: boolean;
};
export function startupPresentation(input: StartupInput) {
  const result = (message: string, showData = false, editable = false, canUseCache = false) => ({ message, showData, editable, canUseCache });
  if (!input.preferencesReady) return result('表示設定を読み込んでいます…');
  if (input.applicationState === 'error') return result('保存データを開けません。原本を保持して停止しています。');
  if (!input.authReady) return result('ログイン状態を確認しています…');
  if (input.applicationState !== 'ready') return result('端末の保存データを復元しています…');
  if (!input.account) return result('この端末のローカルデータ · クラウド同期なし', true, true);
  if (['diagnostic', 'self-repairing', 'ownership-importing'].includes(input.status)) return result('同期の確認・復旧中です。編集は停止しています。', true);
  if (input.status === 'local-recovery') return result('ローカル復旧モード · クラウド同期停止中', true, true);
  if (input.snapshotSource === 'server' && !['offline', 'error', 'retrying', 'connecting', 'onboarding'].includes(input.status))
    return result(input.status === 'synced' ? 'クラウドの一覧を確認済み' : 'クラウドの一覧を確認済み · 同期処理中', true, true);
  const failed = ['offline', 'error', 'retrying'].includes(input.status);
  // ready means the active account has passed local/Journal checks. Browsing
  // need not wait for Cloud; retain the existing delay/consent for editing.
  const canChooseCache = input.elapsed || failed;
  const guidance = !failed && !(canChooseCache && input.cacheEditing)
    ? ' クラウドのデータを確認しています。完了すると編集できます。' : '';
  return result(`端末データを表示中 · 最新状態は未確認${failed ? '（通信・同期を確認してください）' : '（クラウド確認中）'}${canChooseCache && input.cacheEditing ? ' · 端末データの編集を選択中' : ' · 閲覧のみ'}`
    + guidance, true, canChooseCache && input.cacheEditing, canChooseCache && !input.cacheEditing);
}
