import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { NodeTree, type DropCandidate } from "@/components/NodeTree";
import {
  currentTreeTraceId,
  nodesRevision,
  summarizeNodes,
  treeDiagnosticLog,
} from "@/components/treeDiagnostics";
import { DeadlineView } from "@/components/DeadlineView";
import { DateTimeField } from "@/components/DateTimeField";
import { DateField } from "@/components/DateField";
import {
  canMoveNode,
  completeMemo,
  createNode,
  duplicateMemo,
  hardDeleteNode,
  moveNode,
  restoreMemo,
  restoreNode,
  softDeleteNode,
  tryMoveNode,
  updateNode,
} from "@/domain/nodeOperations";
import {
  categoryPath,
  deadlineGroupDefinitions,
  deadlineGroupForDueAt,
  moveMemoInDeadlineList,
  updateMemoDeadline,
  TODAY_GRANULARITIES,
  type DeadlineCreateContext,
  type DeadlineGroupKey,
  type TodayGranularity,
} from "@/domain/deadlineView";
import {
  commitNodeHistory,
  createNodeHistory,
  redoNodeHistory,
  reconcileSyncedNodeHistory,
  replaceNodeHistory,
  undoNodeHistory,
} from "@/domain/nodeHistory";
import { mockNodes } from "@/data/mockNodes";
import type {
  DuePreset,
  MemoNode,
  MemoType,
  Node,
  RepeatFrequency,
  RepeatRule,
} from "@/models/node";
import {
  loadNodes,
  normalizeLegacyRanks,
  resetNodes,
  saveNodes,
} from "@/services/nodeStorage";
import {
  exportNodesToFile,
  pickAndParseNodeBackup,
} from "@/services/nodeTransfer";
import {
  DEFAULT_LIST_DISPLAY_PREFERENCES,
  DEFAULT_TREE_DISPLAY_PREFERENCES,
  loadListDisplayPreferences,
  loadTreeDisplayPreferences,
  saveListDisplayPreferences,
  saveTreeDisplayPreferences,
} from "@/services/viewPreferences";
import { loadPinnedNote, savePinnedNote } from "@/services/pinnedNoteStorage";
import {
  dueDateForPreset,
  formatDateTimeInput,
  parseLocalDateTime,
} from "@/utils/dueDates";
import { useAppTheme, type ThemeColors, type ThemeMode } from "@/theme/theme";
import {
  COMPLETION_HISTORY_CRITERIA,
  completionHistoryGroups,
  type CompletionHistoryCriterion,
  type CompletionHistoryItem,
} from "@/domain/completionHistory";
import { appAlert } from "@/utils/appAlert";
import { canStartSheetDismiss, sheetDismissRelease } from "@/utils/sheetDismissGesture";
import { useFirebaseSync } from "@/hooks/useFirebaseSync";
import { useWebFocusedInputVisibility } from "@/hooks/useWebKeyboardVisibility";
import { SyncAccountPanel } from "@/components/SyncAccountPanel";
import { ExternalAiConnectionPanel } from "@/components/ExternalAiConnectionPanel";
import {
  clearRoutineCompletion,
  isValidRepeatRule,
  localDateKey,
  repeatRuleLabel,
  routineCategoryForParent,
  routineHistoryDays,
  toggleRoutineCompletion,
} from "@/domain/routine";
import {
  DEFAULT_REMINDER_PREFERENCES,
  reminderPlans,
  type ReminderPreferences,
} from "@/domain/reminders";
import {
  loadReminderPreferences,
  saveReminderPreferences,
} from "@/services/reminderPreferences";
import {
  addReminderResponseListener,
  replaceScheduledReminders,
  requestReminderPermission,
} from "@/services/reminderNotifications";
import {
  canMoveSelectedNodes,
  completeSelectedNodes,
  deleteSelectedNodes,
  moveSelectedNodes,
  normalizeSelectedNodeIds,
} from "@/domain/nodeSelection";
import { convertMemoType, isIdea } from "@/domain/memoType";
import {
  DEFAULT_FEATURE_PREFERENCES,
  loadFeaturePreferences,
  saveFeaturePreferences,
} from "@/services/featurePreferences";

type MainView = "tree" | "deadline" | "completed" | "trash";
type Editor = {
  type: "memo" | "category";
  node?: Node;
  parentId: string | null;
  memoType?: MemoType;
  dueContext?: DeadlineCreateContext;
} | null;
const presets: { key: DuePreset; label: string }[] = [
  { key: "none", label: "期限なし" },
  { key: "today", label: "今日中" },
  { key: "tomorrow", label: "明日中" },
  { key: "morning", label: "午前中" },
  { key: "afternoon", label: "午後まで" },
  { key: "thisWeek", label: "今週中" },
  { key: "thisMonth", label: "今月中" },
  { key: "thisYear", label: "今年中" },
  { key: "custom", label: "日時指定" },
];
const initialExternalAiAuthorization = () =>
  Platform.OS === "web" && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("externalAiAuthorization")
    : null;

