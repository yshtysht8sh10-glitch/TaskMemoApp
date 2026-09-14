import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebasePublicConfig } from './firebaseConfig';

export function getFirebaseClient() {
  const config = firebasePublicConfig();
  if (!config) throw new Error('Firebase環境変数が設定されていません。');
  const app = getApps().length ? getApp() : initializeApp(config);
  return { auth: getAuth(app), db: getFirestore(app) };
}
