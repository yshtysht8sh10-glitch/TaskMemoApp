import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';
const initialized = new WeakSet<FirebaseApp>();
export function initializeOnboardingAppCheck(app: FirebaseApp) {
  if (initialized.has(app) || app.options.projectId?.startsWith('demo-')) return;
  const key = process.env.EXPO_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY;
  if (!key) throw new Error('App Checkの安全設定がありません。クラウド新規登録の準備を停止しました。');
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(key), isTokenAutoRefreshEnabled: true });
  initialized.add(app);
}
