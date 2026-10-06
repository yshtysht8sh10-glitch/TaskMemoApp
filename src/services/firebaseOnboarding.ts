import { getAuth } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import type { FirebaseApp } from 'firebase/app';
import { ensureOnboarding } from './accountOnboarding';
import { initializeOnboardingAppCheck } from './onboardingAppCheck';

const connected = new WeakSet<object>();
export async function prepareFirebaseAccount(app: FirebaseApp, uid: string, current: () => boolean = () => true) {
  if (!app.options.projectId?.startsWith('demo-')) initializeOnboardingAppCheck(app);
  const functions = getFunctions(app, 'asia-northeast1');
  if (app.options.projectId === 'demo-taskmemo-onboarding' && !connected.has(functions)) {
    connectFunctionsEmulator(functions, '127.0.0.1', 5101); connected.add(functions);
  } else if (app.options.projectId === 'demo-taskmemo-v2') {
    throw new Error('このEmulatorにはonboarding serviceがありません。');
  }
  await ensureOnboarding(async request => {
    try { return (await httpsCallable(functions, 'ensureAccountV2Ready', { timeout: 30000 })(request)).data; }
    catch (error) {
      const detail = error as { details?: { reason?: string }; code?: string };
      const reasons: Record<string, string> = {
        'legacy-account': '既存アカウントには管理者による移行確認が必要です。',
        'nonempty-account': '既存のクラウドデータがあるため自動準備しません。',
        'policy-invalid': 'クラウド新規登録の安全設定が準備されていません。',
        'onboarding-disabled': 'クラウド新規登録の準備は停止中です。',
        'receipt-inconsistent': 'クラウド準備の記録が一致しません。復旧確認が必要です。',
        'provider-ineligible': 'この認証方法は自動準備の対象外です。',
        'recovery-active': '移行・復旧状態を確認する必要があります。',
      };
      throw Object.assign(new Error(reasons[detail.details?.reason ?? ''] ?? 'クラウド利用の準備を完了できません。通信・認証・service設定を確認して再試行してください。'), { code: detail.code });
    }
  }, () => current() && getAuth(app).currentUser?.uid === uid);
}
