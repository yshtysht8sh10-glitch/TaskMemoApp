export const TITLE_DOUBLE_TAP_MS = 250;

export function isMobileTitleEditor(platform: string, width: number, coarsePointer = false) {
  return platform !== "web" || (width <= 768 && coarsePointer);
}

export function quickTitleExit(title: string, confirm: boolean): { kind: "cancel" } | { kind: "invalid" } | { kind: "save"; title: string } {
  if (!confirm) return { kind: "cancel" };
  const trimmed = title.trim();
  return trimmed ? { kind: "save", title: trimmed } : { kind: "invalid" };
}

export function createTitleTapHandler(
  onSingle: () => void,
  onDouble: () => void,
  delay = TITLE_DOUBLE_TAP_MS,
) {
  let pending: ReturnType<typeof setTimeout> | null = null;
  return {
    press() {
      if (pending) {
        clearTimeout(pending);
        pending = null;
        onDouble();
      } else {
        pending = setTimeout(() => {
          pending = null;
          onSingle();
        }, delay);
      }
    },
    cancel() {
      if (pending) clearTimeout(pending);
      pending = null;
    },
  };
}
