import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { User } from 'firebase/auth';
import type { FirebaseSyncStatus } from '@/hooks/useFirebaseSync';
import { useAppTheme, type ThemeColors } from '@/theme/theme';

type Props = { configured: boolean; user: User | null; status: FirebaseSyncStatus; error: string | null; onSignIn: (email: string, password: string) => Promise<void>; onSignUp: (email: string, password: string) => Promise<void>; onSignOut: () => Promise<void> };
const labels: Record<FirebaseSyncStatus, string> = { disabled: '未設定', 'signed-out': '未ログイン', connecting: '接続中…', synced: '同期済み', offline: 'オフライン（ローカル保存中）', error: '同期エラー' };

export function SyncAccountPanel({ configured, user, status, error, onSignIn, onSignUp, onSignOut }: Props) {
  const styles = createStyles(useAppTheme().colors); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); setPassword(''); } catch {} finally { setBusy(false); } };
  return <View style={styles.container}><Text style={styles.status}>クラウド同期: {labels[status]}</Text>
    {!configured ? <Text style={styles.help}>`.env`にFirebaseのEXPO_PUBLIC_*設定を追加してください。ローカル保存は引き続き利用できます。</Text> : user ? <><Text style={styles.email}>{user.email}</Text><Text style={styles.help}>このアカウントでWeb/AndroidのNodeを共有します。競合時はNodeごとに更新日時が新しい内容を採用します。</Text><Pressable disabled={busy} style={styles.secondary} onPress={() => run(onSignOut)}><Text style={styles.secondaryText}>ログアウト</Text></Pressable></> : <><TextInput autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="メールアドレス" style={styles.input} /><TextInput secureTextEntry value={password} onChangeText={setPassword} placeholder="パスワード（6文字以上）" style={styles.input} /><View style={styles.buttons}><Pressable disabled={busy || !email || password.length < 6} style={[styles.primary, (busy || !email || password.length < 6) && styles.disabled]} onPress={() => run(() => onSignIn(email, password))}><Text style={styles.primaryText}>ログイン</Text></Pressable><Pressable disabled={busy || !email || password.length < 6} style={[styles.secondary, (busy || !email || password.length < 6) && styles.disabled]} onPress={() => run(() => onSignUp(email, password))}><Text style={styles.secondaryText}>新規登録</Text></Pressable></View><Text style={styles.help}>初回ログイン時はローカルとクラウドをNodeごとに安全にマージし、両方にしかない項目も保持します。</Text></>}
    {error && <Text style={styles.error}>{error}</Text>}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({ container: { gap: 10, paddingVertical: 8 }, status: { color: colors.text, fontSize: 16, fontWeight: '700' }, email: { color: colors.textSecondary }, help: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 }, error: { color: colors.danger, fontSize: 13 }, input: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.text, backgroundColor: colors.surface }, buttons: { flexDirection: 'row', gap: 10 }, primary: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.accent }, primaryText: { color: colors.background, fontWeight: '700' }, secondary: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surfaceAlt }, secondaryText: { color: colors.text, fontWeight: '700' }, disabled: { opacity: .4 } });
