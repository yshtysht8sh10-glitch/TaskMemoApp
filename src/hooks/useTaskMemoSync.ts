import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";

import type { Node } from "../models/node";
import { createNodeHistory, reconcileSyncedNodeHistory, type NodeHistory } from "../domain/nodeHistory";
import { getFirebaseClient } from "../services/firebaseClient";
import { firebaseConfiguration } from "../services/firebaseConfig";
import { TaskMemoV2ApplicationJournal } from "../sync/applicationStorage";
import { IndexedDbTaskMemoApplicationJournal } from "../sync/indexedDbApplicationStorage";
import { shouldEnterLocalRecovery } from "../sync/localRecoveryRouting";
import { createFirebaseSyncAdapter } from "../sync/firebaseSyncAdapter";
import { TaskMemoV2ApplicationStore, type LegacyPinnedNoteCandidate } from "../sync/taskMemoApplicationStore";
import { recoverV2ApplicationAfterAudit } from "../sync/recovery";
import { beginRecoveryObservation, recordReceiptLookup, recordReceiptRead, recordRecoveryObservation,
  recordRecoveryTransaction, recoveryErrorCode } from "../sync/recoveryObservation";
import { preflightJournalAuthoritativeRecovery,
  JOURNAL_AUTHORITATIVE_APPROVAL_KEY } from "../sync/executeJournalAuthoritativeRecovery";
import { TaskMemoV2SyncController } from "../sync/taskMemoV2SyncController";
import { runSyncSelfRepair, type SyncSelfRepairProgress } from "../sync/syncSelfRepair";
import { beginSelfRepairDiagnostics, finishSelfRepairDiagnostics, recordNormalOperationGenerationBlockedByRepair, recordSyncActivity } from "../sync/selfRepairDiagnostics";
import type { SyncAdapter, SyncPhase } from "../sync/types";
import { inferSyncOperationType } from "../sync/operationType";
import { isConfiguredV2SyncEnabled } from "../sync/featureFlag";
import { useFirebaseSync, type FirebaseSyncStatus } from "./useFirebaseSync";
import { subscribeToWebOnline } from "./webOnlineListener";
import { normalizeLegacyRanks } from "../services/nodeStorage";
import type { PinnedNote } from "../services/pinnedNoteStorage";
import { appAlert } from "../utils/appAlert";

export type TaskMemoSyncStatus = FirebaseSyncStatus | SyncPhase | "diagnostic" | "local-recovery" | "self-repairing";

const message = (reason: unknown) => reason instanceof Error ? reason.message :
  reason && typeof reason === "object" && "message" in reason && typeof reason.message === "string"
    ? reason.message : reason && typeof reason === "object" ? "V2同期・復旧でエラーが発生しました。診断情報を確認してください。" : String(reason);

