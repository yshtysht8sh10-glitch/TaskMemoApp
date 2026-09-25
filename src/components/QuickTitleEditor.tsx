import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAppTheme } from "@/theme/theme";
import { quickTitleExit } from "@/utils/memoTap";
import { quickTitleSourceLabel } from "@/utils/quickAddTitle";

type Target = { id: string; title: string } | null;

export function QuickTitleEditor({ target, contextLabel, onClose, onSave }: {
  target: Target;
  contextLabel?: string;
  onClose: (confirmed: boolean) => void;
  onSave: (id: string, title: string) => void;
}) {
  const { colors } = useAppTheme();
  const [draft, setDraft] = useState(target?.title ?? "");
  const [error, setError] = useState(false);
  const [webKeyboardBottom, setWebKeyboardBottom] = useState(0);
  const draftRef = useRef(draft);
  const closing = useRef(false);
  const cancelIntent = useRef(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    closing.current = false;
    cancelIntent.current = false;
    draftRef.current = target?.title ?? "";
    setDraft(draftRef.current);
    setError(false);
  }, [target?.id, target?.title]);
  useEffect(() => {
    if (!target || Platform.OS !== "web" || typeof window === "undefined") return;
    const update = () => {
      const viewport = window.visualViewport;
      setWebKeyboardBottom(viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0);
    };
    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [target]);
  const close = (save: boolean) => {
    if (closing.current || !target) return;
    const result = quickTitleExit(draftRef.current, save);
    if (result.kind === "invalid") { setError(true); return; }
    closing.current = true;
    if (blurTimer.current) clearTimeout(blurTimer.current);
    if (result.kind === "save" && result.title !== target.title) onSave(target.id, result.title);
    onClose(result.kind === "save");
  };
  useEffect(() => {
    if (!target || Platform.OS === "web") return;
    const listener = Keyboard.addListener("keyboardDidHide", () => {
      if (cancelIntent.current || closing.current) return;
      if (blurTimer.current) clearTimeout(blurTimer.current);
      blurTimer.current = setTimeout(() => close(true), 100);
    });
    return () => listener.remove();
  });
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);
  return <Modal visible={!!target} transparent animationType="fade" onRequestClose={() => close(true)}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable style={styles.backdrop} onPress={() => close(true)} />
      <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border, bottom: Platform.OS === "web" ? webKeyboardBottom : 0 }]}>
        <View style={styles.context}>
          <Text style={[styles.heading, { color: colors.textSecondary }]}>{target?.title ? "タイトルを編集" : "新しいメモのタイトル"}</Text>
          <Text style={[styles.original, { color: colors.text }]} numberOfLines={2}>{target ? quickTitleSourceLabel(target, contextLabel) : ""}</Text>
        </View>
        <View style={styles.inputRow}>
        <TextInput
          autoFocus
          value={draft}
          onChangeText={(value) => { draftRef.current = value; setDraft(value); setError(false); }}
          onSubmitEditing={() => close(true)}
          onBlur={() => {
            if (cancelIntent.current || closing.current) return;
            blurTimer.current = setTimeout(() => close(true), 100);
          }}
          returnKeyType="done"
          accessibilityLabel="タイトルのクイック編集"
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
        />
        {error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>必須</Text>}
        <Pressable accessibilityLabel="タイトル編集を確定" onPressIn={() => { cancelIntent.current = true; }} onPress={() => close(true)} style={styles.button}>
          <Text style={[styles.buttonText, { color: colors.accent }]}>✓</Text>
        </Pressable>
        <Pressable accessibilityLabel="タイトル編集をキャンセル" onPressIn={() => { cancelIntent.current = true; }} onPress={() => close(false)} style={styles.button}>
          <Text style={[styles.buttonText, { color: colors.textSecondary }]}>×</Text>
        </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill },
  bar: { gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1 },
  context: { paddingHorizontal: 2, paddingBottom: 4 },
  heading: { fontSize: 12, fontWeight: "700" },
  original: { fontSize: 14, fontWeight: "600", marginTop: 2 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, minHeight: 42, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8, fontSize: 16 },
  button: { minWidth: 40, minHeight: 42, justifyContent: "center", alignItems: "center" },
  buttonText: { fontSize: 24, fontWeight: "700" },
});
