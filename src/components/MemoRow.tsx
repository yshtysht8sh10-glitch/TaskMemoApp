import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { dragActivationDelay } from "@/domain/dragActivation";
import type { MemoNode } from "@/models/node";
import { formatDueLabel } from "@/utils/formatDueLabel";
import { TREE_LAYOUT, TreeRowLayout } from "@/components/TreeRowLayout";
import { useAppTheme, type ThemeColors } from "@/theme/theme";
import { MemoRowActions } from "@/components/MemoRowActions";
import { CompletionMotion } from "@/components/CompletionMotion";
import { repeatRuleLabel } from "@/domain/routine";
import { isIdea } from "@/domain/memoType";

type Props = {
  memo: MemoNode;
  depth: number;
  ancestorContinuation: boolean[];
  hasNextSibling: boolean;
  now: number;
  isActive?: boolean;
  showInsertBefore?: boolean;
  completing?: boolean;
  routine?: boolean;
  selectionMode?: boolean;
  selectionState?: "selected" | "contained" | "none";
  onToggleSelected?: () => void;
  onCompletionAnimationFinished: () => void;
  onPress: () => void;
  onComplete: () => void;
  onMenu: () => void;
  onLongPress: () => void;
};
export function MemoRow({
  memo,
  depth,
  ancestorContinuation,
  hasNextSibling,
  now,
  isActive,
  showInsertBefore,
  completing = false,
  routine = false,
  selectionMode = false,
  selectionState = "none",
  onToggleSelected,
  onCompletionAnimationFinished,
  onPress,
  onComplete,
  onMenu,
  onLongPress,
}: Props) {
  const styles = createStyles(useAppTheme().colors);
  const idea = isIdea(memo);
  const dueLabel = idea ? null : formatDueLabel(memo);
  const completed = !idea && memo.status === "completed";
  const overdue = !completed && !!memo.dueAt && memo.dueAt.getTime() < now;
  const detailLabel = idea
    ? "アイデア"
    : routine
      ? `繰り返し: ${repeatRuleLabel(memo.repeatRule)}`
      : dueLabel;
  return (
    <CompletionMotion
      completing={completing}
      onFinished={onCompletionAnimationFinished}
    >
      <TreeRowLayout
        depth={depth}
        ancestorContinuation={ancestorContinuation}
        hasNextSibling={hasNextSibling}
      >
        <View style={styles.spacing}>
          <Pressable
            onPress={
              selectionMode
                ? selectionState === "contained"
                  ? undefined
                  : onToggleSelected
                : onPress
            }
            onLongPress={selectionMode ? undefined : onLongPress}
            delayLongPress={dragActivationDelay(Platform.OS === "web")}
            style={({ pressed }) => [
              styles.note,
              idea && styles.ideaNote,
              completed && styles.completedNote,
              selectionState === "selected" && styles.selectedNote,
              selectionState === "contained" && styles.containedNote,
              showInsertBefore && styles.insertBefore,
              (pressed || isActive) && styles.active,
            ]}
          >
            {selectionMode && (
              <View
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked:
                    selectionState === "contained"
                      ? "mixed"
                      : selectionState === "selected",
                }}
                style={[
                  styles.checkbox,
                  selectionState === "selected" && styles.checkboxOn,
                  selectionState === "contained" && styles.checkboxContained,
                ]}
              >
                <Text
                  style={[
                    styles.checkmark,
                    selectionState === "contained" && styles.checkmarkContained,
                  ]}
                >
                  {selectionState === "selected"
                    ? "✓"
                    : selectionState === "contained"
                      ? "−"
                      : ""}
                </Text>
              </View>
            )}
            <View style={styles.icon}>
              <Text style={idea ? styles.ideaIcon : styles.taskIcon}>
                {idea ? "💡" : "☑"}
              </Text>
            </View>
            <View style={styles.content}>
              <Text
                style={[
                  styles.title,
                  idea && styles.ideaTitle,
                  completed && styles.completedTitle,
                ]}
                numberOfLines={1}
              >
                {routine ? "🔁 " : ""}
                {completed ? `✓ ${memo.title}` : memo.title}
              </Text>
              {detailLabel ? (
                <Text
                  style={[
                    styles.due,
                    idea && styles.ideaDetail,
                    !routine && overdue && styles.overdue,
                  ]}
                >
                  {idea
                    ? detailLabel
                    : routine
                      ? detailLabel
                      : overdue
                        ? `📅 期限切れ · ${detailLabel}`
                        : `📅 ${detailLabel}`}
                </Text>
              ) : null}
            </View>
            {!selectionMode && !idea && (
              <MemoRowActions
                title={memo.title}
                completed={completed}
                completing={completing}
                onComplete={onComplete}
                onMenu={onMenu}
              />
            )}
            {!selectionMode && idea && (
              <Pressable
                accessibilityLabel={`${memo.title}のメニュー`}
                onPress={onMenu}
                style={styles.ideaMenu}
              >
                <Text style={styles.ideaMenuText}>•••</Text>
              </Pressable>
            )}
          </Pressable>
        </View>
      </TreeRowLayout>
    </CompletionMotion>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    spacing: { paddingVertical: 3 },
    note: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.memoBorder,
      borderRadius: 4,
      backgroundColor: colors.memoBackground,
    },
    ideaNote: {
      borderColor: colors.ideaBorder,
      backgroundColor: colors.ideaBackground,
    },
    ideaTitle: { color: colors.ideaText },
    ideaDetail: { color: colors.ideaText },
    ideaMenu: {
      minHeight: 40,
      minWidth: 42,
      alignItems: "center",
      justifyContent: "center",
    },
    ideaMenuText: { color: colors.ideaText, fontWeight: "800" },
    selectedNote: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    containedNote: { opacity: 0.45 },
    checkbox: {
      width: 22,
      height: 22,
      marginLeft: 9,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      backgroundColor: colors.surface,
    },
    checkboxOn: { borderColor: colors.accent, backgroundColor: colors.accent },
    checkboxContained: {
      borderColor: colors.accent,
      backgroundColor: colors.surfaceAlt,
    },
    checkmark: { color: colors.background, fontWeight: "800" },
    checkmarkContained: { color: colors.accent },
    completedNote: {
      borderColor: colors.border,
      backgroundColor: colors.completedBackground,
    },
    completedTitle: { color: colors.textSecondary },
    insertBefore: { borderTopWidth: 3, borderTopColor: colors.accent },
    active: { opacity: 0.82, backgroundColor: colors.accentSoft },
    icon: { width: TREE_LAYOUT.iconWidth, alignItems: "center" },
    taskIcon: { color: colors.accent, fontSize: 15, fontWeight: "800" },
    ideaIcon: { fontSize: 15 },
    bullet: {
      width: 5,
      height: 5,
      backgroundColor: colors.textSecondary,
      borderRadius: 3,
    },
    content: { flex: 1, paddingVertical: 5 },
    title: { color: colors.memoText, fontSize: 15, lineHeight: 19 },
    due: {
      marginTop: 1,
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: "500",
    },
    overdue: { color: colors.danger, fontWeight: "700" },
  });
