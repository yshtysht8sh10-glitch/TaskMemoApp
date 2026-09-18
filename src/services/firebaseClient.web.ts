import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { firebaseConfiguration } from './firebaseConfig';

let emulatorConnected = false;

export function getFirebaseClient() {
  const { config, environment } = firebaseConfiguration();
  if (!config) throw new Error('Firebase環境変数が設定されていません。');
  const emulator = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR === 'true';
  if (emulator && (environment !== 'development' || !['localhost', '127.0.0.1'].includes(window.location.hostname)))
    throw new Error('Emulatorはlocalhostのdevelopment UIでのみ使用できます。');
  const app = getApps().length ? getApp() : initializeApp(emulator ? { ...config, projectId: 'demo-taskmemo-v2' } : config);
  const auth = getAuth(app); const db = getFirestore(app);
  if (emulator && !emulatorConnected) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8180);
    emulatorConnected = true;
  }
  return { auth, db };
}
