import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { User } from 'firebase/auth';

import { useAppTheme, type ThemeColors } from '@/theme/theme';

type Props = {
  user: User | null;
  authorizationRequestId?: string | null;
  onAuthorized?: () => void;
};

const serverBase = process.env.EXPO_PUBLIC_TASKMEMO_MCP_BASE_URL?.replace(/\/$/, '');

export function ExternalAiConnectionPanel({ user, authorizationRequestId, onAuthorized }: Props) {
  const styles = createStyles(useAppTheme().colors);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [connectedClientCount, setConnectedClientCount] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    if (!serverBase || !user || authorizationRequestId) return;
    user.getIdToken().then((token) => fetch(`${serverBase}/api/external-ai/status`, { headers: { Authorization: `Bearer ${token}` } }))
      .then((response) => response.ok ? response.json() as Promise<{ connectedClientCount: number }> : Promise.reject(new Error()))
      .then((status) => { if (active) setConnectedClientCount(status.connectedClientCount); }).catch(() => { if (active) setConnectedClientCount(null); });
    return () => { active = false; };
  }, [authorizationRequestId, user]);
  const approve = async () => {
    if (!serverBase || !user || !authorizationRequestId) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`${serverBase}/oauth/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken(true)}` },
        body: JSON.stringify({ requestId: authorizationRequestId }),
      });
      const body = await response.json() as { redirectTo?: string };
      if (!response.ok || !body.redirectTo) throw new Error('承認できませんでした。');
      onAuthorized?.(); await Linking.openURL(body.redirectTo);
    } catch (error) { setMessage(error instanceof Error ? error.message : '承認できませんでした。'); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!serverBase || !user) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`${serverBase}/api/external-ai/revoke-all`, { method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken(true)}` } });
      if (!response.ok) throw new Error('連携を解除できませんでした。');
      setConnectedClientCount(0); setMessage('外部AIへ発行した認証情報を失効しました。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '連携を解除できませんでした。'); }
    finally { setBusy(false); }
  };

  return <View style={styles.container}>
    <Text style={styles.heading}>外部AI連携</Text>
    {!serverBase && <Text style={styles.help}>Remote MCPはまだ公開設定されていません。</Text>}
    {serverBase && !user && <Text style={styles.help}>Claudeと連携するには、先にクラウド同期へログインしてください。</Text>}
    {serverBase && user && authorizationRequestId && <>
      <Text style={styles.help}>Claudeが、現在ログイン中のTaskMemoデータを読み書きする許可を求めています。書込み操作はClaude側でも確認されます。</Text>
      <Pressable disabled={busy} style={[styles.primary, busy && styles.disabled]} onPress={approve}><Text style={styles.primaryText}>Claudeとの連携を許可</Text></Pressable>
    </>}
    {serverBase && user && !authorizationRequestId && <>
      <Text style={styles.help}>接続中のクライアント: {connectedClientCount === null ? '確認できません' : `${connectedClientCount}件`}</Text>
      <Text style={styles.help}>Claudeのカスタムコネクタへ次のURLを登録します。</Text><Text selectable style={styles.url}>{serverBase}/mcp</Text>
      <Pressable disabled={busy} style={[styles.secondary, busy && styles.disabled]} onPress={revoke}><Text style={styles.secondaryText}>すべての外部AI連携を解除</Text></Pressable>
    </>}
    {message && <Text style={styles.message}>{message}</Text>}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { gap: 12, paddingVertical: 8 }, heading: { color: colors.text, fontSize: 16, fontWeight: '700' },
  help: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 }, url: { color: colors.accent, fontSize: 12 }, message: { color: colors.text, fontSize: 13 },
  primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.accent }, primaryText: { color: colors.background, fontWeight: '700' },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surfaceAlt }, secondaryText: { color: colors.text, fontWeight: '700' }, disabled: { opacity: .4 },
});
