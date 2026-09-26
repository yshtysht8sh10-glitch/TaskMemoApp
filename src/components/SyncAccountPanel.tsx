import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { User } from 'firebase/auth';
import type { TaskMemoSyncStatus } from '@/hooks/useTaskMemoSync';
import type { TaskMemoEnvironment } from '@/services/firebaseConfig';
import { useAppTheme, type ThemeColors } from '@/theme/theme';

type Props = { protocol: 1 | 2; devNetwork?: { paused: boolean; toggle: () => Promise<void> }; configured: boolean; environment: TaskMemoEnvironment | null; configurationError: string | null; user: User | null; status: TaskMemoSyncStatus; error: string | null; onSignIn: (email: string, password: string) => Promise<void>; onSignUp: (email: string, password: string) => Promise<void>; onSignOut: () => Promise<void> };
const labels: Record<TaskMemoSyncStatus, string> = { disabled: '未設定', 'signed-out': '未ログイン', connecting: '接続中…', diagnostic: '復旧診断のため安全停止', synced: '同期済み', pending: '送信待ち', retrying: '再送中', offline: 'オフライン（ローカル保存中）', error: '同期エラー' };

export function SyncAccountPanel({ protocol, devNetwork, configured, environment, configurationError, user, status, error, onSignIn, onSignUp, onSignOut }: Props) {
  const styles = createStyles(useAppTheme().colors); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); setPassword(''); } catch {} finally { setBusy(false); } };
  return <View style={styles.container}><Text style={styles.status}>クラウド同期: {labels[status]}</Text>
    {environment === 'development' && <Text style={styles.development}>DEV環境 · 本番データには接続しません</Text>}
    {environment === 'development' && <Text>同期プロトコル: V{protocol}</Text>}
    {devNetwork && <Pressable accessibilityRole="button" onPress={() => run(devNetwork.toggle)} style={styles.secondary}><Text>{devNetwork.paused ? 'Emulator通信を再開' : 'Emulator通信を停止'}</Text></Pressable>}
    {!configured ? <Text style={styles.error}>{configurationError ?? 'Firebase設定がありません。クラウド同期を無効化しました。'}</Text> : user ? <><Text style={styles.email}>{user.email}</Text><Text style={styles.help}>{environment === 'development' ? 'V2 revision / durable outboxで同期しています。競合順序は端末時計に依存しません。' : 'このアカウントでWeb/AndroidのNodeを共有します。'}</Text><Pressable disabled={busy} style={styles.secondary} onPress={() => run(onSignOut)}><Text style={styles.secondaryText}>ログアウト</Text></Pressable></> : <><TextInput autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="メールアドレス" style={styles.input} /><TextInput secureTextEntry value={password} onChangeText={setPassword} placeholder="パスワード（6文字以上）" style={styles.input} /><View style={styles.buttons}><Pressable disabled={busy || !email || password.length < 6} style={[styles.primary, (busy || !email || password.length < 6) && styles.disabled]} onPress={() => run(() => onSignIn(email, password))}><Text style={styles.primaryText}>ログイン</Text></Pressable><Pressable disabled={busy || !email || password.length < 6} style={[styles.secondary, (busy || !email || password.length < 6) && styles.disabled]} onPress={() => run(() => onSignUp(email, password))}><Text style={styles.secondaryText}>新規登録</Text></Pressable></View><Text style={styles.help}>ログイン後、端末の変更をdurable outboxから安全に同期します。</Text></>}
    {error && <Text style={styles.error}>{error}</Text>}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({ container: { gap: 10, paddingVertical: 8 }, status: { color: colors.text, fontSize: 16, fontWeight: '700' }, development: { alignSelf: 'flex-start', color: '#6d3b00', backgroundColor: '#ffd08a', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12, fontWeight: '800' }, email: { color: colors.textSecondary }, help: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 }, error: { color: colors.danger, fontSize: 13 }, input: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.text, backgroundColor: colors.surface }, buttons: { flexDirection: 'row', gap: 10 }, primary: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.accent }, primaryText: { color: colors.background, fontWeight: '700' }, secondary: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surfaceAlt }, secondaryText: { color: colors.text, fontWeight: '700' }, disabled: { opacity: .4 } });
