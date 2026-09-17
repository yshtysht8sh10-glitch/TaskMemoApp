import { getFirestore, Timestamp } from 'firebase-admin/firestore';

import type { AuthorizationCode, AuthorizationRequest, OAuthClient, OAuthStore, StoredToken } from './oauthService.js';

const datesFrom = <T extends Record<string, unknown>>(value: T) => {
  const result = { ...value };
  for (const key of ['createdAt', 'expiresAt', 'revokedAt']) {
    const item = result[key];
    if (item && typeof item === 'object' && 'toDate' in item && typeof item.toDate === 'function') result[key as keyof T] = item.toDate() as T[keyof T];
  }
  return result;
};
const datesTo = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item instanceof Date ? Timestamp.fromDate(item) : item]));

export class FirestoreOAuthStore implements OAuthStore {
  private readonly db = getFirestore();
  async putClient(client: OAuthClient) { await this.db.collection('externalAiOAuthClients').doc(client.clientId).set(datesTo(client)); }
  async getClient(clientId: string) { const item = await this.db.collection('externalAiOAuthClients').doc(clientId).get(); return item.exists ? datesFrom(item.data()!) as OAuthClient : null; }
  async putRequest(request: AuthorizationRequest) { await this.db.collection('externalAiOAuthRequests').doc(request.id).set(datesTo(request)); }
  async takeRequest(id: string) { return this.take<AuthorizationRequest>('externalAiOAuthRequests', id); }
  async putCode(codeHash: string, code: AuthorizationCode) { await this.db.collection('externalAiOAuthCodes').doc(codeHash).set(datesTo(code)); }
  async takeCode(codeHash: string) { return this.take<AuthorizationCode>('externalAiOAuthCodes', codeHash); }
  async putToken(token: StoredToken) { await this.db.collection('externalAiOAuthTokens').doc(token.tokenHash).set(datesTo(token)); }
  async getToken(tokenHash: string) { const item = await this.db.collection('externalAiOAuthTokens').doc(tokenHash).get(); return item.exists ? datesFrom(item.data()!) as StoredToken : null; }
  async revokeToken(tokenHash: string, revokedAt: Date) { await this.db.collection('externalAiOAuthTokens').doc(tokenHash).set({ revokedAt: Timestamp.fromDate(revokedAt) }, { merge: true }); }
  async revokeUser(uid: string, revokedAt: Date) {
    const snapshot = await this.db.collection('externalAiOAuthTokens').where('uid', '==', uid).where('revokedAt', '==', null).get();
    const batch = this.db.batch(); snapshot.docs.forEach((item) => batch.update(item.ref, { revokedAt: Timestamp.fromDate(revokedAt) }));
    if (!snapshot.empty) await batch.commit(); return snapshot.size;
  }
  async listUserTokens(uid: string) { const snapshot = await this.db.collection('externalAiOAuthTokens').where('uid', '==', uid).get(); return snapshot.docs.map((item) => datesFrom(item.data()) as StoredToken); }
  private async take<T extends Record<string, unknown>>(collection: string, id: string) {
    return this.db.runTransaction(async (transaction) => {
      const ref = this.db.collection(collection).doc(id); const item = await transaction.get(ref);
      if (!item.exists) return null; transaction.delete(ref); return datesFrom(item.data()!) as T;
    });
  }
}