function useFirebaseV2Sync(history: NodeHistory, ready: boolean, onHistory: (history: NodeHistory) => void, enabled: boolean, initialPinnedNote: PinnedNote, onPinnedNote: (body: string) => void, initialIdeasEnabled: boolean, onIdeasEnabled: (value: boolean) => void) {
  const firebase = firebaseConfiguration();
  const guardedRecovery = Platform.OS === "web" && firebase.environment === "production" && process.env.EXPO_PUBLIC_GUARDED_RECOVERY_ENABLED === "true";
  const manualAuthoritativePreflight = guardedRecovery && typeof window !== "undefined" &&
    new URL(window.location.href).searchParams.get("journalAuthoritativePreflight") === "1";
  const manualAuthoritativeExecution = guardedRecovery && typeof window !== "undefined" &&
    new URL(window.location.href).searchParams.get("journalAuthoritativeExecute") === "1";
  const manualLocalRecovery = guardedRecovery && typeof window !== "undefined" &&
    new URL(window.location.href).searchParams.get("localRecovery") === "1";
  const manualBuildMatches = guardedRecovery && typeof window !== "undefined" && typeof window.location?.href === "string" &&
    new URL(window.location.href).searchParams.get("build") === process.env.EXPO_PUBLIC_BUILD_SHA;
  const receiptModeParameter = guardedRecovery && typeof window !== "undefined" ? new URL(window.location.href).searchParams.get("receiptMode") : null;
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
  const [selfRepairProgress, setSelfRepairProgress] = useState<SyncSelfRepairProgress | null>(null);
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
  const persistenceRef = useRef<IndexedDbTaskMemoApplicationJournal | null>(null);
  const adapterRef = useRef<SyncAdapter | null>(null);
  const repairRunningRef = useRef(false);
  const repairGenerationRef = useRef(0);
  const localRecoveryModeRef = useRef(false);
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
    if (controller) { setStatus(repairRunningRef.current ? "self-repairing" : localRecoveryModeRef.current ? "local-recovery" : controller.state.phase); setError(controller.state.lastError); }
  };

  useEffect(() => {
    if (!configured || !ready) return;
    const { auth, db } = getFirebaseClient();
    const repairGeneration = repairGenerationRef;
    let generation = 0;
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      recordSyncActivity("authChanged");
      const currentGeneration = ++generation;
      repairGeneration.current++;
      controllerRef.current?.stop(); controllerRef.current = null; storeRef.current = null;
      persistenceRef.current = null; adapterRef.current = null;
      localRecoveryModeRef.current = false;
      publishedCandidatesRef.current = "[]"; setLegacyPinnedNoteCandidates([]);
      onHistoryRef.current(createNodeHistory([]));
      setUser(nextUser); setAuthReady(true); setError(null);
      if (!nextUser) { setStatus("signed-out"); return; }
      setStatus("connecting");
      if (guardedRecovery) {
        beginRecoveryObservation();
        recordRecoveryObservation({ receiptReadMode, receiptLookupTimeoutMs: 10000, receiptLookupIntervalMs,
          receiptChunkSize: receiptReadMode === "chunked" ? 20 : 0, receiptMaxAttempts: receiptReadMode === "chunked" ? 3 : 1 });
      }
      try {
        // Never implicitly import V1 or the previous account's UI state.
        const emulator = db.app.options.projectId === "demo-taskmemo-v2";
        const adapterEnvironment = emulator ? "test" : firebase.environment === "production" ? "production" : "development";
        const adapter = createFirebaseSyncAdapter(db, nextUser.uid, adapterEnvironment, { emulator,
          receiptLookupTimeoutMs: guardedRecovery ? 10000 : undefined,
          receiptReadMode: guardedRecovery ? receiptReadMode : undefined,
          receiptLookupIntervalMs: guardedRecovery ? receiptLookupIntervalMs : undefined,
          onReceiptLookup: guardedRecovery ? recordReceiptLookup : undefined,
          onReceiptRead: guardedRecovery ? recordReceiptRead : undefined,
          onRecoveryTransaction: guardedRecovery ? recordRecoveryTransaction : undefined,
          onReceiptBatch: guardedRecovery ? (event) => recordRecoveryObservation({
            recoveryPhase: event.phase === "start" ? "receipt-batch-start" : "receipt-batch-complete",
            receiptComparisonTotal: event.total,
            receiptComparisonCompleted: event.completed,
            currentBatch: event.batch,
            lastCompletedOperationIndex: event.lastCompletedOperationIndex,
          }) : undefined,
        });
        const scope = `${db.app.options.projectId}/${nextUser.uid}`;
        const legacyJournal = guardedRecovery ? await new TaskMemoV2ApplicationJournal(scope).loadJournal() : null;
        if (guardedRecovery) recordRecoveryObservation({ recoveryPhase: "indexeddb-open-start" });
        const persistence = Platform.OS === "web"
          ? await IndexedDbTaskMemoApplicationJournal.open(scope, undefined, { allowLegacyCopy: !legacyJournal })
          : new TaskMemoV2ApplicationJournal(scope);
        if (guardedRecovery) recordRecoveryObservation({ recoveryPhase: "indexeddb-open-complete" });
        if (currentGeneration !== generation) return;
        const activeLocalMode = persistence instanceof IndexedDbTaskMemoApplicationJournal &&
          await persistence.isLocalRecoveryMode();
        if (persistence instanceof IndexedDbTaskMemoApplicationJournal &&
            shouldEnterLocalRecovery(activeLocalMode, manualLocalRecovery,
              manualLocalRecovery ? await persistence.isRecoveryCompleted() : false)) {
          if (!activeLocalMode) {
            if (!manualBuildMatches)
              throw new Error("最新のローカル復旧版を確認できません。保存データは変更していません。");
            const committed = await persistence.loadCommitted();
            const journal = await persistence.loadJournal();
            const legacy = new TaskMemoV2ApplicationJournal(scope);
            if (!committed || !journal || committed !== await legacy.loadCommitted() ||
                journal !== await legacy.loadJournal())
              throw new Error("ローカル復旧元のApplication/Journalが一致しません。");
            await persistence.restoreJournalLocally(committed, journal, new Date().toISOString());
          }
          if (currentGeneration !== generation) return;
          localRecoveryModeRef.current = true;
          const store = await TaskMemoV2ApplicationStore.open(persistence, [], {
            deviceId: "local-recovery", preserveSortKeys: true });
          const evidence = await persistence.loadLocalRecoveryEvidence();
          if (!evidence.recoveredAt || evidence.nodeCount === null || evidence.archivedOutboxCount === null ||
              !evidence.journal || !evidence.committed)
            throw new Error("ローカル復旧の退避証拠を確認できません。");
          recordRecoveryObservation({ recoveryPhase: "local-recovery-active",
            localRecovery: { status: "active", recoveredAt: evidence.recoveredAt,
              sourceNodeCount: evidence.nodeCount, archivedOutboxCount: evidence.archivedOutboxCount,
              cloudSyncEnabled: false } });
          const controller = new TaskMemoV2SyncController(store, adapter, publish, { localOnly: true });
          persistenceRef.current = persistence; adapterRef.current = adapter;
          storeRef.current = store; controllerRef.current = controller;
          publish(); await controller.start(); publish();
          return;
        }
        if (guardedRecovery && await persistence.loadJournal()) {
          if ((manualAuthoritativePreflight || manualAuthoritativeExecution) && !manualBuildMatches)
            throw new Error("最新のRecovery版を確認できません。書き込みは開始しません。");
          // A Hosting deploy must never resume the old executable recovery automatically.
          // This release exposes only an explicit, read-only candidate projection.
          if (!manualAuthoritativePreflight && !manualAuthoritativeExecution) {
            recordRecoveryObservation({ recoveryPhase: "observation-paused" });
            setStatus("diagnostic");
            setError("復旧は手動preflight待機中です。journalとOutboxは変更していません。");
            return;
          }
          if (!(persistence instanceof IndexedDbTaskMemoApplicationJournal))
            throw new Error("IndexedDB以外ではpreflightを実行しません。");
          if (manualAuthoritativeExecution) {
            throw new Error("Firebase Recoveryは無効です。ローカル復旧のみ利用してください。");
          }
          recordRecoveryObservation({ recoveryPhase: "preflight-start",
            journalAuthoritativePreflight: { status: "running", journalNodeCount: null, remoteNodeCount: null,
              candidateNodeCount: null, journalOnlyNodeCount: null, remoteOnlyNodeCount: null,
              markedNodeCount: null, commonNodeCount: null, nonSortKeyJournalDifferenceNodeCount: null,
              journalMetadataDifferenceNodeCount: null, duplicateActiveSortKeyGroupCount: null,
              originalOutboxCount: null, originalReceiptReceivedCount: null,
              originalReceiptMissingCount: null, freshOperationReceiptCount: null,
              oldOutboxWillBeResent: false, plannedOperationCount: null,
              metadataRebuildNodeCount: null, blockReasons: [] } });
          try {
            const { plan, summary, approvalFingerprint } = await preflightJournalAuthoritativeRecovery(persistence, adapter, scope);
            if (currentGeneration !== generation) return;
            window.sessionStorage.setItem(JOURNAL_AUTHORITATIVE_APPROVAL_KEY, approvalFingerprint);
            recordRecoveryObservation({ recoveryPhase: "observation-paused",
              journalAuthoritativePreflight: { status: "safe", ...summary,
                originalOutboxCount: plan.originalReceiptReceivedCount + plan.originalReceiptMissingCount,
                originalReceiptReceivedCount: plan.originalReceiptReceivedCount,
                originalReceiptMissingCount: plan.originalReceiptMissingCount,
                freshOperationReceiptCount: 0, oldOutboxWillBeResent: false, blockReasons: [] } });
            setStatus("diagnostic");
            setError("読み取り専用preflightが完了しました。Recovery実行は無効です。");
          } catch (reason) {
            if (currentGeneration !== generation) return;
            recordRecoveryObservation({ recoveryPhase: "observation-paused",
              journalAuthoritativePreflight: { status: "blocked", journalNodeCount: null,
                remoteNodeCount: null, candidateNodeCount: null, journalOnlyNodeCount: null,
                remoteOnlyNodeCount: null, markedNodeCount: null, commonNodeCount: null,
                nonSortKeyJournalDifferenceNodeCount: null, journalMetadataDifferenceNodeCount: null,
                duplicateActiveSortKeyGroupCount: null, originalOutboxCount: null,
                originalReceiptReceivedCount: null, originalReceiptMissingCount: null,
                freshOperationReceiptCount: null, oldOutboxWillBeResent: false,
                plannedOperationCount: null, metadataRebuildNodeCount: null, blockReasons: [(() => {
                  const code = reason && typeof reason === "object" && "code" in reason ? reason.code : null;
                  return typeof code === "string" && ["local-copy-mismatch", "remote-snapshot-unstable",
                    "receipt-audit-incomplete", "receipt-identity-unavailable", "profile-mismatch",
                    "outbox-target-invalid", "candidate-validation-failed", "source-unavailable",
                    "fresh-operation-receipt-exists", "deleted-node-conflict",
                    "unknown-field-conflict", "candidate-parent-invalid",
                    "candidate-sortkey-invalid", "candidate-user-data-mismatch"].includes(code)
                    ? code : "firebase-read-failed";
                })()] } });
            setStatus("diagnostic");
            setError("読み取り専用preflightがblockedです。診断JSONを確認してください。");
          }
          return;
        }
        if (guardedRecovery && legacyJournal && !(persistence instanceof IndexedDbTaskMemoApplicationJournal &&
            await persistence.isRecoveryCompleted()))
          throw new Error("旧journalとIndexedDBの状態が一致しません。復旧を停止しました。");
        const store = await recoverV2ApplicationAfterAudit(persistence, adapter, { deviceId: `taskmemo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, initialPinnedNote: initialPinnedNoteRef.current, initialIdeasEnabled: initialIdeasEnabledRef.current }, firebase.environment === "production");
        if (currentGeneration !== generation) return;
        const controller = new TaskMemoV2SyncController(store, adapter, publish);
        storeRef.current = store; controllerRef.current = controller; publish(); await controller.start(); publish();
      } catch (reason) {
        if (currentGeneration === generation) {
          if (guardedRecovery) recordRecoveryObservation({ recoveryPhase: "error", lastRecoveryError: recoveryErrorCode(reason) });
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
      repairGeneration.current++; persistenceRef.current = null; adapterRef.current = null;
      removeOnlineListener();
    };
  }, [configured, ready, firebase.environment, guardedRecovery, manualAuthoritativePreflight, manualLocalRecovery,
    manualAuthoritativeExecution, manualBuildMatches, receiptReadMode, receiptLookupIntervalMs]);
  useEffect(() => () => controllerRef.current?.stop(), []);

  const run = (action: (controller: TaskMemoV2SyncController) => Promise<unknown>) => {
    if (repairRunningRef.current) { recordSyncActivity("blockedCommand"); recordNormalOperationGenerationBlockedByRepair(); return true; }
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
  const repairSync = async (diagnosticOnly = false) => {
    const persistence = persistenceRef.current, adapter = adapterRef.current, store = storeRef.current;
    if (repairRunningRef.current || !localRecoveryModeRef.current || !persistence || !adapter || !store) return;
    repairRunningRef.current = true;
    const generation = repairGenerationRef.current;
    setStatus("self-repairing"); setError(null); setSelfRepairProgress({ phase: "reading", completed: 0, total: 0 });
    controllerRef.current?.stop();
    try {
      beginSelfRepairDiagnostics(store.deviceId, diagnosticOnly);
      await store.whenIdle();
      const result = await runSyncSelfRepair(persistence, adapter, setSelfRepairProgress, () => {
        if (generation !== repairGenerationRef.current) throw new Error("認証状態が変化したため自己修復を停止しました。");
      }, diagnosticOnly);
      if (diagnosticOnly) {
        finishSelfRepairDiagnostics("diagnosed");
        repairRunningRef.current = false; setSelfRepairProgress(null); setStatus("local-recovery");
        appAlert("読み取り専用診断が完了しました", "Node・Receiptへの書き込みは行っていません。診断ページのJSONに比較結果を保存しました。同期は停止したままです。");
        return;
      }
      finishSelfRepairDiagnostics("completed");
      localRecoveryModeRef.current = false;
      const nextStore = await TaskMemoV2ApplicationStore.open(persistence, [], { deviceId: "self-repair-complete" });
      const controller = new TaskMemoV2SyncController(nextStore, adapter, publish);
      storeRef.current = nextStore; controllerRef.current = controller;
      repairRunningRef.current = false; setSelfRepairProgress(null);
      publish(); await controller.start(); publish();
      if (controller.state.phase === "synced" || controller.state.phase === "pending")
        appAlert("同期自己修復が完了しました", `ローカルデータとFirebaseの一致を確認しました。${result.nodeCount}件のNodeと${result.receiptCount}件の新規Receiptを確認しました。`);
      else
        appAlert("同期自己修復が完了しました", "ローカルデータとFirebaseの一致を確認しました。通常同期の再接続を待っています。データは端末に保存されています。");
    } catch (reason) {
      try { finishSelfRepairDiagnostics("failed"); } catch { /* Original failure remains visible. */ }
      repairRunningRef.current = false; setSelfRepairProgress(null);
      const stillLocal = await persistence.isLocalRecoveryMode().catch(() => true);
      localRecoveryModeRef.current = stillLocal;
      setStatus(stillLocal ? "local-recovery" : "error"); setError(message(reason));
      appAlert("同期自己修復を停止しました", `${stillLocal
        ? "元データと旧Outboxは保持しています。診断ページの比較結果を確認してください。"
        : "Firebaseとの収束は確定済みです。端末上の元データは保持されています。"}\n${message(reason)}`);
    }
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
    selfRepairProgress, repairSync,
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