export default function HomeScreen() {
  useWebFocusedInputVisibility();
  const { colors, resolved, mode, setMode } = useAppTheme();
  const styles = createStyles(colors);
  const [history, setHistory] = useState(() => createNodeHistory(mockNodes));
  const nodes = history.nodes;
  const [ready, setReady] = useState(false);
  const [pinnedNote, setPinnedNote] = useState("");
  const pinnedSaveQueue = useRef(Promise.resolve());
  const [visibleGroupIds, setVisibleGroupIds] = useState<Set<DeadlineGroupKey>>(
    () => new Set(DEFAULT_LIST_DISPLAY_PREFERENCES.visibleGroupIds),
  );
  const [showPinnedNote, setShowPinnedNote] = useState(true);
  const [todayGranularity, setTodayGranularity] = useState<TodayGranularity>(
    DEFAULT_LIST_DISPLAY_PREFERENCES.todayGranularity,
  );
  const [pinnedNoteHeight, setPinnedNoteHeight] = useState(
    DEFAULT_LIST_DISPLAY_PREFERENCES.pinnedNoteHeight,
  );
  const listDisplaySaveQueue = useRef(Promise.resolve());
  const [showCompletedTreeMemos, setShowCompletedTreeMemos] = useState(
    DEFAULT_TREE_DISPLAY_PREFERENCES.showCompletedMemos,
  );
  const [view, setView] = useState<MainView>("deadline");
  const [deadlineExpanded, setDeadlineExpanded] = useState<
    Set<DeadlineGroupKey>
  >(
    () =>
      new Set(
        deadlineGroupDefinitions(
          DEFAULT_LIST_DISPLAY_PREFERENCES.todayGranularity,
        ).map((group) => group.id),
      ),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [authorizationRequestId, setAuthorizationRequestId] = useState<
    string | null
  >(initialExternalAiAuthorization);
  const [externalAiOpen, setExternalAiOpen] = useState(
    () => !!initialExternalAiAuthorization(),
  );
  const [editor, setEditor] = useState<Editor>(null);
  const [menuNode, setMenuNode] = useState<Node | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [movingNode, setMovingNode] = useState<Node | null>(null);
  const [bulkMove, setBulkMove] = useState<{
    nodeIds: string[];
    onSuccess: () => void;
  } | null>(null);
  const [bulkDeadlineMove, setBulkDeadlineMove] = useState<{
    nodeIds: string[];
    onSuccess: () => void;
  } | null>(null);
  const [exitingMemos, setExitingMemos] = useState<Map<string, MemoNode>>(
    () => new Map(),
  );
  const [completionNotices, setCompletionNotices] = useState<
    { token: string; id: string; title: string }[]
  >([]);
  const [reminders, setReminders] = useState<ReminderPreferences>(
    DEFAULT_REMINDER_PREFERENCES,
  );
  const [remindersReady, setRemindersReady] = useState(false);
  const [ideasEnabled, setIdeasEnabled] = useState(
    DEFAULT_FEATURE_PREFERENCES.ideasEnabled,
  );
  const sync = useFirebaseSync(nodes, ready, (cloudNodes) => {
    setHistory((current) =>
      reconcileSyncedNodeHistory(current, normalizeLegacyRanks(cloudNodes)),
    );
    saveNodes(cloudNodes).catch(() => {});
  });
  useEffect(() => {
    const traceId = currentTreeTraceId();
    treeDiagnosticLog("hydrate/reload-start", {
      traceId,
      source: "initial-mount",
    });
    Promise.all([
      loadNodes(mockNodes),
      loadPinnedNote(),
      loadListDisplayPreferences(),
      loadTreeDisplayPreferences(),
      loadReminderPreferences(),
      loadFeaturePreferences(),
    ])
      .then(
        ([
          loaded,
          note,
          listDisplay,
          treeDisplay,
          reminderPreferences,
          featurePreferences,
        ]) => {
          treeDiagnosticLog("hydrate/reload-result", {
            traceId,
            source: "initial-mount",
            nodesRevision: nodesRevision(loaded),
            nodes: summarizeNodes(loaded),
          });
          setHistory((current) => replaceNodeHistory(current, loaded));
          setPinnedNote(note.body);
          setVisibleGroupIds(new Set(listDisplay.visibleGroupIds));
          setShowPinnedNote(listDisplay.showPinnedNote);
          setTodayGranularity(listDisplay.todayGranularity);
          setPinnedNoteHeight(listDisplay.pinnedNoteHeight);
          setShowCompletedTreeMemos(treeDisplay.showCompletedMemos);
          setDeadlineExpanded(
            new Set(
              deadlineGroupDefinitions(listDisplay.todayGranularity).map(
                (group) => group.id,
              ),
            ),
          );
          setReminders(reminderPreferences);
          setRemindersReady(true);
          setIdeasEnabled(featurePreferences.ideasEnabled);
        },
      )
      .catch((error) => {
        treeDiagnosticLog("hydrate/reload-error", {
          traceId,
          message: error instanceof Error ? error.message : String(error),
        });
        appAlert("読み込みエラー", "保存データを読み込めませんでした。");
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready) return;
    const traceId = currentTreeTraceId();
    const revision = nodesRevision(nodes);
    const startedAt = Date.now();
    treeDiagnosticLog("persist-start", {
      traceId,
      nodesRevision: revision,
      nodes: summarizeNodes(nodes),
    });
    saveNodes(nodes)
      .then(() => loadNodes([]))
      .then((stored) => {
        treeDiagnosticLog("persist-success", {
          traceId,
          nodesRevision: revision,
          storedRevision: nodesRevision(stored),
          matchesCommittedState: nodesRevision(stored) === revision,
          elapsedMs: Date.now() - startedAt,
          storedNodes: summarizeNodes(stored),
        });
      })
      .catch((error) => {
        treeDiagnosticLog("persist-error", {
          traceId,
          nodesRevision: revision,
          elapsedMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
        });
        appAlert("保存エラー", "端末への保存に失敗しました。");
      });
  }, [nodes, ready]);
  useEffect(() => {
    const subscription = addReminderResponseListener(() => setView("deadline"));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!ready || !remindersReady) return;
    replaceScheduledReminders(reminderPlans(nodes, reminders)).catch(() => {});
  }, [nodes, ready, reminders, remindersReady]);
  const parentName = (id: string | null) =>
    id ? (nodes.find((n) => n.id === id)?.title ?? "ルート") : "ルート";
  const displayNodes = useMemo(
    () => nodes.map((node) => exitingMemos.get(node.id) ?? node),
    [exitingMemos, nodes],
  );
  const apply = (label: string, operation: (current: Node[]) => Node[]) => {
    try {
      setHistory((current) => commitNodeHistory(current, label, operation));
    } catch (error) {
      appAlert(
        "操作できません",
        error instanceof Error ? error.message : "不明なエラー",
      );
    }
  };
  const replaceNodes = (operation: (current: Node[]) => Node[]) => {
    try {
      setHistory((current) =>
        replaceNodeHistory(current, operation(current.nodes)),
      );
    } catch (error) {
      appAlert(
        "操作できません",
        error instanceof Error ? error.message : "不明なエラー",
      );
    }
  };
  const applyBatch = (
    label: string,
    operation: (current: Node[]) => Node[],
  ) => {
    try {
      const nextNodes = operation(nodes);
      setHistory((current) =>
        commitNodeHistory(current, label, () => nextNodes),
      );
      return true;
    } catch (error) {
      appAlert(
        "一括操作できません",
        error instanceof Error ? error.message : "不明なエラー",
      );
      return false;
    }
  };
  const changePinnedNote = (body: string) => {
    setPinnedNote(body);
    pinnedSaveQueue.current = pinnedSaveQueue.current
      .then(() => savePinnedNote(body))
      .then(() => undefined)
      .catch(() => undefined);
  };
  const saveListPreferences = (
    groups: Set<DeadlineGroupKey>,
    pinned: boolean,
    granularity: TodayGranularity,
    height: number,
  ) => {
    const value = {
      visibleGroupIds: [...groups],
      showPinnedNote: pinned,
      todayGranularity: granularity,
      pinnedNoteHeight: height,
    };
    listDisplaySaveQueue.current = listDisplaySaveQueue.current
      .then(() => saveListDisplayPreferences(value))
      .catch(() => undefined);
  };
  const changeListDisplay = (
    groups: Set<DeadlineGroupKey>,
    pinned: boolean,
    granularity = todayGranularity,
  ) => {
    setVisibleGroupIds(groups);
    setShowPinnedNote(pinned);
    setTodayGranularity(granularity);
    saveListPreferences(groups, pinned, granularity, pinnedNoteHeight);
  };
  const changeReminders = async (next: ReminderPreferences) => {
    if (
      next.enabled &&
      !reminders.enabled &&
      !(await requestReminderPermission())
    ) {
      appAlert(
        "通知を有効にできません",
        "端末の設定でTaskMemoの通知を許可してください。",
      );
      return;
    }
    setReminders(next);
    await saveReminderPreferences(next);
  };
  const completeWithUndo = (memo: MemoNode) => {
    if (exitingMemos.has(memo.id)) return;
    setExitingMemos((current) => new Map(current).set(memo.id, memo));
    apply("Memoを完了", (current) => completeMemo(current, memo.id));
  };
  const finishCompletionAnimation = (id: string) => {
    const memo = exitingMemos.get(id);
    setExitingMemos((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    if (memo)
      setCompletionNotices((current) => [
        ...current,
        { token: `${id}-${Date.now()}`, id, title: memo.title },
      ]);
  };
  const openCreate = (type: "memo" | "category", memoType?: MemoType) => {
    setCreateOpen(false);
    setMenuNode(null);
    setEditor({ type, memoType, parentId: createParentId });
  };
  const onDrop = (nodeId: string, candidate: DropCandidate) => {
    const traceId = currentTreeTraceId();
    setHistory((current) => {
      const before = current.nodes.find((node) => node.id === nodeId);
      const next = commitNodeHistory(current, "Nodeを移動", (nodes) =>
        tryMoveNode(nodes, nodeId, candidate.parentId, candidate.beforeId),
      );
      const after = next.nodes.find((node) => node.id === nodeId);
      treeDiagnosticLog("drag-end-after-state", {
        traceId,
        movingId: nodeId,
        candidate,
        committed: next !== current,
        before: before
          ? { parentId: before.parentId, sortKey: before.sortKey }
          : null,
        after: after
          ? { parentId: after.parentId, sortKey: after.sortKey }
          : null,
        beforeNodesRevision: nodesRevision(current.nodes),
        nodesRevision: nodesRevision(next.nodes),
        nodes: summarizeNodes(next.nodes),
      });
      return next;
    });
  };
  const exportData = async () => {
    try {
      await exportNodesToFile(nodes);
    } catch (error) {
      appAlert(
        "書き出しエラー",
        error instanceof Error
          ? error.message
          : "データを書き出せませんでした。",
      );
    }
  };
  const importData = async () => {
    try {
      const imported = await pickAndParseNodeBackup();
      if (!imported) return;
      appAlert(
        "データを読み込む",
        `現在のデータを、選択した${imported.length}件のNodeで置き換えます。先に書き出しておくことを推奨します。`,
        [
          { text: "キャンセル", style: "cancel" },
          {
            text: "置き換える",
            style: "destructive",
            onPress: async () => {
              try {
                const normalized = normalizeLegacyRanks(imported);
                await saveNodes(normalized);
                setHistory((current) =>
                  replaceNodeHistory(current, normalized),
                );
                setSettingsOpen(false);
              } catch {
                appAlert(
                  "保存エラー",
                  "読み込んだデータを端末へ保存できませんでした。",
                );
              }
            },
          },
        ],
      );
    } catch (error) {
      appAlert(
        "読み込みエラー",
        error instanceof Error
          ? error.message
          : "データを読み込めませんでした。",
      );
    }
  };
  const askDelete = (node: Node) => {
    setMenuNode(null);
    if (node.type === "memo")
      appAlert("Memoを削除", `「${node.title}」をゴミ箱へ移動します。`, [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: () => apply("Memoを削除", (n) => softDeleteNode(n, node.id)),
        },
      ]);
    else
      appAlert("Categoryを削除", "子の扱いを選択してください。", [
        { text: "キャンセル", style: "cancel" },
        {
          text: "Categoryのみ削除",
          onPress: () =>
            apply("Categoryのみ削除", (n) => softDeleteNode(n, node.id, false)),
        },
        {
          text: "子ごと削除",
          style: "destructive",
          onPress: () =>
            apply("Categoryを子ごと削除", (n) =>
              softDeleteNode(n, node.id, true),
            ),
        },
      ]);
  };
  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "right", "bottom", "left"]}
    >
      <StatusBar style={resolved === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>TaskMemo</Text>
          <Text style={styles.subtitle}>メモとタスク</Text>
        </View>
        <View style={styles.headerActions}>
          <HistoryButton
            label="↶"
            accessibilityLabel="元に戻す"
            disabled={!history.past.length}
            onPress={() => setHistory(undoNodeHistory)}
          />
          <HistoryButton
            label="↷"
            accessibilityLabel="やり直す"
            disabled={!history.future.length}
            onPress={() => setHistory(redoNodeHistory)}
          />
          <TopButton label="設定" onPress={() => setSettingsOpen(true)} />
        </View>
      </View>
      <View style={styles.tabs}>
        <Tab
          label="一覧"
          active={view === "deadline"}
          onPress={() => setView("deadline")}
        />
        <Tab
          label="ツリー"
          active={view === "tree"}
          onPress={() => setView("tree")}
        />
        <Tab
          label="完了"
          active={view === "completed"}
          onPress={() => setView("completed")}
        />
        <Tab
          label="ゴミ箱"
          active={view === "trash"}
          onPress={() => setView("trash")}
        />
      </View>
      <View style={styles.tree} pointerEvents={ready ? "auto" : "none"}>
        {view === "tree" ? (
          <NodeTree
            nodes={displayNodes}
            showCompletedMemos={showCompletedTreeMemos}
            onShowCompletedMemosChange={(value) => {
              setShowCompletedTreeMemos(value);
              saveTreeDisplayPreferences({ showCompletedMemos: value }).catch(() => {});
            }}
            completingIds={new Set(exitingMemos.keys())}
            onCompletionAnimationFinished={finishCompletionAnimation}
            onAddMemo={(parentId) => {
              setCreateParentId(parentId);
              setCreateOpen(true);
            }}
            onRenameMemo={(id, title) =>
              apply("Memoタイトルを変更", (current) =>
                updateNode(current, id, { title }),
              )
            }
            onComplete={completeWithUndo}
            onMenu={setMenuNode}
            onDrop={onDrop}
            onBulkMove={(nodeIds, onSuccess) =>
              setBulkMove({ nodeIds, onSuccess })
            }
            onBulkComplete={(nodeIds) =>
              applyBatch("選択Memoを完了", (current) =>
                completeSelectedNodes(current, nodeIds),
              )
            }
            onBulkDelete={(nodeIds, onSuccess) => {
              const roots = normalizeSelectedNodeIds(nodes, nodeIds);
              const titles = roots
                .map((id) => nodes.find((node) => node.id === id)?.title)
                .filter(Boolean);
              appAlert(
                `${roots.length}件を削除`,
                `${titles.join("、")} をゴミ箱へ移動します。Categoryは配下のNodeも一緒に削除されます。`,
                [
                  { text: "キャンセル", style: "cancel" },
                  {
                    text: "削除",
                    style: "destructive",
                    onPress: () => {
                      if (
                        applyBatch("選択Nodeを削除", (current) =>
                          deleteSelectedNodes(current, roots),
                        )
                      )
                        onSuccess();
                    },
                  },
                ],
              );
            }}
          />
        ) : view === "deadline" ? (
          <DeadlineView
            nodes={displayNodes}
            visibleGroupIds={visibleGroupIds}
            todayGranularity={todayGranularity}
            completingIds={new Set(exitingMemos.keys())}
            onCompletionAnimationFinished={finishCompletionAnimation}
            showPinnedNote={showPinnedNote}
            pinnedNote={pinnedNote}
            pinnedNoteHeight={pinnedNoteHeight}
            onPinnedNoteChange={changePinnedNote}
            onPinnedNoteHeightChange={(height) => {
              setPinnedNoteHeight(height);
              saveListPreferences(
                new Set(visibleGroupIds),
                showPinnedNote,
                todayGranularity,
                height,
              );
            }}
            expandedGroups={deadlineExpanded}
            onExpandedGroupsChange={setDeadlineExpanded}
            onQuickAdd={(title, deadline) =>
              apply("Memoをクイック追加", (current) =>
                createNode(current, "memo", {
                  title,
                  parentId: null,
                  ...deadline,
                }),
              )
            }
            onRenameMemo={(id, title) =>
              apply("Memoタイトルを変更", (current) =>
                updateNode(current, id, { title }),
              )
            }
            onComplete={completeWithUndo}
            onMenu={setMenuNode}
            onDueDrop={(id, group, beforeId) =>
              apply("一覧でMemoを移動", (current) =>
                moveMemoInDeadlineList(
                  current,
                  id,
                  group,
                  beforeId,
                  new Date(),
                  todayGranularity,
                ),
              )
            }
            onBulkMove={(ids, onSuccess) =>
              setBulkDeadlineMove({ nodeIds: ids, onSuccess })
            }
            onBulkComplete={(ids) =>
              applyBatch("選択Memoを完了", (current) =>
                completeSelectedNodes(current, ids),
              )
            }
            onBulkDelete={(ids, onSuccess) =>
              appAlert(
                `${ids.length}件を削除`,
                "選択したTaskをゴミ箱へ移動します。",
                [
                  { text: "キャンセル", style: "cancel" },
                  {
                    text: "削除",
                    style: "destructive",
                    onPress: () => {
                      if (
                        applyBatch("選択Taskを削除", (current) =>
                          deleteSelectedNodes(current, ids),
                        )
                      )
                        onSuccess();
                    },
                  },
                ],
              )
            }
          />
        ) : (
          <ListPanel
            type={view}
            nodes={nodes}
            parentName={parentName}
            onRestoreCompleted={(item) =>
              apply("完了を未完了に戻す", (current) =>
                item.kind === "routineOccurrence"
                  ? clearRoutineCompletion(
                      current,
                      item.memo.id,
                      item.occurrenceDate!,
                    )
                  : restoreMemo(current, item.memo.id),
              )
            }
            onRestoreNode={(id) =>
              apply("Nodeを復元", (current) => restoreNode(current, id))
            }
            onDelete={(id) => {
              const node = nodes.find((item) => item.id === id);
              if (node) askDelete(node);
            }}
            onHardDelete={(id) =>
              appAlert("完全に削除", "完全に削除すると元に戻せません。", [
                { text: "キャンセル", style: "cancel" },
                {
                  text: "完全に削除",
                  style: "destructive",
                  onPress: () => replaceNodes((n) => hardDeleteNode(n, id)),
                },
              ])
            }
            onBulkRestoreCompleted={(items, onSuccess) => {
              if (
                applyBatch("選択した完了を戻す", (current) =>
                  items.reduce(
                    (next, item) =>
                      item.kind === "routineOccurrence"
                        ? clearRoutineCompletion(
                            next,
                            item.memo.id,
                            item.occurrenceDate!,
                          )
                        : restoreMemo(next, item.memo.id),
                    current,
                  ),
                )
              )
                onSuccess();
            }}
            onBulkDeleteCompleted={(ids, onSuccess) =>
              appAlert(
                `${ids.length}件を削除`,
                "選択した完了Taskをゴミ箱へ移動します。",
                [
                  { text: "キャンセル", style: "cancel" },
                  {
                    text: "削除",
                    style: "destructive",
                    onPress: () => {
                      if (
                        applyBatch("選択した完了Taskを削除", (current) =>
                          deleteSelectedNodes(current, ids),
                        )
                      )
                        onSuccess();
                    },
                  },
                ],
              )
            }
            onBulkRestoreNodes={(ids, onSuccess) => {
              if (
                applyBatch("選択Nodeを復元", (current) =>
                  ids.reduce((next, id) => restoreNode(next, id), current),
                )
              )
                onSuccess();
            }}
            onBulkHardDelete={(ids, onSuccess) =>
              appAlert(
                `${ids.length}件を完全に削除`,
                "選択したNodeは元に戻せません。",
                [
                  { text: "キャンセル", style: "cancel" },
                  {
                    text: "完全に削除",
                    style: "destructive",
                    onPress: () => {
                      if (
                        applyBatch("選択Nodeを完全削除", (current) =>
                          ids.reduce(
                            (next, id) => hardDeleteNode(next, id),
                            current,
                          ),
                        )
                      )
                        onSuccess();
                    },
                  },
                ],
              )
            }
            onReset={() =>
              appAlert(
                "データを初期化",
                "端末の変更を破棄して初期データへ戻します。",
                [
                  { text: "キャンセル", style: "cancel" },
                  {
                    text: "初期化",
                    style: "destructive",
                    onPress: async () => {
                      await resetNodes();
                      setHistory((current) =>
                        replaceNodeHistory(
                          current,
                          normalizeLegacyRanks(mockNodes),
                        ),
                      );
                    },
                  },
                ],
              )
            }
          />
        )}
      </View>
      {(view === "deadline" || view === "tree") && (
        <Pressable
          disabled={!ready}
          style={[styles.fab, !ready && { opacity: 0.4 }]}
          onPress={() => {
            setCreateParentId(null);
            if (view === "deadline")
              setEditor({ type: "memo", parentId: null });
            else setCreateOpen(true);
          }}
          accessibilityLabel="新規作成"
        >
          <Text style={styles.fabText}>＋</Text>
        </Pressable>
      )}
      <Sheet
        visible={createOpen}
        title="新規作成"
        onClose={() => setCreateOpen(false)}
      >
        <Action label="タスク" onPress={() => openCreate("memo", "task")} />
        {ideasEnabled && !routineCategoryForParent(nodes, createParentId) && (
          <Action
            label="💡 アイデア"
            onPress={() => openCreate("memo", "idea")}
          />
        )}
        {view === "tree" &&
          !routineCategoryForParent(nodes, createParentId) && (
            <Action label="カテゴリ" onPress={() => openCreate("category")} />
          )}
      </Sheet>
      <Sheet
        visible={!!menuNode}
        title={menuNode?.title ?? ""}
        onClose={() => setMenuNode(null)}
      >
        {menuNode?.type !== "category" ||
        menuNode.categoryKind !== "routineRoot" ? (
          <Action
            label="編集"
            onPress={() => {
              if (menuNode)
                setEditor({
                  type: menuNode.type,
                  node: menuNode,
                  memoType:
                    menuNode.type === "memo"
                      ? isIdea(menuNode)
                        ? "idea"
                        : "task"
                      : undefined,
                  parentId: menuNode.parentId,
                });
              setMenuNode(null);
            }}
          />
        ) : null}
        {menuNode?.type === "memo" ? (
          <>
            {!isIdea(menuNode) && (
              <Action
                label={
                  menuNode.status === "completed" ? "未完了へ戻す" : "完了"
                }
                onPress={() => {
                  apply(
                    menuNode.status === "completed"
                      ? "Memoを未完了に戻す"
                      : "Memoを完了",
                    (n) =>
                      menuNode.status === "completed"
                        ? restoreMemo(n, menuNode.id)
                        : completeMemo(n, menuNode.id),
                  );
                  setMenuNode(null);
                }}
              />
            )}
            <Action
              label="複製"
              onPress={() => {
                apply("Memoを複製", (nodes) =>
                  duplicateMemo(nodes, menuNode.id),
                );
                setMenuNode(null);
              }}
            />
            {isIdea(menuNode) ? (
              <Action
                label="タスクへ変換"
                onPress={() => {
                  apply("IdeaをTaskへ変換", (nodes) =>
                    convertMemoType(nodes, menuNode.id, "task"),
                  );
                  setMenuNode(null);
                }}
              />
            ) : ideasEnabled &&
              !routineCategoryForParent(nodes, menuNode.parentId) ? (
              <Action
                label="アイデアへ変換"
                onPress={() => {
                  const target = menuNode;
                  setMenuNode(null);
                  appAlert(
                    "アイデアへ変換",
                    "期限・完了情報・ルーティーン設定などTask固有の情報は破棄されます。変換しますか？",
                    [
                      { text: "キャンセル", style: "cancel" },
                      {
                        text: "変換",
                        style: "destructive",
                        onPress: () =>
                          apply("TaskをIdeaへ変換", (nodes) =>
                            convertMemoType(nodes, target.id, "idea"),
                          ),
                      },
                    ],
                  );
                }}
              />
            ) : null}
          </>
        ) : (
          <Action
            label="子を追加"
            onPress={() => {
              if (menuNode) setCreateParentId(menuNode.id);
              setMenuNode(null);
              setCreateOpen(true);
            }}
          />
        )}
        {menuNode?.type !== "category" ||
        menuNode.categoryKind !== "routineRoot" ? (
          <>
            <Action
              label="移動"
              onPress={() => {
                setMovingNode(menuNode);
                setMenuNode(null);
              }}
            />
            <Action
              label="削除"
              danger
              onPress={() => menuNode && askDelete(menuNode)}
            />
          </>
        ) : null}
      </Sheet>
      <EditorModal
        key={
          editor?.node?.id ??
          `${editor?.type}-${editor?.memoType ?? "task"}-${editor?.parentId ?? "root"}-${editor?.dueContext?.targetGroup ?? "default"}`
        }
        editor={editor}
        nodes={nodes}
        onToggleRoutineHistory={(memoId, date) =>
          apply("ルーティーン実績を変更", (current) =>
            toggleRoutineCompletion(current, memoId, date),
          )
        }
        onClose={() => setEditor(null)}
        onSave={(draft) => {
          apply(editor?.node ? "Nodeを編集" : "Nodeを作成", (current) =>
            editor?.node
              ? updateNode(current, editor.node.id, draft)
              : createNode(current, editor!.type, draft),
          );
          setEditor(null);
        }}
      />
      <MovePanel
        node={movingNode}
        nodes={nodes}
        onClose={() => setMovingNode(null)}
        onMove={(parentId) => {
          if (movingNode)
            apply("Nodeを移動", (n) => moveNode(n, movingNode.id, parentId));
          setMovingNode(null);
        }}
      />
      <BulkMovePanel
        nodeIds={bulkMove?.nodeIds ?? []}
        nodes={nodes}
        onClose={() => setBulkMove(null)}
        onMove={(parentId) => {
          if (!bulkMove) return;
          if (
            applyBatch("選択Nodeを移動", (current) =>
              moveSelectedNodes(current, bulkMove.nodeIds, parentId),
            )
          ) {
            bulkMove.onSuccess();
            setBulkMove(null);
          }
        }}
      />
      <BulkDeadlineMovePanel
        nodeIds={bulkDeadlineMove?.nodeIds ?? []}
        granularity={todayGranularity}
        onClose={() => setBulkDeadlineMove(null)}
        onMove={(groupId, customDueAt) => {
          if (!bulkDeadlineMove) return;
          if (
            applyBatch("選択Taskの期限を移動", (current) =>
              bulkDeadlineMove.nodeIds.reduce(
                (next, id) =>
                  customDueAt
                    ? updateNode(next, id, {
                        duePreset: "custom",
                        dueAt: customDueAt,
                      })
                    : updateMemoDeadline(
                        next,
                        id,
                        groupId!,
                        new Date(),
                        todayGranularity,
                      ),
                current,
              ),
            )
          ) {
            bulkDeadlineMove.onSuccess();
            setBulkDeadlineMove(null);
          }
        }}
      />
      <Sheet
        visible={settingsOpen}
        title="設定"
        onClose={() => setSettingsOpen(false)}
      >
        <SettingsSection title="機能">
          <ToggleSetting
            label="アイデア機能"
            description="Taskとは別に、期限や完了を持たないIdeaを利用します"
            value={ideasEnabled}
            onValueChange={(next) => {
              setIdeasEnabled(next);
              saveFeaturePreferences({ ideasEnabled: next }).catch(() =>
                appAlert("保存エラー", "設定を保存できませんでした。"),
              );
            }}
          />
        </SettingsSection>
        <SettingsSection title="同期・連携">
          <SettingsLink
            label="クラウド同期"
            value={
              sync.status === "synced"
                ? "同期済み"
                : sync.status === "connecting"
                  ? "接続中…"
                  : sync.user
                    ? "オフライン/エラー"
                    : sync.configured
                      ? "未ログイン"
                      : "未設定"
            }
            onPress={() => {
              setSettingsOpen(false);
              setSyncOpen(true);
            }}
          />
          <SettingsLink
            label="外部AI連携"
            onPress={() => {
              setSettingsOpen(false);
              setExternalAiOpen(true);
            }}
          />
        </SettingsSection>
        <SettingsSection title="通知">
          <ToggleSetting
            label="期限通知"
            value={reminders.enabled}
            onValueChange={(enabled) =>
              changeReminders({ ...reminders, enabled })
            }
          />
          <ToggleSetting
            label="当日に通知"
            value={reminders.sameDay}
            disabled={!reminders.enabled}
            onValueChange={(sameDay) =>
              changeReminders({ ...reminders, sameDay })
            }
          />
          <ToggleSetting
            label="1日前に通知"
            value={reminders.dayBefore}
            disabled={!reminders.enabled}
            onValueChange={(dayBefore) =>
              changeReminders({ ...reminders, dayBefore })
            }
          />
          <Text style={styles.settingHelp}>
            日時指定はその時刻、それ以外は午前9時に通知します。
            {Platform.OS === "web"
              ? " Web版はページまたはインストール済みPWAが動作中の間に通知します。"
              : ""}
          </Text>
        </SettingsSection>
        <SettingsSection title="外観">
          <RadioSetting
            options={(["system", "light", "dark"] as ThemeMode[]).map(
              (value) => ({
                id: value,
                label:
                  value === "system"
                    ? "システム"
                    : value === "light"
                      ? "ライト"
                      : "ダーク",
              }),
            )}
            value={mode}
            onChange={(value) => setMode(value as ThemeMode)}
          />
        </SettingsSection>
        <SettingsSection title="今日の表示">
          <RadioSetting
            options={TODAY_GRANULARITIES.map((item) => ({
              id: item.id,
              label: item.label,
            }))}
            value={todayGranularity}
            onChange={(value) => {
              const next = value as TodayGranularity;
              setDeadlineExpanded(
                new Set(
                  deadlineGroupDefinitions(next).map((group) => group.id),
                ),
              );
              changeListDisplay(new Set(visibleGroupIds), showPinnedNote, next);
            }}
          />
        </SettingsSection>
        <SettingsSection title="一覧の表示">
          {deadlineGroupDefinitions(todayGranularity).map((group) => (
            <ToggleSetting
              key={group.id}
              label={group.label}
              value={visibleGroupIds.has(group.id)}
              onValueChange={(enabled) => {
                const next = new Set(visibleGroupIds);
                if (enabled) next.add(group.id);
                else next.delete(group.id);
                changeListDisplay(next, showPinnedNote);
              }}
            />
          ))}
          <ToggleSetting
            label="上部の常設メモ"
            value={showPinnedNote}
            onValueChange={(enabled) =>
              changeListDisplay(new Set(visibleGroupIds), enabled)
            }
          />
        </SettingsSection>
        <SettingsSection title="データ管理">
          <View style={styles.settingsButtonRow}>
            <SettingsButton label="データを書き出す" onPress={exportData} />
            <SettingsButton label="データを読み込む" onPress={importData} />
          </View>
        </SettingsSection>
      </Sheet>
      <Sheet
        visible={syncOpen}
        title="クラウド同期"
        onClose={() => setSyncOpen(false)}
      >
        <SyncAccountPanel
          configured={sync.configured}
          user={sync.user}
          status={sync.status}
          error={sync.error}
          onSignIn={sync.signIn}
          onSignUp={sync.signUp}
          onSignOut={sync.signOut}
        />
      </Sheet>
      <Sheet
        visible={externalAiOpen}
        title="外部AI連携"
        onClose={() => setExternalAiOpen(false)}
      >
        <ExternalAiConnectionPanel
          user={sync.user}
          authorizationRequestId={authorizationRequestId}
          onAuthorized={() => setAuthorizationRequestId(null)}
        />
      </Sheet>
      <View pointerEvents="box-none" style={styles.snackbarStack}>
        {completionNotices.map((notice) => (
          <SnackbarNotice
            key={notice.token}
            notice={notice}
            onExpire={() =>
              setCompletionNotices((current) =>
                current.filter((item) => item.token !== notice.token),
              )
            }
            onUndo={() => {
              setExitingMemos((current) => {
                const next = new Map(current);
                next.delete(notice.id);
                return next;
              });
              apply("完了を元に戻す", (current) =>
                restoreMemo(current, notice.id),
              );
              setCompletionNotices((current) =>
                current.filter((item) => item.token !== notice.token),
              );
            }}
          />
        ))}
      </View>
    </SafeAreaView>
  );
}

