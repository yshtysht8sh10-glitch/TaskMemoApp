import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, type Persistence } from 'firebase/auth';
import * as FirebaseAuth from '@firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebasePublicConfig } from './firebaseConfig';

export function getFirebaseClient() {
  const config = firebasePublicConfig();
  if (!config) throw new Error('Firebase環境変数が設定されていません。');
  const existed = getApps().length > 0;
  const app = existed ? getApp() : initializeApp(config);
  const getReactNativePersistence = (FirebaseAuth as typeof FirebaseAuth & {
    getReactNativePersistence(storage: typeof AsyncStorage): Persistence;
  }).getReactNativePersistence;
  const auth = existed ? getAuth(app) : initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  return { auth, db: getFirestore(app) };
}
