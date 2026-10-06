import { getAuth } from 'firebase-admin/auth';
import { getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { OnboardingBlocked, validateRequest } from './decision.js';
import { provisionAccount } from './repository.js';
const attempts = new Map<string, { start: number; count: number }>();

export async function handleOnboarding(request: CallableRequest) {
  try {
    validateRequest(request.data);
    if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。');
    const projectId = getApp().options.projectId ?? process.env.GCLOUD_PROJECT ?? '';
    if (!['taskmemoapp-dev', 'taskmemoapp-eabc3', 'demo-taskmemo-onboarding'].includes(projectId))
      throw new OnboardingBlocked('project-invalid');
    if (process.env.FUNCTIONS_EMULATOR !== 'true' &&
      !process.env.TASKMEMO_ONBOARDING_SERVICE_ACCOUNT?.endsWith(`@${projectId}.iam.gserviceaccount.com`))
      throw new OnboardingBlocked('service-account-unconfigured');
    const bearer = request.rawRequest.headers.authorization;
    if (!bearer?.startsWith('Bearer ')) throw new HttpsError('unauthenticated', '認証を確認できません。');
    const token = await getAuth().verifyIdToken(bearer.slice(7), true);
    if (token.uid !== request.auth.uid || token.firebase.tenant) throw new HttpsError('unauthenticated', '認証scopeが不正です。');
    const user = await getAuth().getUser(token.uid);
    if (user.disabled || user.tenantId) throw new HttpsError('unauthenticated', 'アカウントを利用できません。');
    const now = Date.now(), previous = attempts.get(user.uid);
    if (previous && now - previous.start < 60000) {
      if (++previous.count > 10) throw new HttpsError('resource-exhausted', '少し待ってから再試行してください。');
    } else {
      for (const [id, attempt] of attempts) if (now - attempt.start >= 60000) attempts.delete(id);
      if (attempts.size >= 1024) throw new HttpsError('resource-exhausted', '少し待ってから再試行してください。');
      attempts.set(user.uid, { start: now, count: 1 });
    }
    const provider = token.firebase.sign_in_provider === 'password' && user.providerData.some(p => p.providerId === 'password') ? 'password' : 'ineligible';
    const result = await provisionAccount(getFirestore(), { uid: user.uid, projectId,
      authCreatedAt: Date.parse(user.metadata.creationTime), provider });
    return { schemaVersion: 1, state: 'ready', result, protocol: 2 };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof OnboardingBlocked) throw new HttpsError(error.reason === 'request-invalid' ? 'invalid-argument' : 'failed-precondition',
      'クラウド利用の安全条件を確認できません。', { reason: error.reason });
    throw new HttpsError('unavailable', 'クラウド利用の準備を完了できません。再試行してください。');
  }
}
// Emulator is the only place where attestation enforcement is disabled.
export const ensureAccountV2Ready = onCall({ region: 'asia-northeast1', timeoutSeconds: 30, maxInstances: 3,
  serviceAccount: process.env.TASKMEMO_ONBOARDING_SERVICE_ACCOUNT,
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true' }, handleOnboarding);
