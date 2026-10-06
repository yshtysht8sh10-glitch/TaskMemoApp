import type { FirebaseApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck } from 'firebase/app-check';
type TokenProvider = () => Promise<{ token: string; expireTimeMillis: number }>;
let tokenProvider: TokenProvider | null = null;
const initialized = new WeakSet<FirebaseApp>();
/** Install only a reviewed native attestation-to-Firebase-App-Check bridge. */
export function configureNativeOnboardingAppCheck(provider: TokenProvider) { tokenProvider = provider; }
/** Native attestation must be supplied by the reviewed platform integration. */
export function initializeOnboardingAppCheck(app: FirebaseApp) {
  if (initialized.has(app)) return;
  if (!tokenProvider) throw new Error('この端末のApp Check連携が未設定です。クラウド新規登録の準備を停止しました。');
  initializeAppCheck(app, { provider: new CustomProvider({ getToken: tokenProvider }), isTokenAutoRefreshEnabled: true });
  initialized.add(app);
}
