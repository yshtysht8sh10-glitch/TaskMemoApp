import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, terminate } from 'firebase/firestore';
import { createFirebaseSyncAdapter } from '../src/sync/firebaseSyncAdapter';
const env = readFileSync('.env.local', 'utf8');
const get = (key: string) => env.match(new RegExp('^' + key + '\\s*=\\s*["\x27]?([^"\x27\\r\\n]+)', 'm'))?.[1];
if (get('EXPO_PUBLIC_FIREBASE_PROJECT_ID') !== 'taskmemoapp-dev') throw new Error('DEV required');
async function main() {
  const app = initializeApp({ apiKey: get('EXPO_PUBLIC_FIREBASE_API_KEY'), projectId: 'taskmemoapp-dev', appId: get('EXPO_PUBLIC_FIREBASE_APP_ID') }, 'ownership-readonly');
  const credentials = JSON.parse(readFileSync('artifacts/private/dev-onboarding/test-account.json', 'utf8'));
  const user = await signInWithEmailAndPassword(getAuth(app), credentials.email, credentials.password);
  const db = getFirestore(app);
  try {
    const adapter = createFirebaseSyncAdapter(db, user.user.uid, 'development');
    await adapter.connect();
    const snapshot = await adapter.readRecoverySnapshot!();
    console.log(JSON.stringify({ nodes: snapshot.nodes.length, receipts: snapshot.receiptDocumentCount, profiles: !!snapshot.pinnedNote || !!snapshot.features }));
  } catch (error) { console.log(error); process.exitCode = 1; }
  finally { await terminate(db); }
}
void main();
