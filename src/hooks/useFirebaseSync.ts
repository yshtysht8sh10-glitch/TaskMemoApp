import { useEffect, useRef, useState } from 'react';
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { collection, doc, getDocs, onSnapshot, writeBatch } from 'firebase/firestore';

import type { Node } from '@/models/node';
import { getFirebaseClient } from '@/services/firebaseClient';
import { firebaseConfiguration } from '@/services/firebaseConfig';
import { applyRemoteDeletionsAsTombstones, mergeNodesByUpdatedAt, nodeFromFirestore, nodeSyncFingerprint, nodeToFirestore, withRemoteTombstones } from '@/services/firebaseNodeCodec';

export type FirebaseSyncStatus = 'disabled' | 'signed-out' | 'connecting' | 'synced' | 'offline' | 'error';

const authMessage = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('invalid-credential')) return 'メールアドレスまたはパスワードが正しくありません。';
  if (code.includes('email-already-in-use')) return 'このメールアドレスは登録済みです。';
  if (code.includes('weak-password')) return 'パスワードは6文字以上にしてください。';
  if (code.includes('invalid-email')) return 'メールアドレスの形式を確認してください。';
  if (code.includes('network-request-failed')) return 'ネットワークへ接続できません。ローカルデータは保持されています。';
  return error instanceof Error ? error.message : 'Firebaseの処理に失敗しました。';
};

export function useFirebaseSync(localNodes: Node[], localReady: boolean, onCloudNodes: (nodes: Node[]) => void) {
  const firebase = firebaseConfiguration();
  const configured = firebase.config !== null;
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [status, setStatus] = useState<FirebaseSyncStatus>(configured ? 'connecting' : 'disabled');
  const [error, setError] = useState<string | null>(null);
  const latestNodes = useRef(localNodes);
  const onCloudNodesRef = useRef(onCloudNodes);
  const remoteFingerprints = useRef(new Map<string, string>());
  const remoteNodes = useRef(new Map<string, Node>());
  const stopSnapshot = useRef<null | (() => void)>(null);
  const syncReady = useRef(false);
  const writeQueue = useRef(Promise.resolve());

  useEffect(() => { latestNodes.current = localNodes; }, [localNodes]);
  useEffect(() => { onCloudNodesRef.current = onCloudNodes; }, [onCloudNodes]);

  const pushNodes = (uid: string, nodes: Node[]) => {
    writeQueue.current = writeQueue.current.then(async () => {
      const { db } = getFirebaseClient();
      const synchronized = withRemoteTombstones(nodes, [...remoteNodes.current.values()]);
      const next = new Map(synchronized.map((node) => [node.id, nodeSyncFingerprint(node)]));
      const changed = synchronized.filter((node) => remoteFingerprints.current.get(node.id) !== next.get(node.id));
      if (changed.length) {
        const batch = writeBatch(db);
        for (const node of changed) batch.set(doc(db, 'users', uid, 'nodes', node.id), nodeToFirestore(node));
        await batch.commit();
      }
      remoteNodes.current = new Map(synchronized.map((node) => [node.id, node]));
      remoteFingerprints.current = next;
    }).catch((reason) => { setStatus('offline'); setError(authMessage(reason)); });
    return writeQueue.current;
  };

  useEffect(() => {
    if (!configured || !localReady) return;
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (nextUser) => {
      stopSnapshot.current?.(); stopSnapshot.current = null; syncReady.current = false; setUser(nextUser); setAuthReady(true); setError(null);
      if (!nextUser) { remoteFingerprints.current.clear(); remoteNodes.current.clear(); setStatus('signed-out'); return; }
      setStatus('connecting');
      try {
        const { db } = getFirebaseClient(); const nodesRef = collection(db, 'users', nextUser.uid, 'nodes');
        const initial = await getDocs(nodesRef);
        const remote = initial.docs.map((item) => nodeFromFirestore(item.id, item.data()));
        remoteNodes.current = new Map(remote.map((node) => [node.id, node]));
        remoteFingerprints.current = new Map(remote.map((node) => [node.id, nodeSyncFingerprint(node)]));
        const merged = mergeNodesByUpdatedAt(latestNodes.current, remote);
        onCloudNodesRef.current(merged);
        await pushNodes(nextUser.uid, merged);
        syncReady.current = true; setStatus('synced');
        stopSnapshot.current = onSnapshot(nodesRef, { includeMetadataChanges: true }, (snapshot) => {
          const cloud = snapshot.docs.map((item) => nodeFromFirestore(item.id, item.data()));
          const previousRemoteIds = new Set(remoteFingerprints.current.keys());
          remoteNodes.current = new Map(cloud.map((node) => [node.id, node]));
          remoteFingerprints.current = new Map(cloud.map((node) => [node.id, nodeSyncFingerprint(node)]));
          const remotelyDeletedIds = new Set([...previousRemoteIds].filter((id) => !remoteFingerprints.current.has(id)));
          const localWithRemoteTombstones = applyRemoteDeletionsAsTombstones(latestNodes.current, remotelyDeletedIds);
          const mergedNodes = mergeNodesByUpdatedAt(localWithRemoteTombstones, cloud);
          const currentPrint = latestNodes.current.map(nodeSyncFingerprint).sort().join('|');
          const mergedPrint = mergedNodes.map(nodeSyncFingerprint).sort().join('|');
          if (currentPrint !== mergedPrint) onCloudNodesRef.current(mergedNodes);
          setStatus(snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites ? 'offline' : 'synced'); setError(null);
        }, (reason) => { setStatus('error'); setError(authMessage(reason)); });
      } catch (reason) { setStatus('error'); setError(authMessage(reason)); }
    });
  }, [configured, localReady]);

  useEffect(() => {
    if (!localReady || !user || !syncReady.current) return;
    const timer = setTimeout(() => { pushNodes(user.uid, latestNodes.current); }, 450);
    return () => clearTimeout(timer);
  }, [localNodes, localReady, user]);

  useEffect(() => () => stopSnapshot.current?.(), []);

  const signIn = async (email: string, password: string) => { setError(null); setStatus('connecting'); try { await signInWithEmailAndPassword(getFirebaseClient().auth, email.trim(), password); } catch (reason) { const message = authMessage(reason); setStatus('signed-out'); setError(message); throw new Error(message); } };
  const signUp = async (email: string, password: string) => { setError(null); setStatus('connecting'); try { await createUserWithEmailAndPassword(getFirebaseClient().auth, email.trim(), password); } catch (reason) { const message = authMessage(reason); setStatus('signed-out'); setError(message); throw new Error(message); } };
  const logOut = async () => { await signOut(getFirebaseClient().auth); };

  return { configured, environment: firebase.environment, configurationError: firebase.error, authReady, user, status, error, signIn, signUp, signOut: logOut };
}
