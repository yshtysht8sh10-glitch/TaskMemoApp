import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import express, { type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { TaskMemoApplicationService } from '../../src/external-ai/taskMemoApplicationService.js';
import { FirestoreTaskMemoNodeRepository } from './firestoreNodeRepository.js';
import { FirestoreOAuthStore } from './firestoreOAuthStore.js';
import { createTaskMemoMcpServer } from './mcpServer.js';
import { OAuthService } from './oauthService.js';

initializeApp();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

const oauth = new OAuthService(new FirestoreOAuthStore());
const taskMemo = new TaskMemoApplicationService(new FirestoreTaskMemoNodeRepository());
const configuredBase = process.env.TASKMEMO_MCP_BASE_URL?.replace(/\/$/, '');
const webOrigin = process.env.TASKMEMO_WEB_ORIGIN?.replace(/\/$/, '');

const baseUrl = (request: Request) => configuredBase ?? `${request.protocol}://${request.get('host')}`;
const mcpResource = (request: Request) => `${baseUrl(request)}/mcp`;
const bearer = (request: Request) => {
  const match = request.get('authorization')?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
};
const noStore = (response: Response) => response.set('Cache-Control', 'no-store');

app.use((request, response, next) => {
  const origin = request.get('origin');
  if (origin && webOrigin && origin === webOrigin) {
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
    response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (request.method === 'OPTIONS') return origin === webOrigin ? response.status(204).send() : response.status(403).send();
  next();
});

app.get('/.well-known/oauth-protected-resource', (request, response) => response.json({
  resource: mcpResource(request), authorization_servers: [baseUrl(request)], bearer_methods_supported: ['header'], scopes_supported: ['taskmemo'],
}));
app.get('/.well-known/oauth-authorization-server', (request, response) => response.json({
  issuer: baseUrl(request), authorization_endpoint: `${baseUrl(request)}/oauth/authorize`, token_endpoint: `${baseUrl(request)}/oauth/token`,
  registration_endpoint: `${baseUrl(request)}/oauth/register`, revocation_endpoint: `${baseUrl(request)}/oauth/revoke`,
  response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['taskmemo'],
}));

app.post('/oauth/register', async (request, response) => {
  try {
    const redirectUris = Array.isArray(request.body.redirect_uris) ? request.body.redirect_uris.filter((value: unknown): value is string => typeof value === 'string') : [];
    const client = await oauth.registerClient(typeof request.body.client_name === 'string' ? request.body.client_name : 'MCP client', redirectUris);
    noStore(response).status(201).json({ client_id: client.clientId, client_name: client.clientName, redirect_uris: client.redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
  } catch { noStore(response).status(400).json({ error: 'invalid_client_metadata' }); }
});

app.get('/oauth/authorize', async (request, response) => {
  if (!webOrigin) return response.status(503).send('TASKMEMO_WEB_ORIGIN is not configured.');
  try {
    if (request.query.response_type !== 'code' || request.query.code_challenge_method !== 'S256') throw new Error('invalid_request');
    const authorizationInput = {
      clientId: String(request.query.client_id ?? ''), redirectUri: String(request.query.redirect_uri ?? ''),
      state: typeof request.query.state === 'string' ? request.query.state : undefined,
      codeChallenge: String(request.query.code_challenge ?? ''), scope: String(request.query.scope ?? 'taskmemo'),
      resource: String(request.query.resource ?? mcpResource(request)),
    };
    if (authorizationInput.resource !== mcpResource(request) || authorizationInput.scope.split(' ').some((scope) => scope !== 'taskmemo')) throw new Error('invalid_target');
    const authorization = await oauth.beginAuthorization(authorizationInput);
    const destination = new URL(webOrigin); destination.searchParams.set('externalAiAuthorization', authorization.id);
    noStore(response).redirect(destination.toString());
  } catch { noStore(response).status(400).send('Invalid OAuth authorization request.'); }
});

app.post('/oauth/approve', async (request, response) => {
  try {
    const idToken = bearer(request); if (!idToken) return response.status(401).json({ error: 'unauthorized' });
    const identity = await getAuth().verifyIdToken(idToken, true);
    const approved = await oauth.approve(String(request.body.requestId ?? ''), identity.uid);
    const redirect = new URL(approved.request.redirectUri); redirect.searchParams.set('code', approved.code);
    if (approved.request.state) redirect.searchParams.set('state', approved.request.state);
    noStore(response).json({ redirectTo: redirect.toString() });
  } catch { noStore(response).status(400).json({ error: 'invalid_request' }); }
});

app.post('/oauth/token', async (request, response) => {
  try {
    const pair = request.body.grant_type === 'authorization_code'
      ? await oauth.exchangeCode(String(request.body.code ?? ''), String(request.body.client_id ?? ''), String(request.body.redirect_uri ?? ''), String(request.body.code_verifier ?? ''))
      : request.body.grant_type === 'refresh_token'
        ? await oauth.refresh(String(request.body.refresh_token ?? ''), String(request.body.client_id ?? ''))
        : null;
    if (!pair) throw new Error('unsupported_grant_type');
    noStore(response).json({ access_token: pair.accessToken, refresh_token: pair.refreshToken, token_type: 'Bearer', expires_in: pair.expiresIn, scope: pair.scope });
  } catch (error) {
    const code = error instanceof Error && error.message === 'unsupported_grant_type' ? 'unsupported_grant_type' : 'invalid_grant';
    noStore(response).status(400).json({ error: code });
  }
});

app.post('/oauth/revoke', async (request, response) => { if (typeof request.body.token === 'string') await oauth.revoke(request.body.token); noStore(response).status(200).send(); });
app.post('/api/external-ai/revoke-all', async (request, response) => {
  try { const token = bearer(request); if (!token) return response.status(401).json({ error: 'unauthorized' }); const identity = await getAuth().verifyIdToken(token, true); const revoked = await oauth.revokeUser(identity.uid); noStore(response).json({ revoked }); }
  catch { noStore(response).status(401).json({ error: 'unauthorized' }); }
});
app.get('/api/external-ai/status', async (request, response) => {
  try { const token = bearer(request); if (!token) return response.status(401).json({ error: 'unauthorized' }); const identity = await getAuth().verifyIdToken(token, true); noStore(response).json(await oauth.connectionStatus(identity.uid)); }
  catch { noStore(response).status(401).json({ error: 'unauthorized' }); }
});

app.all('/mcp', async (request, response) => {
  const token = bearer(request);
  const auth = token ? await oauth.authenticate(token, mcpResource(request)) : null;
  if (!auth) {
    response.set('WWW-Authenticate', `Bearer resource_metadata="${baseUrl(request)}/.well-known/oauth-protected-resource"`);
    return response.status(401).json({ error: 'invalid_token' });
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createTaskMemoMcpServer(taskMemo, { uid: auth.uid }, auth.clientId);
  response.on('close', () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(request, response, request.body);
});

export { app };
