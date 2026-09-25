import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import DraggableFlatList, {
  ScaleDecorator,
  type DragEndParams,
} from "react-native-draggable-flatlist";

import {
  categoryPath,
  deadlineBeforeIdForDrop,
  deadlineCreateContext,
  deadlineDraftForCreateContext,
  deadlineDisplayGroups,
  deadlineGroups,
  hiddenDeadlineSummary,
  type DeadlineCreateContext,
  type DeadlineGroupKey,
  type TodayGranularity,
} from "@/domain/deadlineView";
import type { NodeDraft } from "@/domain/nodeOperations";
import type { MemoNode, Node } from "@/models/node";
import { formatDateTimeInput, parseLocalDateTime } from "@/utils/dueDates";
import { formatDueLabel } from "@/utils/formatDueLabel";
import { useAppTheme, type ThemeColors } from "@/theme/theme";
import { useInlineTitleEdit } from "@/hooks/useInlineTitleEdit";
import { CountBadge } from "@/components/CountBadge";
import { MemoRowActions } from "@/components/MemoRowActions";
import { CompletionMotion } from "@/components/CompletionMotion";
import { WebSortableScrollList } from "@/components/WebSortableScrollList";
import { clampPinnedNoteHeight } from "@/services/viewPreferences";
import { dragActivationDelay, NATIVE_DRAG_ACTIVATION_DISTANCE_PX } from "@/domain/dragActivation";
import { DRAG_AUTOSCROLL_THRESHOLD_PX, NATIVE_DRAG_AUTOSCROLL_SPEED } from "@/domain/dragAutoScroll";
import {
  repeatRuleLabel,
  routineCategoryForMemo,
  routineOccurrenceDueAt,
} from "@/domain/routine";
import { appAlert } from "@/utils/appAlert";
import { MemoTitleTap } from "@/components/MemoTitleTap";
import { isMobileTitleEditor } from "@/utils/memoTap";

type DeadlineRow =
  | {
      id: string;
      groupKey: DeadlineGroupKey;
      kind: "heading";
      label: string;
      memoCount: number;
      createContext: DeadlineCreateContext | null;
      dropLabel?: string;
    }
  | { id: string; groupKey: DeadlineGroupKey; kind: "memo"; memo: MemoNode }
  | {
      id: string;
      groupKey: DeadlineGroupKey;
      kind: "quickAdd";
      context: DeadlineCreateContext;
    };

type Props = {
  nodes: Node[];
  visibleGroupIds: ReadonlySet<DeadlineGroupKey>;
  todayGranularity: TodayGranularity;
  completingIds: ReadonlySet<string>;
  onCompletionAnimationFinished: (id: string) => void;
  showPinnedNote: boolean;
  pinnedNote: string;
  pinnedNoteHeight: number;
  onPinnedNoteChange: (body: string) => void;
  onPinnedNoteHeightChange: (height: number) => void;
  expandedGroups: ReadonlySet<DeadlineGroupKey>;
  onExpandedGroupsChange: (groups: Set<DeadlineGroupKey>) => void;
  onQuickAdd: (
    title: string,
    deadline: Pick<NodeDraft, "duePreset" | "dueAt">,
  ) => void;
  onRenameMemo: (id: string, title: string) => void;
  onOpenMemo: (memo: MemoNode) => void;
  onQuickTitle: (memo: MemoNode) => void;
  onComplete: (memo: MemoNode) => void;
  onMenu: (memo: MemoNode) => void;
  onDueDrop: (id: string, group: DeadlineGroupKey, beforeId?: string) => void;
  onBulkMove: (ids: string[], onSuccess: () => void) => void;
  onBulkComplete: (ids: string[]) => boolean;
  onBulkDelete: (ids: string[], onSuccess: () => void) => void;
  onOpenDisplaySettings: () => void;
};

function DragScale({ children }: { children: React.ReactNode }) {
  return Platform.OS === "web" ? (
    children
  ) : (
    <ScaleDecorator activeScale={1.02}>{children}</ScaleDecorator>
  );
}

