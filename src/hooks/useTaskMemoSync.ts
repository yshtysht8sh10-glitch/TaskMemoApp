import { useEffect, useRef, useState } from "react";
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";

import type { Node } from "../models/node";
import { createNodeHistory, reconcileSyncedNodeHistory, type NodeHistory } from "../domain/nodeHistory";
import { getFirebaseClient } from "../services/firebaseClient";
import { firebaseConfiguration } from "../services/firebaseConfig";
import { TaskMemoV2ApplicationJournal } from "../sync/applicationStorage";
import { createFirebaseSyncAdapter } from "../sync/firebaseSyncAdapter";
import { TaskMemoV2ApplicationStore } from "../sync/taskMemoApplicationStore";
import { TaskMemoV2SyncController } from "../sync/taskMemoV2SyncController";
import type { SyncPhase } from "../sync/types";
import { inferSyncOperationType } from "../sync/operationType";
import { isV2SyncEnabled } from "../sync/featureFlag";
import { useFirebaseSync, type FirebaseSyncStatus } from "./useFirebaseSync";

export type TaskMemoSyncStatus = FirebaseSyncStatus | SyncPhase;

const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

function useFirebaseV2Sync(history: NodeHistory, ready: boolean, onHistory: (history: NodeHistory) => void, enabled: boolean) {
  const firebase = firebaseConfiguration();
  const configured = enabled && firebase.config !== null;
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<TaskMemoSyncStatus>(configured ? "connecting" : "disabled");
  const [error, setError] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [networkPaused, setNetworkPaused] = useState(false);
  const onHistoryRef = useRef(onHistory);
  useEffect(() => { onHistoryRef.current = onHistory; }, [onHistory]);
  const storeRef = useRef<TaskMemoV2ApplicationStore | null>(null);
  const controllerRef = useRef<TaskMemoV2SyncController | null>(null);

  const publish = () => {
    const store = storeRef.current; const controller = controllerRef.current;
    if (store) onHistoryRef.current(store.history);
    if (controller) setStatus(controller.state.phase);
  };

  useEffect(() => {
    if (!configured || !ready) return;
    const { auth, db } = getFirebaseClient();
    let generation = 0;
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      const currentGeneration = ++generation;
      controllerRef.current?.stop(); controllerRef.current = null; storeRef.current = null;
      onHistoryRef.current(createNodeHistory([]));
      setUser(nextUser); setAuthReady(true); setError(null);
      if (!nextUser) { setStatus("signed-out"); return; }
      setStatus("connecting");
      try {
        // Never implicitly import V1 or the previous account's UI state.
        const store = await TaskMemoV2ApplicationStore.open(new TaskMemoV2ApplicationJournal(`${db.app.options.projectId}/${nextUser.uid}`), [], { deviceId: `taskmemo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` });
        if (currentGeneration !== generation) return;
        const emulator = db.app.options.projectId === "demo-taskmemo-v2";
        const controller = new TaskMemoV2SyncController(store, createFirebaseSyncAdapter(db, nextUser.uid, emulator ? "test" : "development", { emulator }), publish);
        storeRef.current = store; controllerRef.current = controller; publish(); await controller.start(); publish();
      } catch (reason) { if (currentGeneration === generation) { setStatus("error"); setError(message(reason)); } }
    });
    const reconnect = () => { void controllerRef.current?.start(); };
    if (typeof window !== "undefined") window.addEventListener("online", reconnect);
    return () => {
      generation++; unsubscribe(); controllerRef.current?.stop(); controllerRef.current = null; storeRef.current = null;
      if (typeof window !== "undefined") window.removeEventListener("online", reconnect);
    };
  }, [configured, ready]);
  useEffect(() => () => controllerRef.current?.stop(), []);

  const run = (action: (controller: TaskMemoV2SyncController) => Promise<unknown>) => {
    const controller = controllerRef.current;
    if (!controller) {
      if (enabled) setError("V2同期へのログイン・初期化が完了するまで編集できません。");
      return enabled; // V2 must not fall back to mutating V1 state.
    }
    void action(controller).then(publish).catch((reason) => { setStatus("error"); setError(message(reason)); });
    return true;
  };
  const signIn = async (email: string, password: string) => { setStatus("connecting"); setError(null); try { await signInWithEmailAndPassword(getFirebaseClient().auth, email.trim(), password); } catch (reason) { setStatus("signed-out"); setError(message(reason)); throw reason; } };
  const signUp = async (email: string, password: string) => { setStatus("connecting"); setError(null); try { await createUserWithEmailAndPassword(getFirebaseClient().auth, email.trim(), password); } catch (reason) { setStatus("signed-out"); setError(message(reason)); throw reason; } };
  return {
    devNetwork: enabled && process.env.EXPO_PUBLIC_FIREBASE_EMULATOR === "true" ? {
      paused: networkPaused,
      toggle: async () => {
        const { db } = getFirebaseClient();
        if (db.app.options.projectId !== "demo-taskmemo-v2") throw new Error("Emulator only");
        if (networkPaused) { setNetworkPaused(false); await controllerRef.current?.resume(); }
        else { controllerRef.current?.pause(); setNetworkPaused(true); }
        publish();
      },
    } : undefined,
    configured, environment: firebase.environment, configurationError: firebase.error, authReady, user, status, error, signIn, signUp,
    signOut: () => signOut(getFirebaseClient().auth),
    command: (label: string, operation: (nodes: Node[]) => Node[], recordHistory = true) => run((controller) => controller.command(label, inferSyncOperationType(label), operation, { recordHistory })),
    undo: () => run((controller) => controller.undo()), redo: () => run((controller) => controller.redo()),
  };
}

export function useTaskMemoSync(history: NodeHistory, ready: boolean, onHistory: (history: NodeHistory) => void) {
  const environment = firebaseConfiguration().environment;
  const useV2 = isV2SyncEnabled(environment, process.env.EXPO_PUBLIC_SYNC_V2_ENABLED);
  const v1 = useFirebaseSync(history.nodes, ready, (nodes) => onHistory(reconcileSyncedNodeHistory(history, nodes)), !useV2);
  const v2 = useFirebaseV2Sync(history, ready, onHistory, useV2);
  return useV2 ? { ...v2, protocol: 2 as const } : { ...v1, devNetwork: undefined, protocol: 1 as const, command: () => false, undo: () => false, redo: () => false };
}
