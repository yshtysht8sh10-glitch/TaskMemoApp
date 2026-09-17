import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OAuthService, type AuthorizationCode, type AuthorizationRequest, type OAuthClient, type OAuthStore, type StoredToken } from './oauthService.js';

class MemoryStore implements OAuthStore {
  clients = new Map<string, OAuthClient>(); requests = new Map<string, AuthorizationRequest>(); codes = new Map<string, AuthorizationCode>(); tokens = new Map<string, StoredToken>();
  async putClient(v: OAuthClient) { this.clients.set(v.clientId, v); } async getClient(id: string) { return this.clients.get(id) ?? null; }
  async putRequest(v: AuthorizationRequest) { this.requests.set(v.id, v); } async takeRequest(id: string) { const v = this.requests.get(id) ?? null; this.requests.delete(id); return v; }
  async putCode(id: string, v: AuthorizationCode) { this.codes.set(id, v); } async takeCode(id: string) { const v = this.codes.get(id) ?? null; this.codes.delete(id); return v; }
  async putToken(v: StoredToken) { this.tokens.set(v.tokenHash, v); } async getToken(id: string) { return this.tokens.get(id) ?? null; }
  async revokeToken(id: string, at: Date) { const v = this.tokens.get(id); if (v) v.revokedAt = at; }
  async revokeUser(uid: string, at: Date) { let count = 0; for (const v of this.tokens.values()) if (v.uid === uid && !v.revokedAt) { v.revokedAt = at; count++; } return count; }
  async listUserTokens(uid: string) { return [...this.tokens.values()].filter((token) => token.uid === uid); }
}

const challenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

describe('OAuthService', () => {
  it('uses PKCE, rotates refresh tokens, checks resource audience, and revokes per user', async () => {
    const store = new MemoryStore(); const service = new OAuthService(store, () => new Date('2026-09-16T00:00:00Z'));
    const client = await service.registerClient('Claude', ['https://claude.ai/api/mcp/auth_callback']);
    const request = await service.beginAuthorization({ clientId: client.clientId, redirectUri: client.redirectUris[0], codeChallenge: challenge('verifier'), resource: 'https://example.test/mcp', scope: 'taskmemo' });
    const approved = await service.approve(request.id, 'uid-a');
    const tokens = await service.exchangeCode(approved.code, client.clientId, client.redirectUris[0], 'verifier');
    await expect(service.exchangeCode(approved.code, client.clientId, client.redirectUris[0], 'verifier')).rejects.toThrow('invalid_grant');
    expect(await service.authenticate(tokens.accessToken, 'https://example.test/mcp')).toMatchObject({ uid: 'uid-a' });
    expect(await service.authenticate(tokens.accessToken, 'https://wrong.test/mcp')).toBeNull();
    const rotated = await service.refresh(tokens.refreshToken, client.clientId);
    expect(await service.connectionStatus('uid-a')).toEqual({ connectedClientCount: 1 });
    await expect(service.refresh(tokens.refreshToken, client.clientId)).rejects.toThrow('invalid_grant');
    expect(await service.revokeUser('uid-a')).toBe(3);
    expect(await service.connectionStatus('uid-a')).toEqual({ connectedClientCount: 0 });
    expect(await service.authenticate(rotated.accessToken, 'https://example.test/mcp')).toBeNull();
  });

  it('rejects insecure remote redirects', async () => {
    await expect(new OAuthService(new MemoryStore()).registerClient('bad', ['http://example.com/callback'])).rejects.toThrow('invalid_redirect_uri');
  });
});
