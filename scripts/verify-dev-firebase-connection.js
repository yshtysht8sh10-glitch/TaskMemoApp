const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function readEnvLocal() {
  const values = new Map();
  const envPath = path.join(process.cwd(), '.env.local');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values.set(match[1], value);
  }
  return values;
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${body.error?.message ?? response.statusText}`);
  return body;
}

async function main() {
  const values = readEnvLocal();
  const environment = values.get('EXPO_PUBLIC_TASKMEMO_ENV');
  const projectId = values.get('EXPO_PUBLIC_FIREBASE_PROJECT_ID');
  const apiKey = values.get('EXPO_PUBLIC_FIREBASE_API_KEY');
  if (environment !== 'development' || projectId !== 'taskmemoapp-dev' || !apiKey) {
    throw new Error('dev project guard failed; connection test was not started');
  }

  const token = crypto.randomUUID();
  const email = `taskmemo-connection-${token}@example.invalid`;
  const password = `Tmp-${crypto.randomBytes(18).toString('base64url')}`;
  let idToken;
  let localId;
  let documentUrl;
  try {
    const auth = await jsonRequest(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    idToken = auth.idToken;
    localId = auth.localId;
    console.log('dev Authentication: PASS');

    documentUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${localId}/diagnostics/${token}`;
    const headers = { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' };
    await jsonRequest(documentUrl, { method: 'PATCH', headers, body: JSON.stringify({ fields: { purpose: { stringValue: 'connection-check' } } }) });
    const read = await jsonRequest(documentUrl, { headers });
    if (read.fields?.purpose?.stringValue !== 'connection-check') throw new Error('Firestore read-back mismatch');
    console.log('dev Firestore own-user read/write: PASS');

    const forbiddenUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/not-${localId}/diagnostics/${token}`;
    const forbidden = await fetch(forbiddenUrl, { method: 'PATCH', headers, body: JSON.stringify({ fields: { purpose: { stringValue: 'must-fail' } } }) });
    if (forbidden.status !== 403) throw new Error(`cross-user write returned ${forbidden.status}, expected 403`);
    console.log('dev Firestore cross-user isolation: PASS');
  } finally {
    if (documentUrl && idToken) await fetch(documentUrl, { method: 'DELETE', headers: { authorization: `Bearer ${idToken}` } });
    if (idToken) await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${apiKey}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
    });
  }
}

main().catch((error) => {
  console.error(`dev Firebase connection check failed: ${error.message}`);
  process.exitCode = 1;
});