function TopButton({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={styles.topButton}>
      <Text style={styles.topText}>{label}</Text>
    </Pressable>
  );
}
function HistoryButton({
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={[styles.historyButton, disabled && styles.disabled]}
    >
      <Text style={styles.historyText}>{label}</Text>
    </Pressable>
  );
}
function Tab({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}
function Action({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={styles.action}>
      <Text style={[styles.actionText, danger && styles.danger]}>{label}</Text>
    </Pressable>
  );
}
function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.settingsSection}>
      <Text style={styles.settingsSectionTitle}>{title}</Text>
      <View style={styles.settingsCard}>{children}</View>
    </View>
  );
}
function ToggleSetting({
  label,
  description,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  return (
    <View style={[styles.settingRow, disabled && styles.settingDisabled]}>
      <Pressable
        disabled={disabled}
        onPress={() => onValueChange(!value)}
        style={styles.settingLabelArea}
      >
        <Text style={styles.settingLabel}>{label}</Text>
        {description && (
          <Text style={styles.settingDescription}>{description}</Text>
        )}
      </Pressable>
      <Switch
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor={colors.surface}
        accessibilityLabel={label}
      />
    </View>
  );
}
function RadioSetting({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.radioGrid}>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            style={[styles.radioCard, selected && styles.radioCardSelected]}
          >
            <View
              style={[
                styles.radioCircle,
                selected && styles.radioCircleSelected,
              ]}
            >
              {selected && <View style={styles.radioDot} />}
            </View>
            <Text
              style={[styles.radioLabel, selected && styles.radioLabelSelected]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function SettingsLink({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.settingLinkValue}>
        <Text style={styles.settingValue}>{value}</Text>
        <Text style={styles.settingChevron}>›</Text>
      </View>
    </Pressable>
  );
}
function SettingsButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsButton,
        pressed && styles.settingsButtonPressed,
      ]}
    >
      <Text style={styles.settingsButtonText}>{label}</Text>
    </Pressable>
  );
}
function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.keyboardSheet}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <ScrollView
              style={styles.sheetContent}
              contentContainerStyle={styles.sheetScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={
                Platform.OS === "ios" ? "interactive" : "on-drag"
              }
              automaticallyAdjustKeyboardInsets
            >
              {children}
            </ScrollView>
            <Action label="キャンセル" onPress={onClose} />
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function EditorModal({
  editor,
  nodes,
  onToggleRoutineHistory,
  onClose,
  onSave,
}: {
  editor: Editor;
  nodes: Node[];
  onToggleRoutineHistory: (memoId: string, date: Date) => void;
  onClose: () => void;
  onSave: (draft: {
    title: string;
    parentId: string | null;
    body?: string;
    duePreset?: DuePreset;
    dueAt?: Date | null;
    status?: "active" | "completed";
    repeatRule?: RepeatRule | null;
    memoType?: MemoType;
  }) => void;
}) {
  const styles = useStyles();
  const { colors } = useAppTheme();
  const { height: viewportHeight } = useWindowDimensions();
  const [scrollAtTop, setScrollAtTop] = useState(true);
  const [sheetTranslateY] = useState(() => new Animated.Value(0));
  const initialMemo = editor?.node?.type === "memo" ? editor.node : null;
  const memo = initialMemo
    ? (nodes.find(
        (node): node is MemoNode =>
          node.id === initialMemo.id && node.type === "memo",
      ) ?? initialMemo)
    : null;
  const dueContext = editor?.dueContext;
  const idea =
    editor?.type === "memo" &&
    (editor.memoType === "idea" || (!!memo && isIdea(memo)));
  const routineCategory =
    editor?.type === "memo" && !idea
      ? routineCategoryForParent(nodes, editor.parentId)
      : null;
  const [title, setTitle] = useState(editor?.node?.title ?? "");
  const [body, setBody] = useState(initialMemo?.body ?? "");
  const [preset, setPreset] = useState<DuePreset>(
    initialMemo?.duePreset ?? dueContext?.initialDuePreset ?? "today",
  );
  const [custom, setCustom] = useState(() =>
    formatDateTimeInput(
      initialMemo?.dueAt ?? dueContext?.initialDueAt ?? new Date(),
    ),
  );
  const [status, setStatus] = useState<"active" | "completed">(
    initialMemo?.status ?? "active",
  );
  const [repeatFrequency, setRepeatFrequency] = useState<
    RepeatFrequency | "none"
  >(initialMemo?.repeatRule?.frequency ?? "none");
  const [repeatInterval, setRepeatInterval] = useState(
    String(initialMemo?.repeatRule?.interval ?? 1),
  );
  const [repeatStartsOn, setRepeatStartsOn] = useState(
    initialMemo?.repeatRule?.startsOn ?? localDateKey(),
  );
  const save = () => {
    if (!editor || !title.trim())
      return appAlert("入力エラー", "タイトルは必須です。");
    if (idea)
      return onSave({
        title,
        parentId: editor.parentId,
        body,
        memoType: "idea",
        duePreset: "none",
        dueAt: null,
        status: "active",
        repeatRule: null,
      });
    if (routineCategory) {
      const interval = Number(repeatInterval);
      const repeatRule =
        repeatFrequency === "none"
          ? null
          : { frequency: repeatFrequency, interval, startsOn: repeatStartsOn };
      if (repeatRule && !isValidRepeatRule(repeatRule))
        return appAlert(
          "入力エラー",
          "間隔は1以上の整数、開始日は YYYY-MM-DD 形式で入力してください。",
        );
      return onSave({
        title,
        parentId: editor.parentId,
        body,
        duePreset: memo?.duePreset ?? "none",
        dueAt: memo?.dueAt ?? null,
        status: "active",
        repeatRule,
        memoType: "task",
      });
    }
    let dueAt =
      dueContext && !dueContext.dueEditable
        ? dueContext.initialDueAt
        : dueDateForPreset(preset);
    if (preset === "custom" && !dueContext) {
      dueAt = parseLocalDateTime(custom);
      if (!dueAt)
        return appAlert(
          "入力エラー",
          "日時を YYYY/MM/DD HH:mm 形式で入力してください。",
        );
    }
    if (
      dueContext?.dueEditable &&
      deadlineGroupForDueAt(dueAt, new Date(), dueContext.granularity) !==
        dueContext.targetGroup
    )
      return appAlert(
        "入力エラー",
        `「${dueContext.label}」に入る期限を指定してください。`,
      );
    onSave({
      title,
      parentId: editor.parentId,
      body,
      duePreset: dueContext?.initialDuePreset ?? preset,
      dueAt,
      status,
      memoType: "task",
    });
  };
  const dismissPanResponder = PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      canStartSheetDismiss({ scrollOffset: scrollAtTop ? 0 : 1, dx: gesture.dx, dy: gesture.dy }),
    onPanResponderMove: (_event, gesture) => sheetTranslateY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      if (sheetDismissRelease({ distance: Math.max(0, gesture.dy), velocity: gesture.vy, viewportHeight }) === 'commit-close') {
        Animated.timing(sheetTranslateY, { toValue: viewportHeight, duration: 180, useNativeDriver: true })
          .start(({ finished }) => { if (finished) save(); });
      } else {
        Animated.spring(sheetTranslateY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => Animated.spring(sheetTranslateY, { toValue: 0, useNativeDriver: true }).start(),
  });
  return (
    <Modal
      visible={!!editor}
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onRequestClose={save}
    >
      <Animated.View
        style={[styles.modalPage, { transform: [{ translateY: sheetTranslateY }] }]}
        {...(Platform.OS === "web" ? dismissPanResponder.panHandlers : {})}
      >
      <SafeAreaView style={styles.modalPage}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            nativeID="editor-keyboard-scroll"
            onScroll={(event) => setScrollAtTop(event.nativeEvent.contentOffset.y <= 0)}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.form}
          >
            <View style={styles.grabber} />
            <Text style={styles.modalTitle}>
              {editor?.node ? "編集" : "新規作成"}
            </Text>
            {editor?.type === "memo" && (
              <Text style={styles.destination}>
                追加先: {categoryPath(nodes, editor.parentId)} ·{" "}
                {idea
                  ? "💡 アイデア"
                  : routineCategory
                    ? `繰り返し: ${repeatRuleLabel(repeatFrequency === "none" ? null : { frequency: repeatFrequency, interval: Number(repeatInterval), startsOn: repeatStartsOn })}`
                    : `期限: ${dueContext?.label ?? presets.find((item) => item.key === preset)?.label}`}
              </Text>
            )}
            <Text style={styles.label}>
              {editor?.type === "memo" ? "タイトル" : "Category名"} *
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              autoFocus
            />
            {editor?.type === "memo" && (
              <>
                <Text style={styles.label}>自由記述</Text>
                <TextInput
                  value={body}
                  onChangeText={setBody}
                  placeholderTextColor={colors.textSecondary}
                  style={[styles.input, styles.multiline]}
                  multiline
                  textAlignVertical="top"
                />
                {idea ? (
                  <Text style={styles.lockedDue}>
                    アイデアは期限・完了・ルーティーンを持ちません。
                  </Text>
                ) : routineCategory ? (
                  <>
                    <Text style={styles.label}>繰り返し設定</Text>
                    <View style={styles.chips}>
                      {(
                        [
                          { key: "none", label: "未設定" },
                          { key: "day", label: "日" },
                          { key: "week", label: "週" },
                          { key: "month", label: "月" },
                          { key: "year", label: "年" },
                        ] as const
                      ).map((item) => (
                        <Pressable
                          key={item.key}
                          onPress={() => setRepeatFrequency(item.key)}
                          style={[
                            styles.chip,
                            repeatFrequency === item.key && styles.chipOn,
                          ]}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              repeatFrequency === item.key && styles.chipTextOn,
                            ]}
                          >
                            {item.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    {repeatFrequency === "none" ? (
                      <Text style={styles.lockedDue}>
                        繰り返し未設定のMemoは期限一覧へ発生しません。
                      </Text>
                    ) : (
                      <>
                        <Text style={styles.label}>間隔</Text>
                        <TextInput
                          value={repeatInterval}
                          onChangeText={setRepeatInterval}
                          keyboardType="number-pad"
                          style={styles.input}
                        />
                        <Text style={styles.label}>開始日</Text>
                        <DateField
                          value={repeatStartsOn}
                          onChange={setRepeatStartsOn}
                        />
                      </>
                    )}
                    {memo && (
                      <>
                        <Text style={styles.label}>実績</Text>
                        {routineHistoryDays(memo).map((day) => (
                          <Action
                            key={day.key}
                            label={`${day.completed ? "✓" : "—"} ${day.key}`}
                            onPress={() =>
                              onToggleRoutineHistory(memo.id, day.date)
                            }
                          />
                        ))}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.label}>期限</Text>
                    {dueContext ? (
                      dueContext.dueEditable ? (
                        <DateTimeField value={custom} onChange={setCustom} />
                      ) : (
                        <Text style={styles.lockedDue}>
                          {presets.find((item) => item.key === preset)?.label}
                        </Text>
                      )
                    ) : (
                      <>
                        <View style={styles.chips}>
                          {presets.map((item) => (
                            <Pressable
                              key={item.key}
                              onPress={() => setPreset(item.key)}
                              style={[
                                styles.chip,
                                preset === item.key && styles.chipOn,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.chipText,
                                  preset === item.key && styles.chipTextOn,
                                ]}
                              >
                                {item.label}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                        {preset === "custom" && (
                          <DateTimeField value={custom} onChange={setCustom} />
                        )}
                      </>
                    )}
                    {memo && (
                      <>
                        <Text style={styles.label}>ステータス</Text>
                        <View style={styles.chips}>
                          <Pressable
                            onPress={() => setStatus("active")}
                            style={[
                              styles.chip,
                              status === "active" && styles.chipOn,
                            ]}
                          >
                            <Text style={styles.chipText}>未完了</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setStatus("completed")}
                            style={[
                              styles.chip,
                              status === "completed" && styles.chipOn,
                            ]}
                          >
                            <Text style={styles.chipText}>完了</Text>
                          </Pressable>
                        </View>
                      </>
                    )}
                  </>
                )}
              </>
            )}
            <View style={styles.formButtons}>
              <Pressable onPress={onClose} style={styles.secondary}>
                <Text style={styles.buttonText}>キャンセル</Text>
              </Pressable>
              <Pressable onPress={save} style={styles.primary}>
                <Text style={styles.primaryText}>保存</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

function ListPanel({
  type,
  nodes,
  parentName,
  onRestoreCompleted,
  onRestoreNode,
  onDelete,
  onHardDelete,
  onBulkRestoreCompleted,
  onBulkDeleteCompleted,
  onBulkRestoreNodes,
  onBulkHardDelete,
  onReset,
}: {
  type: "completed" | "trash";
  nodes: Node[];
  parentName: (id: string | null) => string;
  onRestoreCompleted: (item: CompletionHistoryItem) => void;
  onRestoreNode: (id: string) => void;
  onDelete: (id: string) => void;
  onHardDelete: (id: string) => void;
  onBulkRestoreCompleted: (
    items: CompletionHistoryItem[],
    onSuccess: () => void,
  ) => void;
  onBulkDeleteCompleted: (ids: string[], onSuccess: () => void) => void;
  onBulkRestoreNodes: (ids: string[], onSuccess: () => void) => void;
  onBulkHardDelete: (ids: string[], onSuccess: () => void) => void;
  onReset: () => void;
}) {
  const styles = useStyles();
  const [criterion, setCriterion] =
    useState<CompletionHistoryCriterion>("completedAt");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set<string>());
  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  };
  const toggleSelected = (key: string) =>
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const historyGroups = useMemo(
    () => completionHistoryGroups(nodes, criterion),
    [criterion, nodes],
  );
  const trashItems = useMemo(
    () =>
      nodes
        .filter((node) => node.deletedAt && !node.purgedAt)
        .sort((a, b) => b.deletedAt!.getTime() - a.deletedAt!.getTime()),
    [nodes],
  );
  const selectedHistoryItems = historyGroups
    .flatMap((group) => group.items)
    .filter((item) => selectedKeys.has(item.key));
  const selectedTrashIds = trashItems
    .filter((node) => selectedKeys.has(node.id))
    .map((node) => node.id);
  const deletableCompletedIds = [
    ...new Set(
      selectedHistoryItems
        .filter((item) => item.kind === "memo")
        .map((item) => item.memo.id),
    ),
  ];
  return (
    <View style={styles.panelContainer}>
      <View style={styles.selectionToolbar}>
        {selectionMode ? (
          <>
            <Text style={styles.selectionToolbarCount}>
              {selectedKeys.size}件選択
            </Text>
            <Pressable style={styles.smallButton} onPress={clearSelection}>
              <Text style={styles.buttonText}>キャンセル</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            style={styles.smallButton}
            onPress={() => setSelectionMode(true)}
          >
            <Text style={styles.buttonText}>複数選択</Text>
          </Pressable>
        )}
      </View>
      {type === "completed" && (
        <View style={styles.historyCriteria}>
          {COMPLETION_HISTORY_CRITERIA.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setCriterion(item.id)}
              style={[
                styles.historyCriterion,
                criterion === item.id && styles.historyCriterionActive,
              ]}
            >
              <Text
                style={[
                  styles.buttonText,
                  criterion === item.id && styles.historyCriterionTextActive,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <ScrollView
        contentContainerStyle={[
          styles.panelList,
          selectionMode && styles.selectionPanelList,
        ]}
      >
        {type === "completed" ? (
          <>
            {historyGroups.length === 0 && (
              <Text style={styles.empty}>項目はありません</Text>
            )}
            {historyGroups.map((group) => (
              <View key={group.key}>
                <Text style={styles.historyHeading}>{group.label}</Text>
                {group.items.map((item) => (
                  <View key={item.key} style={styles.panelCard}>
                    <View style={styles.selectableCardHeader}>
                      {selectionMode && (
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{
                            checked: selectedKeys.has(item.key),
                          }}
                          onPress={() => toggleSelected(item.key)}
                          style={[
                            styles.listCheckbox,
                            selectedKeys.has(item.key) && styles.listCheckboxOn,
                          ]}
                        >
                          <Text style={styles.listCheckmark}>
                            {selectedKeys.has(item.key) ? "✓" : ""}
                          </Text>
                        </Pressable>
                      )}
                      <Text style={styles.cardTitle}>・{item.memo.title}</Text>
                    </View>
                    <Text style={styles.meta}>
                      {item.kind === "routineOccurrence"
                        ? `ルーティーン・${item.occurrenceDate!.getMonth() + 1}/${item.occurrenceDate!.getDate()}分`
                        : `元: ${parentName(item.memo.parentId)}`}
                    </Text>
                    <Text style={styles.meta}>
                      完了: {item.completedAt.toLocaleString()}
                    </Text>
                    {!selectionMode && (
                      <View style={styles.cardActions}>
                        <Pressable
                          onPress={() => onRestoreCompleted(item)}
                          style={styles.smallButton}
                        >
                          <Text style={styles.buttonText}>未完了へ戻す</Text>
                        </Pressable>
                        {item.kind === "memo" && (
                          <Pressable
                            onPress={() => onDelete(item.memo.id)}
                            style={styles.smallButton}
                          >
                            <Text style={styles.danger}>削除</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ))}
          </>
        ) : (
          <>
            {trashItems.length === 0 && (
              <Text style={styles.empty}>項目はありません</Text>
            )}
            {trashItems.map((node) => (
              <View key={node.id} style={styles.panelCard}>
                <View style={styles.selectableCardHeader}>
                  {selectionMode && (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{
                        checked: selectedKeys.has(node.id),
                      }}
                      onPress={() => toggleSelected(node.id)}
                      style={[
                        styles.listCheckbox,
                        selectedKeys.has(node.id) && styles.listCheckboxOn,
                      ]}
                    >
                      <Text style={styles.listCheckmark}>
                        {selectedKeys.has(node.id) ? "✓" : ""}
                      </Text>
                    </Pressable>
                  )}
                  <Text style={styles.cardTitle}>
                    {node.type === "category"
                      ? "📁"
                      : isIdea(node)
                        ? "💡"
                        : "・"}{" "}
                    {node.title}
                  </Text>
                </View>
                <Text style={styles.meta}>
                  {node.type === "memo"
                    ? isIdea(node)
                      ? "💡 Idea"
                      : "Task"
                    : "Category"}{" "}
                  · 元: {parentName(node.parentId)}
                </Text>
                <Text style={styles.meta}>
                  {node.deletedAt?.toLocaleString()}
                </Text>
                {!selectionMode && (
                  <View style={styles.cardActions}>
                    <Pressable
                      onPress={() => onRestoreNode(node.id)}
                      style={styles.smallButton}
                    >
                      <Text style={styles.buttonText}>復元</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onHardDelete(node.id)}
                      style={styles.smallButton}
                    >
                      <Text style={styles.danger}>完全削除</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
      {selectionMode && (
        <View style={styles.listActionBar}>
          <Text style={styles.listActionCount}>{selectedKeys.size}件選択</Text>
          {type === "completed" ? (
            <>
              <Pressable
                disabled={!selectedHistoryItems.length}
                style={[
                  styles.listActionButton,
                  !selectedHistoryItems.length && styles.disabled,
                ]}
                onPress={() =>
                  onBulkRestoreCompleted(selectedHistoryItems, clearSelection)
                }
              >
                <Text style={styles.buttonText}>未完了へ戻す</Text>
              </Pressable>
              <Pressable
                disabled={!deletableCompletedIds.length}
                style={[
                  styles.listActionButton,
                  !deletableCompletedIds.length && styles.disabled,
                ]}
                onPress={() =>
                  onBulkDeleteCompleted(deletableCompletedIds, clearSelection)
                }
              >
                <Text style={styles.danger}>削除</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                disabled={!selectedTrashIds.length}
                style={[
                  styles.listActionButton,
                  !selectedTrashIds.length && styles.disabled,
                ]}
                onPress={() =>
                  onBulkRestoreNodes(selectedTrashIds, clearSelection)
                }
              >
                <Text style={styles.buttonText}>復元</Text>
              </Pressable>
              <Pressable
                disabled={!selectedTrashIds.length}
                style={[
                  styles.listActionButton,
                  !selectedTrashIds.length && styles.disabled,
                ]}
                onPress={() =>
                  onBulkHardDelete(selectedTrashIds, clearSelection)
                }
              >
                <Text style={styles.danger}>完全削除</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
      {type === "trash" && !selectionMode && (
        <Pressable onPress={onReset} style={styles.reset}>
          <Text style={styles.danger}>データを初期化</Text>
        </Pressable>
      )}
    </View>
  );
}

function SnackbarNotice({
  notice,
  onExpire,
  onUndo,
}: {
  notice: { id: string; title: string };
  onExpire: () => void;
  onUndo: () => void;
}) {
  const styles = useStyles();
  const expireRef = useRef(onExpire);
  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);
  useEffect(() => {
    const timer = setTimeout(() => expireRef.current(), 5000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View style={styles.snackbar}>
      <Text style={styles.snackbarText}>
        ✓ 「{notice.title}」を完了しました
      </Text>
      <Pressable onPress={onUndo} style={styles.snackbarUndo}>
        <Text style={styles.snackbarUndoText}>元に戻す</Text>
      </Pressable>
    </View>
  );
}

function MovePanel({
  node,
  nodes,
  onClose,
  onMove,
}: {
  node: Node | null;
  nodes: Node[];
  onClose: () => void;
  onMove: (parentId: string | null) => void;
}) {
  const styles = useStyles();
  const categories = nodes.filter(
    (item) =>
      item.type === "category" &&
      item.deletedAt === null &&
      !!node &&
      canMoveNode(nodes, node.id, item.id),
  );
  return (
    <Modal
      visible={!!node}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalPage}>
        <View style={styles.panelHeader}>
          <Text style={styles.modalTitle}>移動先</Text>
          <Pressable onPress={onClose} style={styles.close}>
            <Text style={styles.actionText}>閉じる</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.panelList}>
          <Action label="ルート" onPress={() => onMove(null)} />
          {categories.map((category) => (
            <Action
              key={category.id}
              label={category.title}
              onPress={() => onMove(category.id)}
            />
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function BulkMovePanel({
  nodeIds,
  nodes,
  onClose,
  onMove,
}: {
  nodeIds: string[];
  nodes: Node[];
  onClose: () => void;
  onMove: (parentId: string | null) => void;
}) {
  const styles = useStyles();
  const categories = nodes.filter(
    (item) =>
      item.type === "category" &&
      item.deletedAt === null &&
      !item.purgedAt &&
      canMoveSelectedNodes(nodes, nodeIds, item.id),
  );
  return (
    <Modal
      visible={nodeIds.length > 0}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.moveBackdrop}>
        <View style={styles.moveDialog}>
          <View style={styles.panelHeader}>
            <Text style={styles.sheetTitle}>移動先を選択</Text>
            <Pressable onPress={onClose} style={styles.close}>
              <Text style={styles.actionText}>閉じる</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.panelList}>
            {canMoveSelectedNodes(nodes, nodeIds, null) && (
              <Action label="◇ 無所属" onPress={() => onMove(null)} />
            )}
            {categories.map((category) => (
              <Action
                key={category.id}
                label={`📁 ${category.title}`}
                onPress={() => onMove(category.id)}
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BulkDeadlineMovePanel({
  nodeIds,
  granularity,
  onClose,
  onMove,
}: {
  nodeIds: string[];
  granularity: TodayGranularity;
  onClose: () => void;
  onMove: (groupId?: DeadlineGroupKey, customDueAt?: Date) => void;
}) {
  const styles = useStyles();
  const [customDue, setCustomDue] = useState(() =>
    formatDateTimeInput(new Date()),
  );
  const destinations = deadlineGroupDefinitions(granularity).filter(
    (group) => group.create && !group.create.editable,
  );
  return (
    <Modal
      visible={nodeIds.length > 0}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.moveBackdrop}>
        <View style={styles.moveDialog}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sheetTitle}>期限の移動先を選択</Text>
              <Text style={styles.meta}>{nodeIds.length}件のTask</Text>
            </View>
            <Pressable onPress={onClose} style={styles.close}>
              <Text style={styles.actionText}>閉じる</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.panelList}>
            {destinations.map((group) => (
              <Action
                key={group.id}
                label={`📅 ${group.label}`}
                onPress={() => onMove(group.id)}
              />
            ))}
            <Text style={styles.label}>日時を指定</Text>
            <DateTimeField value={customDue} onChange={setCustomDue} />
            <Pressable
              style={styles.primary}
              onPress={() => {
                const dueAt = parseLocalDateTime(customDue);
                if (!dueAt) {
                  appAlert(
                    "入力エラー",
                    "日時を YYYY/MM/DD HH:mm 形式で入力してください。",
                  );
                  return;
                }
                onMove(undefined, dueAt);
              }}
            >
              <Text style={styles.primaryText}>この日時へ移動</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function useStyles() {
  return createStyles(useAppTheme().colors);
}
const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    tree: { flex: 1 },
    header: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 3 },
    title: { color: colors.text, fontSize: 25, fontWeight: "700" },
    subtitle: { color: colors.textSecondary, fontSize: 11 },
    historyButton: {
      width: 38,
      minHeight: 38,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 9,
      backgroundColor: colors.surfaceAlt,
    },
    historyText: { color: colors.accent, fontSize: 23 },
    disabled: { opacity: 0.3 },
    tabs: {
      flexDirection: "row",
      paddingHorizontal: 10,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      backgroundColor: colors.surface,
    },
    tab: {
      flex: 1,
      minHeight: 40,
      alignItems: "center",
      justifyContent: "center",
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    tabActive: { borderBottomColor: colors.accent },
    tabText: { color: colors.textSecondary, fontSize: 13 },
    tabTextActive: { color: colors.text, fontWeight: "700" },
    topButton: {
      minHeight: 38,
      paddingHorizontal: 9,
      justifyContent: "center",
    },
    topText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
    fab: {
      position: "absolute",
      right: 22,
      bottom: 24,
      width: 58,
      height: 58,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 29,
      backgroundColor: colors.accent,
      elevation: 6,
      shadowOpacity: 0.2,
      shadowRadius: 8,
    },
    fabText: {
      color: colors.background,
      fontSize: 34,
      fontWeight: "300",
      marginTop: -3,
    },
    keyboardSheet: { flex: 1 },
    backdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: colors.backdrop,
    },
    sheet: {
      maxHeight: "88%",
      padding: 18,
      paddingBottom: 28,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      backgroundColor: colors.surface,
    },
    sheetContent: { flexShrink: 1 },
    sheetScrollContent: { paddingBottom: 12 },
    sheetTitle: {
      marginBottom: 10,
      color: colors.text,
      fontSize: 19,
      fontWeight: "700",
    },
    settingsHeading: {
      marginTop: 12,
      paddingBottom: 5,
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: "700",
    },
    settingsSection: { marginTop: 14 },
    settingsSectionTitle: {
      marginBottom: 7,
      paddingHorizontal: 2,
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: "800",
    },
    settingsCard: {
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.background,
    },
    settingRow: {
      minHeight: 58,
      paddingHorizontal: 14,
      paddingVertical: 9,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    settingDisabled: { opacity: 0.45 },
    settingLabelArea: { flex: 1, minHeight: 40, justifyContent: "center" },
    settingLabel: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    settingDescription: {
      marginTop: 3,
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
    },
    settingLinkValue: { flexDirection: "row", alignItems: "center", gap: 8 },
    settingValue: { color: colors.textSecondary, fontSize: 12 },
    settingChevron: {
      color: colors.textSecondary,
      fontSize: 24,
      lineHeight: 26,
    },
    radioGrid: { padding: 8, flexDirection: "row", flexWrap: "wrap", gap: 8 },
    radioCard: {
      minHeight: 46,
      minWidth: 105,
      flexGrow: 1,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },
    radioCardSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    radioCircle: {
      width: 19,
      height: 19,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.border,
      borderRadius: 10,
    },
    radioCircleSelected: { borderColor: colors.accent },
    radioDot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: colors.accent,
    },
    radioLabel: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: "600",
    },
    radioLabelSelected: { color: colors.text },
    settingsButtonRow: {
      padding: 10,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    settingsButton: {
      minHeight: 46,
      minWidth: 150,
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },
    settingsButtonPressed: {
      opacity: 0.72,
      backgroundColor: colors.accentSoft,
    },
    settingsButtonText: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: "800",
    },
    settingHelp: {
      paddingVertical: 8,
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
    },
    action: {
      minHeight: 50,
      justifyContent: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    actionText: { color: colors.text, fontSize: 16 },
    danger: { color: colors.danger },
    buttonText: { color: colors.text },
    modalPage: { flex: 1, backgroundColor: colors.background },
    form: { padding: 22, paddingBottom: 50 },
    grabber: {
      width: 42,
      height: 5,
      alignSelf: "center",
      marginBottom: 12,
      borderRadius: 3,
      backgroundColor: colors.border,
    },
    modalTitle: { color: colors.text, fontSize: 25, fontWeight: "700" },
    destination: { marginTop: 7, color: colors.textSecondary, fontSize: 12 },
    label: {
      marginTop: 20,
      marginBottom: 7,
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: "700",
    },
    input: {
      minHeight: 48,
      paddingHorizontal: 13,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 11,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: 16,
    },
    multiline: { minHeight: 130, paddingTop: 12 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      minHeight: 40,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 20,
      backgroundColor: colors.surfaceAlt,
    },
    chipOn: { backgroundColor: colors.accentSoft },
    chipText: { color: colors.text },
    chipTextOn: { color: colors.accent, fontWeight: "700" },
    lockedDue: {
      minHeight: 48,
      paddingHorizontal: 13,
      paddingVertical: 14,
      borderRadius: 11,
      backgroundColor: colors.surfaceAlt,
      color: colors.textSecondary,
    },
    formButtons: { marginTop: 30, flexDirection: "row", gap: 12 },
    secondary: {
      flex: 1,
      minHeight: 50,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
    },
    primary: {
      flex: 1,
      minHeight: 50,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: colors.accent,
    },
    primaryText: { color: colors.background, fontWeight: "700" },
    panelContainer: { flex: 1 },
    selectionToolbar: {
      minHeight: 48,
      paddingHorizontal: 16,
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
    },
    selectionToolbarCount: {
      marginRight: "auto",
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
    },
    moveBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      padding: 12,
      backgroundColor: colors.backdrop,
    },
    moveDialog: {
      maxHeight: "72%",
      borderRadius: 18,
      overflow: "hidden",
      backgroundColor: colors.background,
    },
    panelHeader: {
      padding: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface,
    },
    close: {
      minHeight: 44,
      minWidth: 56,
      justifyContent: "center",
      alignItems: "center",
    },
    historyCriteria: {
      marginHorizontal: 16,
      marginTop: 10,
      padding: 3,
      flexDirection: "row",
      borderRadius: 10,
      backgroundColor: colors.surfaceAlt,
    },
    historyCriterion: {
      flex: 1,
      minHeight: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
    },
    historyCriterionActive: { backgroundColor: colors.surface },
    historyCriterionTextActive: { color: colors.accent, fontWeight: "700" },
    historyHeading: {
      marginTop: 14,
      marginBottom: 7,
      paddingBottom: 5,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: "700",
    },
    panelList: { padding: 16, paddingBottom: 80 },
    selectionPanelList: { paddingBottom: 150 },
    empty: { padding: 30, textAlign: "center", color: colors.textSecondary },
    panelCard: {
      marginBottom: 10,
      padding: 15,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
    selectableCardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    listCheckbox: {
      width: 24,
      height: 24,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 5,
      backgroundColor: colors.surface,
    },
    listCheckboxOn: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    listCheckmark: { color: colors.background, fontWeight: "800" },
    meta: { marginTop: 4, color: colors.textSecondary, fontSize: 12 },
    cardActions: { marginTop: 12, flexDirection: "row", gap: 10 },
    smallButton: {
      minHeight: 40,
      paddingHorizontal: 12,
      justifyContent: "center",
      borderRadius: 9,
      backgroundColor: colors.surfaceAlt,
    },
    listActionBar: {
      position: "absolute",
      left: 10,
      right: 10,
      bottom: 10,
      minHeight: 62,
      paddingHorizontal: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surface,
      elevation: 10,
      shadowOpacity: 0.2,
      shadowRadius: 10,
    },
    listActionCount: {
      marginRight: "auto",
      color: colors.text,
      fontSize: 12,
      fontWeight: "700",
    },
    listActionButton: {
      minHeight: 42,
      justifyContent: "center",
      paddingHorizontal: 10,
      borderRadius: 10,
      backgroundColor: colors.surfaceAlt,
    },
    reset: {
      position: "absolute",
      bottom: 18,
      alignSelf: "center",
      padding: 14,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },
    snackbarStack: {
      position: "absolute",
      left: 16,
      right: 16,
      bottom: 92,
      gap: 7,
    },
    snackbar: {
      minHeight: 52,
      paddingLeft: 15,
      paddingRight: 6,
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 12,
      backgroundColor: colors.snackbarBackground,
      elevation: 8,
      shadowOpacity: 0.25,
      shadowRadius: 8,
    },
    snackbarText: { flex: 1, color: colors.snackbarText, fontSize: 13 },
    snackbarUndo: {
      minHeight: 44,
      paddingHorizontal: 12,
      justifyContent: "center",
    },
    snackbarUndoText: { color: colors.snackbarAction, fontWeight: "800" },
  });
