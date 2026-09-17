import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type OAuthClient = { clientId: string; redirectUris: string[]; clientName: string; createdAt: Date };
export type AuthorizationRequest = {
  id: string; clientId: string; redirectUri: string; state?: string; codeChallenge: string;
  scope: string; resource: string; expiresAt: Date;
};
export type AuthorizationCode = AuthorizationRequest & { uid: string };
export type StoredToken = {
  tokenHash: string; uid: string; clientId: string; resource: string; scope: string;
  kind: 'access' | 'refresh'; expiresAt: Date; revokedAt: Date | null;
};

export interface OAuthStore {
  putClient(client: OAuthClient): Promise<void>;
  getClient(clientId: string): Promise<OAuthClient | null>;
  putRequest(request: AuthorizationRequest): Promise<void>;
  takeRequest(id: string): Promise<AuthorizationRequest | null>;
  putCode(codeHash: string, code: AuthorizationCode): Promise<void>;
  takeCode(codeHash: string): Promise<AuthorizationCode | null>;
  putToken(token: StoredToken): Promise<void>;
  getToken(tokenHash: string): Promise<StoredToken | null>;
  revokeToken(tokenHash: string, revokedAt: Date): Promise<void>;
  revokeUser(uid: string, revokedAt: Date): Promise<number>;
  listUserTokens(uid: string): Promise<StoredToken[]>;
}

const opaque = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('base64url');

function validRedirectUri(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname));
  } catch { return false; }
}

export class OAuthService {
  constructor(private readonly store: OAuthStore, private readonly now: () => Date = () => new Date()) {}

  async registerClient(clientName: string, redirectUris: string[]) {
    if (!redirectUris.length || redirectUris.some((uri) => !validRedirectUri(uri))) throw new Error('invalid_redirect_uri');
    const client: OAuthClient = { clientId: opaque(), clientName: clientName.slice(0, 100) || 'MCP client', redirectUris: [...new Set(redirectUris)], createdAt: this.now() };
    await this.store.putClient(client);
    return client;
  }

  async beginAuthorization(input: Omit<AuthorizationRequest, 'id' | 'expiresAt'>) {
    const client = await this.store.getClient(input.clientId);
    if (!client || !client.redirectUris.includes(input.redirectUri)) throw new Error('invalid_client');
    if (!input.codeChallenge) throw new Error('invalid_request');
    const request: AuthorizationRequest = { ...input, id: opaque(), expiresAt: new Date(this.now().getTime() + 10 * 60_000) };
    await this.store.putRequest(request);
    return request;
  }

  async approve(requestId: string, uid: string) {
    const request = await this.store.takeRequest(requestId);
    if (!request || request.expiresAt <= this.now()) throw new Error('invalid_request');
    const code = opaque();
    await this.store.putCode(hash(code), { ...request, uid });
    return { code, request };
  }

  async exchangeCode(code: string, clientId: string, redirectUri: string, verifier: string) {
    const stored = await this.store.takeCode(hash(code));
    if (!stored || stored.expiresAt <= this.now() || stored.clientId !== clientId || stored.redirectUri !== redirectUri) throw new Error('invalid_grant');
    const expected = Buffer.from(stored.codeChallenge);
    const actual = Buffer.from(hash(verifier));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('invalid_grant');
    return this.issuePair(stored.uid, clientId, stored.resource, stored.scope);
  }

  async refresh(refreshToken: string, clientId: string) {
    const tokenHash = hash(refreshToken);
    const stored = await this.store.getToken(tokenHash);
    if (!stored || stored.kind !== 'refresh' || stored.clientId !== clientId || stored.revokedAt || stored.expiresAt <= this.now()) throw new Error('invalid_grant');
    await this.store.revokeToken(tokenHash, this.now());
    return this.issuePair(stored.uid, clientId, stored.resource, stored.scope);
  }

  async authenticate(accessToken: string, resource: string) {
    const stored = await this.store.getToken(hash(accessToken));
    if (!stored || stored.kind !== 'access' || stored.resource !== resource || stored.revokedAt || stored.expiresAt <= this.now()) return null;
    return { uid: stored.uid, clientId: stored.clientId, scope: stored.scope };
  }

  async revoke(token: string) { await this.store.revokeToken(hash(token), this.now()); }
  async revokeUser(uid: string) { return this.store.revokeUser(uid, this.now()); }
  async connectionStatus(uid: string) {
    const now = this.now(); const tokens = await this.store.listUserTokens(uid);
    return { connectedClientCount: new Set(tokens.filter((token) => token.kind === 'refresh' && !token.revokedAt && token.expiresAt > now).map((token) => token.clientId)).size };
  }

  private async issuePair(uid: string, clientId: string, resource: string, scope: string) {
    const accessToken = opaque(); const refreshToken = opaque(); const current = this.now();
    await this.store.putToken({ tokenHash: hash(accessToken), uid, clientId, resource, scope, kind: 'access', expiresAt: new Date(current.getTime() + 60 * 60_000), revokedAt: null });
    await this.store.putToken({ tokenHash: hash(refreshToken), uid, clientId, resource, scope, kind: 'refresh', expiresAt: new Date(current.getTime() + 30 * 24 * 60 * 60_000), revokedAt: null });
    return { accessToken, refreshToken, expiresIn: 3600, scope };
  }
}

export const oauthTokenHash = hash;