function WebPinnedNote({
  body,
  height,
  onBodyChange,
  onHeightChange,
  colors,
  styles,
  embedded = false,
}: {
  body: string;
  height: number;
  onBodyChange: (body: string) => void;
  onHeightChange: (height: number) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  embedded?: boolean;
}) {
  const [draftHeight, setDraftHeight] = useState(height);
  const startY = useRef(0);
  const startHeight = useRef(height);
  const currentHeight = useRef(height);
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const move = (clientY: number) => {
    const next = clampPinnedNoteHeight(
      startHeight.current + clientY - startY.current,
    );
    currentHeight.current = next;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      setDraftHeight(next);
      frame.current = null;
    });
  };
  const finish = (element: HTMLDivElement, pointerId: number) => {
    if (element.hasPointerCapture(pointerId))
      element.releasePointerCapture(pointerId);
    setDraftHeight(currentHeight.current);
    onHeightChange(currentHeight.current);
  };
  return (
    <View
      style={[
        styles.pinned,
        embedded && styles.pinnedInList,
        { height: draftHeight, paddingBottom: 18 },
      ]}
    >
      <Text style={styles.pinnedLabel}>常設メモ</Text>
      <TextInput
        multiline
        value={body}
        onChangeText={onBodyChange}
        placeholder="いつも確認したいことを書く…"
        placeholderTextColor={colors.textSecondary}
        style={[
          styles.pinnedInput,
          {
            height: Math.max(36, draftHeight - 46),
            maxHeight: Math.max(36, draftHeight - 46),
          },
        ]}
      />
      <div
        role="slider"
        aria-label="常設メモの高さを変更"
        onPointerDown={(event) => {
          startY.current = event.clientY;
          startHeight.current = currentHeight.current;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            move(event.clientY);
        }}
        onPointerUp={(event) => finish(event.currentTarget, event.pointerId)}
        onPointerCancel={(event) =>
          finish(event.currentTarget, event.pointerId)
        }
        style={{
          position: "absolute",
          height: 20,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderTop: `1px solid ${colors.border}`,
          color: colors.textSecondary,
          fontSize: 12,
          cursor: "ns-resize",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        ↕
      </div>
    </View>
  );
}

export function DeadlineView({
  nodes,
  visibleGroupIds,
  todayGranularity,
  completingIds,
  onCompletionAnimationFinished,
  showPinnedNote,
  pinnedNote,
  pinnedNoteHeight,
  onPinnedNoteChange,
  onPinnedNoteHeightChange,
  expandedGroups,
  onExpandedGroupsChange,
  onQuickAdd,
  onRenameMemo,
  onOpenMemo,
  onQuickTitle,
  onComplete,
  onMenu,
  onDueDrop,
  onBulkMove,
  onBulkComplete,
  onBulkDelete,
  onOpenDisplaySettings,
}: Props) {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const mobileTitleEditor = isMobileTitleEditor(Platform.OS, width, Platform.OS === "web" && typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches);
  const styles = createStyles(colors);
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set<string>());
  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };
  const toggleSelected = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refreshAndSchedule = () => {
      const now = new Date();
      setCurrentDate(now);
      const tomorrow = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      clearTimeout(timer);
      timer = setTimeout(
        refreshAndSchedule,
        Math.max(1000, tomorrow.getTime() - now.getTime() + 1000),
      );
    };
    refreshAndSchedule();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshAndSchedule();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);
  const [resizingHeight, setResizingHeight] = useState<number | null>(null);
  const draftPinnedHeight = resizingHeight ?? pinnedNoteHeight;
  const resizeStart = useRef(pinnedNoteHeight);
  const currentHeight = useRef(pinnedNoteHeight);
  const onHeightChangeRef = useRef(onPinnedNoteHeightChange);
  useEffect(() => {
    if (resizingHeight === null) currentHeight.current = pinnedNoteHeight;
  }, [pinnedNoteHeight, resizingHeight]);
  useEffect(() => {
    onHeightChangeRef.current = onPinnedNoteHeightChange;
  }, [onPinnedNoteHeightChange]);
  // PanResponder only reads these refs from gesture callbacks, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [resize] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        resizeStart.current = currentHeight.current;
      },
      onPanResponderMove: (_event, gesture) => {
        const height = clampPinnedNoteHeight(resizeStart.current + gesture.dy);
        currentHeight.current = height;
        setResizingHeight(height);
      },
      onPanResponderRelease: () => {
        onHeightChangeRef.current(currentHeight.current);
        setResizingHeight(null);
      },
      onPanResponderTerminate: () => {
        onHeightChangeRef.current(currentHeight.current);
        setResizingHeight(null);
      },
    }),
  );
  const sourceGroups = useMemo(
    () => deadlineGroups(nodes, currentDate, visibleGroupIds, todayGranularity),
    [currentDate, nodes, todayGranularity, visibleGroupIds],
  );
  const groups = useMemo(
    () => deadlineDisplayGroups(sourceGroups, currentDate, todayGranularity),
    [currentDate, sourceGroups, todayGranularity],
  );
  const hidden = useMemo(
    () => hiddenDeadlineSummary(nodes, currentDate, visibleGroupIds, todayGranularity),
    [currentDate, nodes, todayGranularity, visibleGroupIds],
  );
  const sourceGroupByMemoId = useMemo(
    () => new Map(sourceGroups.flatMap((group) => group.memos.map((memo) => [memo.id, group.key] as const))),
    [sourceGroups],
  );
  const [quickAdd, setQuickAdd] = useState<DeadlineCreateContext | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickDueAt, setQuickDueAt] = useState("");
  const [quickError, setQuickError] = useState<string | null>(null);
  const titleEdit = useInlineTitleEdit(onRenameMemo);
  const quickBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickPointerTarget = useRef<"inside" | "outside" | null>(null);
  useEffect(
    () => () => {
      if (quickBlurTimer.current) clearTimeout(quickBlurTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      !quickAdd ||
      typeof document === "undefined"
    )
      return;
    const rememberPointerTarget = (event: PointerEvent) => {
      quickPointerTarget.current =
        event.target instanceof Element &&
        !!event.target.closest("#deadline-quick-add")
          ? "inside"
          : "outside";
    };
    document.addEventListener("pointerdown", rememberPointerTarget, true);
    return () =>
      document.removeEventListener("pointerdown", rememberPointerTarget, true);
  }, [quickAdd]);
  const [targetGroup, setTargetGroup] = useState<DeadlineGroupKey | null>(null);
  const moving = useRef<{ id: string; sourceGroup: DeadlineGroupKey } | null>(
    null,
  );
  const targetRef = useRef<DeadlineGroupKey | null>(null);
  const rows = useMemo<DeadlineRow[]>(
    () =>
      groups.flatMap((group) => {
        const context = deadlineCreateContext(
          group,
          currentDate,
          todayGranularity,
        );
        const children: DeadlineRow[] = expandedGroups.has(group.key)
          ? [
              ...group.memos.map((memo): DeadlineRow => ({
                id: memo.id,
                groupKey: sourceGroupByMemoId.get(memo.id) ?? group.key,
                kind: "memo",
                memo,
              })),
              ...(quickAdd?.targetGroup === group.key && context
                ? [
                    {
                      id: `quick-${group.key}`,
                      groupKey: group.key,
                      kind: "quickAdd" as const,
                      context,
                    },
                  ]
                : []),
            ]
          : [];
        return [
          {
            id: `group-${group.key}`,
            groupKey: group.key,
            kind: "heading",
            label: group.label,
            memoCount: group.memos.length,
            createContext: context,
            dropLabel: group.dropLabel,
          },
          ...children,
        ];
      }),
    [currentDate, expandedGroups, groups, quickAdd, sourceGroupByMemoId, todayGranularity],
  );
  const setExpanded = (groupKey: DeadlineGroupKey, value: boolean) => {
    const next = new Set(expandedGroups);
    if (value) next.add(groupKey);
    else next.delete(groupKey);
    onExpandedGroupsChange(next);
    if (!value && quickAdd?.targetGroup === groupKey) setQuickAdd(null);
  };
  const beginQuickAdd = (context: DeadlineCreateContext) => {
    setExpanded(context.targetGroup, true);
    setQuickAdd(context);
    setQuickTitle("");
    setQuickDueAt(
      context.initialDueAt ? formatDateTimeInput(context.initialDueAt) : "",
    );
    setQuickError(null);
  };
  const keepQuickAddOpen = () => {
    if (!quickBlurTimer.current) return;
    clearTimeout(quickBlurTimer.current);
    quickBlurTimer.current = null;
  };
  const focusQuickAdd = () => {
    keepQuickAddOpen();
    quickPointerTarget.current = null;
  };
  const cancelQuickAdd = () => {
    keepQuickAddOpen();
    setQuickAdd(null);
    setQuickTitle("");
    setQuickError(null);
  };
  const submitQuickAdd = () => {
    if (!quickAdd || !quickTitle.trim()) return;
    keepQuickAddOpen();
    try {
      const editableDueAt = quickAdd.dueEditable
        ? parseLocalDateTime(quickDueAt)
        : undefined;
      if (quickAdd.dueEditable && !editableDueAt)
        throw new Error("日時を YYYY/MM/DD HH:mm 形式で入力してください。");
      onQuickAdd(
        quickTitle,
        deadlineDraftForCreateContext(quickAdd, editableDueAt),
      );
      setQuickAdd(null);
      setQuickTitle("");
      setQuickError(null);
    } catch (error) {
      setQuickError(
        error instanceof Error ? error.message : "入力内容を確認してください。",
      );
    }
  };
  const handleQuickAddBlur = () => {
    keepQuickAddOpen();
    const pointerTarget = quickPointerTarget.current;
    quickPointerTarget.current = null;
    quickBlurTimer.current = setTimeout(() => {
      quickBlurTimer.current = null;
      if (Platform.OS === "web" && pointerTarget === null) {
        if (quickTitle.trim()) submitQuickAdd();
        else cancelQuickAdd();
        return;
      }
      if (pointerTarget !== "inside") cancelQuickAdd();
    }, 0);
  };
  const setCandidate = (index: number) => {
    const groupKey = rows[index]?.groupKey;
    const group = sourceGroups.find((item) => item.key === groupKey);
    const next = group?.create && !group.create.editable ? group.key : null;
    targetRef.current = next;
    setTargetGroup(next);
  };
  const finish = (_params: DragEndParams<DeadlineRow>) => {
    const active = moving.current;
    const target = targetRef.current;
    moving.current = null;
    targetRef.current = null;
    setTargetGroup(null);
    if (active && target && target !== active.sourceGroup)
      onDueDrop(active.id, target);
  };
  const memoMeta = (memo: MemoNode) => {
    if (!routineCategoryForMemo(nodes, memo))
      return `${formatDueLabel(memo) ?? (memo.dueAt ? memo.dueAt.toLocaleString() : "期限なし")} · ${categoryPath(nodes, memo.parentId)}`;
    const occurrence = routineOccurrenceDueAt(nodes, memo, currentDate);
    return `🔁 ${repeatRuleLabel(memo.repeatRule)} · ${occurrence ? "今日分" : "本日の発生なし"} · ${categoryPath(nodes, memo.parentId)}`;
  };
  const renderRow = (item: DeadlineRow, isActive: boolean, drag: () => void) =>
    item.kind === "heading" ? (
      <View
        style={[
          styles.heading,
          targetGroup === item.groupKey && styles.dropTarget,
        ]}
      >
        <Pressable
          onPress={() =>
            setExpanded(item.groupKey, !expandedGroups.has(item.groupKey))
          }
          accessibilityRole="button"
          accessibilityState={{ expanded: expandedGroups.has(item.groupKey) }}
          style={styles.headingToggle}
        >
          <Text style={styles.disclosure}>
            {item.memoCount === 0
              ? "•"
              : expandedGroups.has(item.groupKey)
                ? "▼"
                : "▶"}
          </Text>
          <Text
            style={[
              styles.headingText,
              item.groupKey === "overdue" && styles.overdue,
            ]}
          >
            📅 {targetGroup === item.groupKey ? item.dropLabel : item.label}
          </Text>
          <CountBadge count={item.memoCount} />
        </Pressable>
        {item.createContext && (
          <Pressable
            onPress={() => beginQuickAdd(item.createContext!)}
            accessibilityLabel={`${item.label}のMemoを追加`}
            style={styles.add}
          >
            <Text style={styles.addText}>＋</Text>
          </Pressable>
        )}
      </View>
    ) : item.kind === "quickAdd" ? (
      <View nativeID="deadline-quick-add" style={styles.quickAdd}>
        <TextInput
          autoFocus
          value={quickTitle}
          onChangeText={setQuickTitle}
          onFocus={focusQuickAdd}
          onBlur={handleQuickAddBlur}
          onSubmitEditing={submitQuickAdd}
          returnKeyType="done"
          placeholder="タイトルを入力…"
          placeholderTextColor={colors.textSecondary}
          style={styles.quickTitle}
        />
        {item.context.dueEditable && (
          <TextInput
            value={quickDueAt}
            onChangeText={setQuickDueAt}
            onFocus={focusQuickAdd}
            onBlur={handleQuickAddBlur}
            onSubmitEditing={submitQuickAdd}
            returnKeyType="done"
            placeholder="YYYY/MM/DD HH:mm"
            placeholderTextColor={colors.textSecondary}
            style={styles.quickDue}
          />
        )}
        {quickError && <Text style={styles.quickError}>{quickError}</Text>}
        <View style={styles.quickActions}>
          <Pressable
            onPress={submitQuickAdd}
            disabled={!quickTitle.trim()}
            accessibilityRole="button"
            accessibilityLabel="Memoを追加"
            accessibilityState={{ disabled: !quickTitle.trim() }}
            style={[
              styles.quickSubmit,
              !quickTitle.trim() && styles.quickSubmitDisabled,
            ]}
          >
            <Text style={styles.quickSubmitText}>追加</Text>
          </Pressable>
          <Pressable
            onPress={cancelQuickAdd}
            accessibilityRole="button"
            accessibilityLabel="クイック追加をキャンセル"
            style={styles.cancel}
          >
            <Text style={styles.cancelText}>×</Text>
          </Pressable>
        </View>
      </View>
    ) : (
      <CompletionMotion
        completing={completingIds.has(item.memo.id)}
        onFinished={() => onCompletionAnimationFinished(item.memo.id)}
      >
        <DragScale>
          <View style={styles.rowSpacing}>
            <Pressable
              nativeID={`deadline-memo-${item.memo.id}`}
              onPress={() =>
                selectionMode
                  ? toggleSelected(item.memo.id)
                  : onOpenMemo(item.memo)
              }
              onLongPress={selectionMode ? undefined : drag}
              delayLongPress={dragActivationDelay(Platform.OS === "web")}
              style={({ pressed }) => [
                styles.row,
                selectedIds.has(item.memo.id) && styles.selectedRow,
                (pressed || isActive) && styles.pressed,
              ]}
            >
              {selectionMode && (
                <View
                  accessibilityRole="checkbox"
                  accessibilityState={{
                    checked: selectedIds.has(item.memo.id),
                  }}
                  style={[
                    styles.checkbox,
                    selectedIds.has(item.memo.id) && styles.checkboxOn,
                  ]}
                >
                  <Text style={styles.checkmark}>
                    {selectedIds.has(item.memo.id) ? "✓" : ""}
                  </Text>
                </View>
              )}
              <View style={styles.content}>
                {titleEdit.activeId === item.memo.id ? (
                  <View nativeID={titleEdit.nativeID}>
                    <TextInput
                      autoFocus
                      value={titleEdit.draft}
                      onChangeText={titleEdit.changeDraft}
                      onBlur={titleEdit.blur}
                      onSubmitEditing={titleEdit.submit}
                      onKeyPress={({ nativeEvent }) => {
                        if (nativeEvent.key === "Escape") titleEdit.cancel();
                      }}
                      returnKeyType="done"
                      selectTextOnFocus
                      style={[styles.title, styles.inlineTitleInput]}
                    />
                    <Pressable
                      accessibilityLabel="タイトル編集をキャンセル"
                      onPress={(event) => {
                        event.stopPropagation();
                        titleEdit.cancel();
                      }}
                      style={styles.inlineTitleCancel}
                    >
                      <Text style={styles.inlineTitleCancelText}>×</Text>
                    </Pressable>
                  </View>
                ) : (
                  selectionMode ? <Text style={styles.title} numberOfLines={1}>{routineCategoryForMemo(nodes, item.memo) ? "🔁 " : "・"}{item.memo.title}</Text> :
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={styles.title}>{routineCategoryForMemo(nodes, item.memo) ? "🔁 " : "・"}</Text>
                    <MemoTitleTap onSingle={() => onOpenMemo(item.memo)} onDouble={() => mobileTitleEditor ? onQuickTitle(item.memo) : titleEdit.begin(item.memo.id, item.memo.title)} onLongPress={drag}>
                      <Text style={styles.title} numberOfLines={1}>{item.memo.title}</Text>
                    </MemoTitleTap>
                  </View>
                )}
                <Text style={styles.meta} numberOfLines={1}>
                  {memoMeta(item.memo)}
                </Text>
              </View>
              {!selectionMode && (
                <MemoRowActions
                  title={item.memo.title}
                  completing={completingIds.has(item.memo.id)}
                  onComplete={() => onComplete(item.memo)}
                  onMenu={() => onMenu(item.memo)}
                />
              )}
            </Pressable>
          </View>
        </DragScale>
      </CompletionMotion>
    );
  const toolbar = (
    <View style={styles.toolbarArea}>
      <View style={styles.toolbar}>
      {selectionMode ? (
        <>
          <Text style={styles.selectionCount}>{selectedIds.size}件選択</Text>
          <Pressable style={styles.tool} onPress={clearSelection}>
            <Text style={styles.toolText}>キャンセル</Text>
          </Pressable>
        </>
      ) : (
        <Pressable style={styles.tool} onPress={() => setSelectionMode(true)}>
          <Text style={styles.toolText}>複数選択</Text>
        </Pressable>
      )}
      {!selectionMode && (
        <>
          <Pressable
            style={styles.tool}
            onPress={() =>
              onExpandedGroupsChange(new Set(groups.map((group) => group.key)))
            }
          >
            <Text style={styles.toolText}>全表示</Text>
          </Pressable>
          <Pressable
            style={styles.tool}
            onPress={() => {
              onExpandedGroupsChange(new Set());
              setQuickAdd(null);
            }}
          >
            <Text style={styles.toolText}>全非表示</Text>
          </Pressable>
        </>
      )}
      </View>
      {!selectionMode && hidden.total > 0 && (
        <Pressable
          style={styles.hiddenStatus}
          onPress={() => appAlert(
            `非表示中 ${hidden.total}件`,
            hidden.groups.map((group) => `${group.label}  ${group.count}件`).join("\n"),
            [
              { text: "閉じる", style: "cancel" },
              { text: "表示設定を変更", onPress: onOpenDisplaySettings },
            ],
          )}
        >
          <Text style={styles.hiddenStatusText}>◉ {hidden.total}件を非表示中</Text>
          <Text style={styles.hiddenStatusArrow}>›</Text>
        </Pressable>
      )}
    </View>
  );
  const deadlineMovableIds = [...selectedIds].filter((id) => {
    const memo = nodes.find(
      (node): node is MemoNode => node.id === id && node.type === "memo",
    );
    return !!memo && !routineCategoryForMemo(nodes, memo);
  });
  const actionBar = selectionMode && (
    <View style={styles.actionBar}>
      <Text style={styles.actionCount}>{selectedIds.size}件選択</Text>
      <Pressable
        disabled={!deadlineMovableIds.length}
        style={[
          styles.actionButton,
          !deadlineMovableIds.length && styles.disabled,
        ]}
        onPress={() => onBulkMove(deadlineMovableIds, clearSelection)}
      >
        <Text style={styles.actionText}>期限移動</Text>
      </Pressable>
      <Pressable
        disabled={!selectedIds.size}
        style={[styles.actionButton, !selectedIds.size && styles.disabled]}
        onPress={() => {
          if (onBulkComplete([...selectedIds])) clearSelection();
        }}
      >
        <Text style={styles.actionText}>完了</Text>
      </Pressable>
      <Pressable
        disabled={!selectedIds.size}
        style={[styles.actionButton, !selectedIds.size && styles.disabled]}
        onPress={() => onBulkDelete([...selectedIds], clearSelection)}
      >
        <Text style={styles.deleteText}>削除</Text>
      </Pressable>
    </View>
  );
  const nativePinnedNote = showPinnedNote && (
    <View
      style={[
        styles.pinned,
        styles.pinnedInList,
        { height: draftPinnedHeight, paddingBottom: 18 },
      ]}
    >
      <Text style={styles.pinnedLabel}>常設メモ</Text>
      <TextInput
        multiline
        value={pinnedNote}
        onChangeText={onPinnedNoteChange}
        placeholder="いつも確認したいことを書く…"
        placeholderTextColor={colors.textSecondary}
        style={[
          styles.pinnedInput,
          {
            height: Math.max(36, draftPinnedHeight - 46),
            maxHeight: Math.max(36, draftPinnedHeight - 46),
          },
        ]}
      />
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="常設メモの高さを変更"
        {...resize.panHandlers}
        style={styles.pinnedResizeHandle}
      >
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>↕</Text>
      </View>
    </View>
  );
  if (Platform.OS === "web")
    return (
      <View style={styles.container}>
        {toolbar}
        <WebSortableScrollList
          data={rows}
          header={
            showPinnedNote ? (
              <WebPinnedNote
                key={pinnedNoteHeight}
                body={pinnedNote}
                height={pinnedNoteHeight}
                onBodyChange={onPinnedNoteChange}
                onHeightChange={onPinnedNoteHeightChange}
                colors={colors}
                styles={styles}
                embedded
              />
            ) : null
          }
          showDropIndicator={(_active, target) => target.kind === "memo"}
          canDropAfter={(target) => target.kind === "memo"}
          keyFor={(row) => row.id}
          canDrag={(row) => !selectionMode && row.kind === "memo"}
          contentContainerStyle={[
            styles.list,
            selectionMode && styles.selectionList,
          ]}
          onHover={(active, target) => {
            if (active.kind !== "memo") return;
            moving.current = {
              id: active.memo.id,
              sourceGroup: active.groupKey,
            };
            const group = sourceGroups.find((item) => item.key === target.groupKey);
            const next =
              target.kind === "heading" &&
              group?.create &&
              !group.create.editable
                ? group.key
                : null;
            targetRef.current = next;
            setTargetGroup(next);
          }}
          onDrop={(active, target, placement) => {
            setTargetGroup(null);
            targetRef.current = null;
            if (active.kind === "memo") {
              const beforeId =
                target.kind === "memo" && placement !== "on"
                  ? deadlineBeforeIdForDrop(
                      sourceGroups,
                      target.groupKey,
                      active.memo.id,
                      target.memo.id,
                      placement,
                    )
                  : undefined;
              onDueDrop(
                active.memo.id,
                target.groupKey,
                beforeId,
              );
            }
          }}
          renderItem={(item, active) => renderRow(item, active, () => {})}
        />
        {actionBar}
      </View>
    );
  return (
    <View style={styles.container}>
      {toolbar}
      <DraggableFlatList
        data={rows}
        ListHeaderComponent={nativePinnedNote || null}
        keyExtractor={(row) => row.id}
        onDragBegin={(index) => {
          const row = rows[index];
          moving.current =
            !selectionMode && row?.kind === "memo"
              ? { id: row.memo.id, sourceGroup: row.groupKey }
              : null;
          setCandidate(index);
        }}
        onPlaceholderIndexChange={setCandidate}
        onDragEnd={finish}
        activationDistance={selectionMode ? 9999 : NATIVE_DRAG_ACTIVATION_DISTANCE_PX}
        autoscrollThreshold={DRAG_AUTOSCROLL_THRESHOLD_PX}
        autoscrollSpeed={NATIVE_DRAG_AUTOSCROLL_SPEED}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.list,
          selectionMode && styles.selectionList,
        ]}
        renderItem={({ item, drag, isActive }) =>
          renderRow(item, isActive, drag)
        }
      />
      {actionBar}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1 },
    pinned: {
      marginHorizontal: 18,
      marginTop: 8,
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },
    pinnedInList: { marginHorizontal: 0 },
    pinnedResizeHandle: {
      position: "absolute",
      height: 20,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    pinnedLabel: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: "700",
    },
    pinnedInput: {
      minHeight: 36,
      maxHeight: 110,
      paddingTop: 5,
      color: colors.text,
      fontSize: 14,
      textAlignVertical: "top",
    },
    toolbarArea: { backgroundColor: colors.background },
    toolbar: {
      minHeight: 38,
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
      paddingHorizontal: 18,
      gap: 4,
    },
    tool: {
      minHeight: 34,
      justifyContent: "center",
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: colors.surfaceAlt,
    },
    toolText: { color: colors.textSecondary, fontSize: 11, fontWeight: "600" },
    hiddenStatus: {
      minHeight: 34,
      marginHorizontal: 12,
      marginBottom: 4,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
    },
    hiddenStatusText: { flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
    hiddenStatusArrow: { color: colors.textSecondary, fontSize: 18 },
    selectionCount: {
      marginRight: "auto",
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
    },
    list: { paddingHorizontal: 18, paddingBottom: 100 },
    selectionList: { paddingBottom: 170 },
    heading: {
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headingToggle: {
      flex: 1,
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
    },
    disclosure: { width: 22, color: colors.textSecondary, fontSize: 11 },
    headingText: {
      flexShrink: 1,
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: "700",
    },
    add: {
      width: 40,
      minHeight: 38,
      alignItems: "center",
      justifyContent: "center",
    },
    addText: { color: colors.accent, fontSize: 22, fontWeight: "600" },
    dropTarget: {
      paddingHorizontal: 8,
      backgroundColor: colors.accentSoft,
      borderBottomWidth: 2,
      borderBottomColor: colors.accent,
    },
    overdue: { color: colors.danger },
    quickAdd: {
      position: "relative",
      marginVertical: 5,
      paddingRight: 104,
      paddingLeft: 8,
      paddingVertical: 7,
      gap: 6,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    quickTitle: { minHeight: 38, color: colors.text, fontSize: 15 },
    quickDue: {
      minHeight: 38,
      paddingHorizontal: 8,
      borderRadius: 6,
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      fontSize: 13,
    },
    quickError: { color: colors.danger, fontSize: 11 },
    quickActions: {
      position: "absolute",
      top: 7,
      right: 4,
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
    },
    quickSubmit: {
      minWidth: 58,
      height: 34,
      paddingHorizontal: 10,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
    },
    quickSubmitDisabled: { opacity: 0.35 },
    quickSubmitText: {
      color: colors.surface,
      fontSize: 13,
      fontWeight: "700",
    },
    cancel: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
    },
    cancelText: { color: colors.text },
    rowSpacing: { paddingVertical: 3 },
    row: {
      minHeight: 52,
      paddingLeft: 12,
      flexDirection: "row",
      alignItems: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderLeftWidth: 3,
      borderColor: colors.memoBorder,
      borderLeftColor: colors.memoBorder,
      borderRadius: 4,
      backgroundColor: colors.memoBackground,
    },
    selectedRow: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    checkbox: {
      width: 22,
      height: 22,
      marginRight: 9,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      backgroundColor: colors.surface,
    },
    checkboxOn: { borderColor: colors.accent, backgroundColor: colors.accent },
    checkmark: { color: colors.background, fontWeight: "800" },
    pressed: { opacity: 0.82, backgroundColor: colors.accentSoft },
    content: { flex: 1, paddingVertical: 7 },
    title: { color: colors.memoText, fontSize: 15 },
    inlineTitleInput: {
      minHeight: 34,
      paddingRight: 36,
      paddingVertical: 4,
      paddingHorizontal: 6,
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: 4,
      backgroundColor: colors.surface,
    },
    inlineTitleCancel: {
      position: "absolute",
      top: 2,
      right: 2,
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 15,
      backgroundColor: colors.surfaceAlt,
    },
    inlineTitleCancelText: { color: colors.textSecondary, fontSize: 18 },
    meta: { marginTop: 2, color: colors.textSecondary, fontSize: 11 },
    complete: {
      minHeight: 44,
      minWidth: 72,
      marginRight: 7,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: colors.memoBorder,
      borderRadius: 15,
      backgroundColor: colors.surfaceAlt,
    },
    completeText: { color: colors.text, fontSize: 12, fontWeight: "700" },
    actionBar: {
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
    actionCount: {
      marginRight: "auto",
      color: colors.text,
      fontSize: 12,
      fontWeight: "700",
    },
    actionButton: {
      minHeight: 42,
      justifyContent: "center",
      paddingHorizontal: 10,
      borderRadius: 10,
      backgroundColor: colors.surfaceAlt,
    },
    actionText: { color: colors.text, fontSize: 12, fontWeight: "700" },
    deleteText: { color: colors.danger, fontSize: 12, fontWeight: "700" },
    disabled: { opacity: 0.35 },
  });
