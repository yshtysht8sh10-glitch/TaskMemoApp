import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";

import type { Node } from "../models/node";
import { createNodeHistory, reconcileSyncedNodeHistory, type NodeHistory } from "../domain/nodeHistory";
import { getFirebaseClient } from "../services/firebaseClient";
import { firebaseConfiguration } from "../services/firebaseConfig";
import { TaskMemoV2ApplicationJournal } from "../sync/applicationStorage";
import { IndexedDbTaskMemoApplicationJournal } from "../sync/indexedDbApplicationStorage";
import { createFirebaseSyncAdapter } from "../sync/firebaseSyncAdapter";
import { TaskMemoV2ApplicationStore, type LegacyPinnedNoteCandidate } from "../sync/taskMemoApplicationStore";
import { observePendingJournalReceipts, recoverV2ApplicationAfterAudit } from "../sync/recovery";
import { beginRecoveryObservation, recordReceiptLookup, recordReceiptRead, recordRecoveryObservation, recoveryErrorCode } from "../sync/recoveryObservation";
import { runRecoveryPreflight } from "../sync/recoveryPreflight";
import { TaskMemoV2SyncController } from "../sync/taskMemoV2SyncController";
import type { SyncPhase } from "../sync/types";
import { inferSyncOperationType } from "../sync/operationType";
import { isConfiguredV2SyncEnabled } from "../sync/featureFlag";
import { useFirebaseSync, type FirebaseSyncStatus } from "./useFirebaseSync";
import { subscribeToWebOnline } from "./webOnlineListener";
import { normalizeLegacyRanks } from "../services/nodeStorage";
import type { PinnedNote } from "../services/pinnedNoteStorage";
import { appAlert } from "../utils/appAlert";

export type TaskMemoSyncStatus = FirebaseSyncStatus | SyncPhase | "diagnostic";

const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

function useFirebaseV2Sync(history: NodeHistory, ready: boolean, onHistory: (history: NodeHistory) => void, enabled: boolean, initialPinnedNote: PinnedNote, onPinnedNote: (body: string) => void, initialIdeasEnabled: boolean, onIdeasEnabled: (value: boolean) => void) {
  const firebase = firebaseConfiguration();
  const observationOnly = Platform.OS === "web" && firebase.environment === "production" && process.env.EXPO_PUBLIC_RECOVERY_OBSERVATION_ONLY === "true";
  const receiptModeParameter = observationOnly && typeof window !== "undefined" ? new URL(window.location.href).searchParams.get("receiptMode") : null;
  const receiptReadMode = receiptModeParameter === "serial" || receiptModeParameter === "serial-interval-100" ? "serial"
    : receiptModeParameter === "parallel" ? "parallel" : "chunked";
  const receiptLookupIntervalMs = receiptModeParameter === "serial-interval-100" ? 100 : 0;
  const configured = enabled && firebase.config !== null;
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<TaskMemoSyncStatus>(configured ? "connecting" : "disabled");
  const [error, setError] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [networkPaused, setNetworkPaused] = useState(false);
  const [legacyPinnedNoteCandidates, setLegacyPinnedNoteCandidates] = useState<LegacyPinnedNoteCandidate[]>([]);
  const onHistoryRef = useRef(onHistory);
  useEffect(() => { onHistoryRef.current = onHistory; }, [onHistory]);
  const onPinnedNoteRef = useRef(onPinnedNote);
  useEffect(() => { onPinnedNoteRef.current = onPinnedNote; }, [onPinnedNote]);
  const initialPinnedNoteRef = useRef(initialPinnedNote);
  const initialIdeasEnabledRef = useRef(initialIdeasEnabled);
  const onIdeasEnabledRef = useRef(onIdeasEnabled);
  useEffect(() => { onIdeasEnabledRef.current = onIdeasEnabled; }, [onIdeasEnabled]);
  const publishedPinnedNoteRef = useRef(initialPinnedNote.body);
  const publishedIdeasEnabledRef = useRef(initialIdeasEnabled);
  const publishedCandidatesRef = useRef("[]");
  const storeRef = useRef<TaskMemoV2ApplicationStore | null>(null);
  const controllerRef = useRef<TaskMemoV2SyncController | null>(null);
  const localSaveErrorShownRef = useRef(false);
  const initialPinnedBody = initialPinnedNote.body;
  const initialPinnedUpdatedAt = initialPinnedNote.updatedAt.getTime();
  useEffect(() => {
    if (!storeRef.current) {
      initialPinnedNoteRef.current = { body: initialPinnedBody, updatedAt: new Date(initialPinnedUpdatedAt) };
      publishedPinnedNoteRef.current = initialPinnedBody;
    }
  }, [initialPinnedBody, initialPinnedUpdatedAt]);
  useEffect(() => {
    if (!storeRef.current) {
      initialIdeasEnabledRef.current = initialIdeasEnabled;
      publishedIdeasEnabledRef.current = initialIdeasEnabled;
    }
  }, [initialIdeasEnabled]);

  const publish = () => {
    const store = storeRef.current; const controller = controllerRef.current;
    if (store) onHistoryRef.current(store.history);
    if (store && store.pinnedNote.body !== publishedPinnedNoteRef.current) {
      publishedPinnedNoteRef.current = store.pinnedNote.body;
      onPinnedNoteRef.current(store.pinnedNote.body);
    }
    if (store && store.ideasEnabled !== publishedIdeasEnabledRef.current) {
      publishedIdeasEnabledRef.current = store.ideasEnabled;
      onIdeasEnabledRef.current(store.ideasEnabled);
    }
    if (store) {
      const candidates = store.legacyPinnedNoteCandidates;
      const fingerprint = JSON.stringify(candidates);
      if (fingerprint !== publishedCandidatesRef.current) {
        publishedCandidatesRef.current = fingerprint;
        setLegacyPinnedNoteCandidates(candidates);
      }
    }
    if (controller) { setStatus(controller.state.phase); setError(controller.state.lastError); }
  };

  useEffect(() => {
    if (!configured || !ready) return;
    const { auth, db } = getFirebaseClient();
    let generation = 0;
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      const currentGeneration = ++generation;
      controllerRef.current?.stop(); controllerRef.current = null; storeRef.current = null;
      publishedCandidatesRef.current = "[]"; setLegacyPinnedNoteCandidates([]);
      onHistoryRef.current(createNodeHistory([]));
      setUser(nextUser); setAuthReady(true); setError(null);
      if (!nextUser) { setStatus("signed-out"); return; }
      setStatus("connecting");
      if (observationOnly) {
        beginRecoveryObservation();
        recordRecoveryObservation({ receiptReadMode, receiptLookupTimeoutMs: 10000, receiptLookupIntervalMs,
          receiptChunkSize: receiptReadMode === "chunked" ? 20 : 0, receiptMaxAttempts: receiptReadMode === "chunked" ? 3 : 1 });
      }
      try {
        // Never implicitly import V1 or the previous account's UI state.
        const emulator = db.app.options.projectId === "demo-taskmemo-v2";
        const adapterEnvironment = emulator ? "test" : firebase.environment === "production" ? "production" : "development";
        const adapter = createFirebaseSyncAdapter(db, nextUser.uid, adapterEnvironment, { emulator,
          receiptLookupTimeoutMs: observationOnly ? 10000 : undefined,
          receiptReadMode: observationOnly ? receiptReadMode : undefined,
          receiptLookupIntervalMs: observationOnly ? receiptLookupIntervalMs : undefined,
          onReceiptLookup: observationOnly ? recordReceiptLookup : undefined,
          onReceiptRead: observationOnly ? recordReceiptRead : undefined,
          onReceiptBatch: observationOnly ? (event) => recordRecoveryObservation({
            recoveryPhase: event.phase === "start" ? "receipt-batch-start" : "receipt-batch-complete",
            receiptComparisonTotal: event.total,
            receiptComparisonCompleted: event.completed,
            currentBatch: event.batch,
            lastCompletedOperationIndex: event.lastCompletedOperationIndex,
          }) : undefined,
        });
        const scope = `${db.app.options.projectId}/${nextUser.uid}`;
        const legacyJournal = observationOnly ? await new TaskMemoV2ApplicationJournal(scope).loadJournal() : null;
        if (observationOnly) recordRecoveryObservation({ recoveryPhase: "indexeddb-open-start" });
        const persistence = Platform.OS === "web"
          ? await IndexedDbTaskMemoApplicationJournal.open(scope, undefined, { allowLegacyCopy: !legacyJournal })
          : new TaskMemoV2ApplicationJournal(scope);
        if (observationOnly) recordRecoveryObservation({ recoveryPhase: "indexeddb-open-complete" });
        if (currentGeneration !== generation) return;
        if (observationOnly && await persistence.loadJournal()) {
          const observation = await observePendingJournalReceipts(persistence, adapter, recordRecoveryObservation);
          if (currentGeneration !== generation) return;
          recordRecoveryObservation({ recoveryPhase: "preflight-start" });
          if (!observation.auditResult) throw { code: "preflight-audit-missing" };
          const preflight = await runRecoveryPreflight(persistence, adapter, scope, observation.auditResult);
          if (currentGeneration !== generation) return;
          recordRecoveryObservation({ recoveryPhase: "preflight-complete", preflight });
          recordRecoveryObservation({ recoveryPhase: "observation-paused" });
          setStatus("diagnostic");
          setError("復旧診断のため安全停止中です。journalの確定・再送は行っていません。");
          return;
        }
        if (observationOnly && legacyJournal) throw new Error("旧journalとIndexedDBの状態が一致しません。診断を停止しました。");
        const store = await recoverV2ApplicationAfterAudit(persistence, adapter, { deviceId: `taskmemo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, initialPinnedNote: initialPinnedNoteRef.current, initialIdeasEnabled: initialIdeasEnabledRef.current });
        if (currentGeneration !== generation) return;
        const controller = new TaskMemoV2SyncController(store, adapter, publish);
        storeRef.current = store; controllerRef.current = controller; publish(); await controller.start(); publish();
      } catch (reason) {
        if (currentGeneration === generation) {
          if (observationOnly) recordRecoveryObservation({ recoveryPhase: "error", lastRecoveryError: recoveryErrorCode(reason) });
          setStatus("error"); setError(message(reason));
          appAlert("V2データの復旧を停止しました", `データを削除せず、バックアップを保持してください。\n${message(reason)}`);
        }
      }
    });
    const reconnect = () => { void controllerRef.current?.start(); };
    const removeOnlineListener = subscribeToWebOnline(
      Platform.OS,
      typeof window === "undefined" ? undefined : window,
      reconnect,
    );
    return () => {
      generation++; unsubscribe(); controllerRef.current?.stop(); controllerRef.current = null; storeRef.current = null;
      removeOnlineListener();
    };
  }, [configured, ready, firebase.environment, observationOnly, receiptReadMode, receiptLookupIntervalMs]);
  useEffect(() => () => controllerRef.current?.stop(), []);

  const run = (action: (controller: TaskMemoV2SyncController) => Promise<unknown>) => {
    const controller = controllerRef.current;
    if (!controller) {
      if (enabled) setError("V2同期へのログイン・初期化が完了するまで編集できません。");
      return enabled; // V2 must not fall back to mutating V1 state.
    }
    void action(controller).then(publish).catch((reason) => {
      setStatus("error"); setError(message(reason));
      if (!localSaveErrorShownRef.current) {
        localSaveErrorShownRef.current = true;
        appAlert("保存エラー", `変更を端末に保存できませんでした。画面を閉じず、サイトデータを削除しないでください。\n${message(reason)}`);
      }
    });
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
    configured, environment: firebase.environment, configurationError: firebase.error, authReady, user, status, error, signIn, signUp, legacyPinnedNoteCandidates,
    signOut: () => signOut(getFirebaseClient().auth),
    command: (label: string, operation: (nodes: Node[]) => Node[], recordHistory = true) => run((controller) => controller.command(label, inferSyncOperationType(label), operation, { recordHistory })),
    updatePinnedNote: (body: string) => run((controller) => controller.updatePinnedNote(body)),
    updateIdeasEnabled: (value: boolean, type: "update" | "import" = "update") => run((controller) => controller.updateIdeasEnabled(value, type)),
    adoptLegacyPinnedNoteCandidate: (candidate: LegacyPinnedNoteCandidate) => run((controller) => controller.adoptLegacyPinnedNoteCandidate(candidate)),
    discardLegacyPinnedNoteCandidate: (candidate: LegacyPinnedNoteCandidate) => run((controller) => controller.discardLegacyPinnedNoteCandidate(candidate)),
    importLegacyPinnedNoteCandidates: (candidates: LegacyPinnedNoteCandidate[]) => run((controller) => controller.importLegacyPinnedNoteCandidates(candidates)),
    undo: () => run((controller) => controller.undo()), redo: () => run((controller) => controller.redo()),
  };
}

export function useTaskMemoSync(history: NodeHistory, ready: boolean, onHistory: (history: NodeHistory) => void, initialPinnedNote: PinnedNote = { body: "", updatedAt: new Date(0) }, onPinnedNote: (body: string) => void = () => undefined, initialIdeasEnabled = false, onIdeasEnabled: (value: boolean) => void = () => undefined) {
  const firebase = firebaseConfiguration();
  const environment = firebase.environment;
  const useV2 = isConfiguredV2SyncEnabled(environment, process.env.EXPO_PUBLIC_SYNC_V2_ENABLED, firebase.config !== null);
  const v1 = useFirebaseSync(history.nodes, ready, (nodes) => {
    const next = reconcileSyncedNodeHistory(history, nodes);
    onHistory({ ...next, nodes: normalizeLegacyRanks(next.nodes) });
  }, !useV2);
  const v2 = useFirebaseV2Sync(history, ready, onHistory, useV2, initialPinnedNote, onPinnedNote, initialIdeasEnabled, onIdeasEnabled);
  return useV2 ? { ...v2, protocol: 2 as const } : { ...v1, devNetwork: undefined, protocol: 1 as const, legacyPinnedNoteCandidates: [] as LegacyPinnedNoteCandidate[], command: () => false, updatePinnedNote: () => false, updateIdeasEnabled: () => false, adoptLegacyPinnedNoteCandidate: () => false, discardLegacyPinnedNoteCandidate: () => false, importLegacyPinnedNoteCandidates: () => false, undo: () => false, redo: () => false };
}
